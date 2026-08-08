import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { hasTrialPrice, formatYen, trialPriceLine } from "@/lib/trialPricing";

// 体験トレーニングの料金まわりの検査（2026-08-08）。
//
// ── 背景 ──────────────────────────────────────────────────────
// Salute御所南が体験を有料（¥3,000／当日入会なら¥0）に切り替えた。
// ただし**本番には14テナントいる。** 無料体験で集客しているジムもありうるので、
// **金額をコードに書いてはいけない**（CLAUDE.md「特定テナント専用の変更を
// 全テナントに適用しない」）。料金は tenants.trial_price_yen に持つ。
//
// ── ここで見るもの ────────────────────────────────────────────
//   1. null（未設定）と 0（¥0と明示）を取り違えていないか
//   2. 金額がコードに直書きされていないか
//   3. 「無料体験」の呼称が復活していないか
//   4. **DBの内部キー `"初回無料体験"` を改名していないか**（表示ではなくキー）
//   5. isFreeTrial の二役分解が戻っていないか（手ぶらOKが消える）
//
// ── 変異テスト（2026-08-08 実施）──────────────────────────────
//   下の「変異テスト」の節にある表のとおり。

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;

const CONFIRM_TPL = "supabase/functions/_shared/transactional-email-templates/trial-booking-confirmation.tsx";
const REMIND_TPL = "supabase/functions/_shared/transactional-email-templates/trial-booking-reminder.tsx";
const TRIAL_BOOK_FN = "supabase/functions/trial-book/index.ts";
const REMINDERS_FN = "supabase/functions/send-trial-reminders/index.ts";
const TRIAL_PAGE = "src/pages/TrialBooking.tsx";
const MIGRATION = "supabase/migrations/20260808000000_trial_price.sql";

const read = (p: string) => readFileSync(p, "utf8");

describe("料金の判定（null と 0 を混同しない）", () => {
  it("未設定（null / undefined）は表示しない", () => {
    expect(hasTrialPrice(null)).toBe(false);
    expect(hasTrialPrice(undefined)).toBe(false);
  });

  it("🔴 0 は「¥0 と明示する」なので表示する", () => {
    // `if (!price)` と書くと 0 が落ちる。ジムが「¥0」と明示したのに
    // 何も出ないのは、無料と伝えたい意図と食い違う。
    expect(hasTrialPrice(0)).toBe(true);
    expect(formatYen(0)).toBe("¥0");
  });

  it("金額を3桁区切りにする", () => {
    expect(formatYen(3000)).toBe("¥3,000");
    expect(formatYen(500)).toBe("¥500");
    expect(formatYen(1234567)).toBe("¥1,234,567");
  });

  it("壊れた値は表示しない", () => {
    expect(hasTrialPrice(Number.NaN)).toBe(false);
    expect(hasTrialPrice(Number.POSITIVE_INFINITY)).toBe(false);
    expect(hasTrialPrice(-1)).toBe(false);
  });

  it("メール用の1行は、未設定なら null（行ごと落とす）", () => {
    expect(trialPriceLine(null, "（税込）")).toBeNull();
    expect(trialPriceLine(3000, "（税込）")).toBe("¥3,000（税込）");
    expect(trialPriceLine(0, "（税込）")).toBe("¥0（税込）");
  });
});

describe("Edge Function 側の判定がクライアントと同じ", () => {
  // 片方だけ直すと「画面には ¥3,000 と出ているのにメールには出ない」が起きる。
  const shared = read("supabase/functions/_shared/trial-pricing.ts");

  it("同じ関数が置いてある", () => {
    for (const fn of ["hasTrialPrice", "formatYen", "trialPriceLine"]) {
      expect(shared, `_shared/trial-pricing.ts に ${fn} がありません`).toContain(`export function ${fn}`);
    }
  });

  it("0 を落とす書き方（!yen）になっていない", () => {
    expect(shared).toMatch(/yen >= 0/);
    expect(shared, "`if (!yen)` は 0 を落とす").not.toMatch(/if\s*\(\s*!yen\s*\)/);
  });
});

describe("金額をコードに書いていない", () => {
  // ⚠️ 本番には14テナントいる。1ジムの金額をコードに置くと全ジムに波及する。
  const FILES = [TRIAL_PAGE, CONFIRM_TPL, REMIND_TPL, TRIAL_BOOK_FN, REMINDERS_FN,
                 "src/lib/trialPricing.ts", "supabase/functions/_shared/trial-pricing.ts"];

  /** コメントを落とす。⚠️ `(?<!:)` が無いと `https://` の // を食う */
  const codeOf = (p: string) =>
    read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");

  it("¥つきの金額リテラルがコードに無い", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      // "¥3,000" や "¥3000" のような、そのまま画面に出る金額
      for (const m of codeOf(f).matchAll(/¥\s?[0-9][0-9,]*/g)) {
        // formatYen の中のテンプレート（`¥${...}`）は除く
        if (m[0].trim() === "¥") continue;
        offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      "金額がコードに直書きされています。tenants.trial_price_yen から出してください:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("マイグレーションが特定ジムの金額を入れていない", () => {
    // 入れ物だけを作る。値は本番で個別に入れる。
    const sql = read(MIGRATION);
    expect(sql, "マイグレーションで金額を UPDATE しています").not.toMatch(/UPDATE\s+public\.tenants[\s\S]{0,200}trial_price_yen/i);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS trial_price_yen");
  });
});

describe("「無料体験」の呼称が復活していない", () => {
  it("ロケールに無料体験の文言が無い", () => {
    const offenders: string[] = [];
    for (const loc of LOCALES) {
      const raw = read(`src/locales/${loc}.json`);
      for (const word of ["無料体験", "Free First", "Free Trial", "무료 체험", "免费体验", "免費體驗"]) {
        if (raw.includes(word)) offenders.push(`${loc}: ${word}`);
      }
    }
    expect(
      offenders,
      "体験を有料化したのに「無料体験」の文言が残っています:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("メールのテンプレートが「無料」と言っていない", () => {
    for (const f of [CONFIRM_TPL, REMIND_TPL]) {
      const src = read(f);
      // 「ウェア・シューズは無料でレンタル」は設備の話なので対象外。
      // 体験そのものを無料と呼んでいないかを見る。
      expect(src, `${f} が体験を無料と呼んでいます`).not.toContain("無料体験");
    }
  });

  it("ページ見出しがテナントで分岐していない", () => {
    // 2026-08-08 まで既定テナントだけ「初回無料体験」を出していた分岐。
    const src = read(TRIAL_PAGE);
    expect(src).not.toContain("headerTitleFreeTrial");
    expect(src).toMatch(/const headerTitle = t\("trialBooking\.headerTitle"\)/);
  });
});

describe("🔴 DBの内部キー『初回無料体験』は改名していない", () => {
  // これは**表示文字列ではなくキー**。bookings.booking_type の既定値で、
  // 突き合わせに使われている。改名すると既存行と一致しなくなる。
  const KEY = "初回無料体験";
  const KEY_USERS = [
    "src/components/customer/PlanUsageCard.tsx",
    "src/components/customer/CustomerHome.tsx",
    "src/components/customer/CustomerMonthlyReport.tsx",
  ];

  it("キーとして使っている箇所が今も同じ文字列を見ている", () => {
    for (const f of KEY_USERS) {
      expect(
        read(f),
        `${f} が内部キー「${KEY}」を見なくなっています。` +
          "DBの既存行は今もこの値なので、突き合わせが黙って外れます",
      ).toContain(KEY);
    }
  });

  it("DBの既定値を変えていない", () => {
    // マイグレーションで booking_type の既定を書き換えていないこと
    const sql = read(MIGRATION);
    expect(sql).not.toMatch(/ALTER\s+COLUMN\s+booking_type/i);
  });
});

describe("🔴 isFreeTrial の二役を戻していない（手ぶらOKが消える）", () => {
  // isFreeTrial は「無料と呼ぶ」と「Saluteの設備案内を出す」を兼ねていた。
  // 素直に消すとリマインドから「手ぶらでOK」が消える（変更しない約束のもの）。
  const remind = read(REMIND_TPL);

  it("設備案内のブロックが残っていて、中身が空でない", () => {
    // ⚠️ **文言そのものを断言しない。** このメールテンプレートは i18n を通さない
    //    日本語直書きで、フォークは自分のジムの設備に書き換える。
    //    リテラルで固定すると、正しく書き換えたフォークで落ちる
    //    （src/test/forkHostileTests.test.ts が実際にこれを検出した）。
    //    ここで守りたいのは「ブロックごと消えていないこと」なので、構造で見る。
    const start = remind.indexOf("{showAmenities && (");
    expect(start, "設備案内のブロックが消えています").toBeGreaterThan(-1);
    const block = remind.slice(start, remind.indexOf("\n          )}", start));
    expect(block, "設備案内のブロックが空になっています").toMatch(/<SafeText[\s\S]*<\/SafeText>/);
    // 箇条書きが2行とも消えていないか（1行だけ残して片方消す事故を捕まえる）
    expect((block.match(/<SafeText style=\{text\}>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("設備案内は showAmenities で出し分けている（料金と無関係）", () => {
    expect(remind).toContain("showAmenities");
    expect(remind, "料金のフラグで設備案内を出し分けています").not.toMatch(/\{trialPriceYen && \(/);
  });

  it("呼び出し元が showAmenities を渡している", () => {
    expect(read(REMINDERS_FN)).toMatch(/showAmenities:/);
  });
});

describe("料金がテナントから配線されている", () => {
  it("get_tenant_public が料金を返す（未ログインの予約ページ用）", () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/RETURNS TABLE[\s\S]*trial_price_yen integer/);
    expect(sql).toMatch(/t\.trial_price_yen/);
  });

  it("🔴 DROP した get_tenant_public に anon の EXECUTE を戻している", () => {
    // 戻り値の型が変わるので DROP+CREATE になる。ACL が消えるので再付与が要る。
    // 忘れると**未ログインの体験予約ページが真っ白になる。**
    const sql = read(MIGRATION);
    const dropIdx = sql.indexOf("DROP FUNCTION IF EXISTS public.get_tenant_public");
    const grantIdx = sql.indexOf("GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon");
    expect(dropIdx, "DROP が見つかりません").toBeGreaterThan(-1);
    expect(
      grantIdx,
      "DROP したのに anon へ GRANT し直していません。未ログインの予約ページが真っ白になります",
    ).toBeGreaterThan(dropIdx);
  });

  it("メールの呼び出し元が料金を渡している", () => {
    expect(read(TRIAL_BOOK_FN)).toMatch(/trialPriceYen/);
    expect(read(REMINDERS_FN)).toMatch(/trialPriceYen:/);
    // tenants から実際に読んでいること（渡し忘れの空振り防止）
    expect(read(TRIAL_BOOK_FN)).toMatch(/select\([^)]*trial_price_yen/);
    expect(read(REMINDERS_FN)).toMatch(/select\('[^']*trial_price_yen/);
  });
});

describe("ロケールの取りこぼしが無い", () => {
  const KEYS: Array<[string, string[]]> = [
    ["trialBooking", ["headerTitle", "priceLabel", "taxIncluded"]],
    ["settings.trainer", ["trialPriceSection", "trialPriceDesc", "trialPriceLabel",
                          "trialPricePlaceholder", "trialPriceUnset", "trialPriceSaved",
                          "trialPriceSaveFailed", "trialPriceInvalid"]],
    ["trialFollowUp", ["feeLabel", "feeHint", "feeUpdated", "feeUpdateFailed"]],
  ];

  it("5言語すべてに新しいキーがある", () => {
    const missing: string[] = [];
    for (const loc of LOCALES) {
      const d = JSON.parse(read(`src/locales/${loc}.json`));
      for (const [path, keys] of KEYS) {
        const node = path.split(".").reduce<any>((o, k) => o?.[k], d);
        for (const k of keys) {
          if (!node?.[k]) missing.push(`${loc}: ${path}.${k}`);
        }
      }
      const fee = d.trialFollowUp?.feeStatus;
      for (const k of ["unset", "pending", "collected", "waived"]) {
        if (!fee?.[k]) missing.push(`${loc}: trialFollowUp.feeStatus.${k}`);
      }
    }
    expect(missing, "翻訳の取りこぼし:\n  " + missing.join("\n  ")).toEqual([]);
  });

  it("使わなくなったキーを消してある（空振り防止）", () => {
    for (const loc of LOCALES) {
      const d = JSON.parse(read(`src/locales/${loc}.json`));
      expect(d.trialBooking?.headerTitleFreeTrial, `${loc} に headerTitleFreeTrial が残っています`).toBeUndefined();
      expect(d.trialBooking?.trialPlanName, `${loc} に trialPlanName が残っています`).toBeUndefined();
    }
  });
});

describe("マイグレーションが安全に書けている", () => {
  const sql = read(MIGRATION);

  it("列追加が冪等（IF NOT EXISTS）", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS trial_price_yen");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS trial_fee_status");
  });

  it("制約の追加も二度流して落ちない", () => {
    // ADD CONSTRAINT に IF NOT EXISTS が無いので、pg_constraint を見てから足す
    expect(sql).toMatch(/FROM pg_constraint WHERE conname = 'tenants_trial_price_yen_range'/);
    expect(sql).toMatch(/FROM pg_constraint WHERE conname = 'trial_bookings_trial_fee_status_check'/);
  });

  it("徴収状態の値がコード側と一致している", () => {
    const ui = read("src/components/trainer/TrainerTrialFollowUps.tsx");
    for (const v of ["未確認", "頂いた", "入会のため免除"]) {
      expect(sql, `SQL の CHECK に ${v} がありません`).toContain(`'${v}'`);
      expect(ui, `画面側に ${v} がありません`).toContain(`"${v}"`);
    }
  });

  it("ファイル名が既存より後になっている（適用順）", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(files[files.length - 1]).toBe("20260808000000_trial_price.sql");
  });
});
