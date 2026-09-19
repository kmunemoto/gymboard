import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { TENANT_VALUE_DEFAULTS, tenantOptionalColumnNames } from "@/lib/tenantColumns";

// ────────────────────────────────────────────────────────────────
// 体験予約サイト（/trial）で「会員の方はアプリからご予約ください」と案内する
// （2026-09-19 宗本さんの要望）
//
// > すでに会員でアプリのアカウントもある方が、体験予約サイトから予約してしまう。
// > 直接は言いにくいので、体験予約サイトからは予約できないようにして、
// > アプリから予約するよう案内を出したい。
// > **これは私のジムだけ。予約システムには影響を与えず、指定した単語並びのみ。**
//
// 🔴 この機能でいちばん怖いのは2つ。どちらも**静かに起きる**。
//
//   1. お名前（実名）がリポジトリや公開ページに漏れる。
//      このリポジトリは public。コードに書けばインターネットに公開される。
//      判定を画面側でやれば、単語リストをブラウザに送ることになり同じこと。
//   2. 判定が広がって、**関係のない新規のお客様が予約できなくなる**。
//      空文字の単語1つで全員が当たる。他テナント・会員予約・ドロップインに
//      にじめば「予約システムに影響を与えない」という約束が壊れる。
// ────────────────────────────────────────────────────────────────

const readCode = (path: string) => readFileSync(path, "utf8");

/**
 * コメントを落としてから見る。
 *
 * 🔴 この型の番人は過去5回、説明のコメントに当たって**実コードを1行も見ないまま
 *    緑になりかけた**（`min_version` / `dangerouslySetInnerHTML` / `url.includes("//kb")` /
 *    `NEW.booking_kind` / `overlapping.length >=`）。
 *    このファイルは「この時間帯を含めないこと」と**コメントに書いてある**ので、
 *    素の toContain だと必ず空振りする。
 */
const stripComments = (src: string): string =>
  src.replace(/^\s*(--|\*|\/\/|\/\*).*$/gm, "");

const MIGRATION = "supabase/migrations/20260919010000_trial_app_only_names.sql";
const TRIAL = "src/pages/TrialBooking.tsx";
const DROPIN = "src/pages/DropInBooking.tsx";
const DIALOG = "src/components/booking/TrialAppOnlyDialog.tsx";
const CARD = "src/components/trainer/TrialAppOnlyNamesCard.tsx";

const COL = "trial_app_only_names";
const RPC = "trial_name_needs_app";

const sql = stripComments(readCode(MIGRATION));

describe("🔴 お名前をリポジトリに置いていないこと", () => {
  it("migration が単語を1つも入れていない（値は本番DBにだけ置く）", () => {
    // ここで値を入れると、実名がコミット履歴に残る。squash-merge 運用では消せない
    expect(sql).not.toMatch(new RegExp(`UPDATE\\s+public\\.tenants[\\s\\S]{0,300}${COL}`, "i"));
    expect(sql).not.toMatch(new RegExp(`${COL}\\s*=\\s*ARRAY`, "i"));
    // 既定は空配列。ここに単語を書くと全テナントに効いてしまう
    expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${COL} text\\[\\] NOT NULL DEFAULT '\\{\\}'`));
  });

  it("特定テナントのIDがコードに出てこない（他店に効かせない仕組みは列で持つ）", () => {
    for (const f of [MIGRATION, TRIAL, DIALOG, CARD]) {
      expect(readCode(f), f).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    }
  });
});

describe("🔴 単語リストを公開ページに配らないこと", () => {
  it("どの migration も get_tenant_public でこの列を返していない", () => {
    // ここに足すと、体験予約ページを開いた全員がリストを読める（＝実名の公開）。
    // ⚠️ 見るのは**関数の定義そのもの**だけ。ファイル全体だと COMMENT ON COLUMN の
    //    説明文（「get_tenant_public では返さない」）に当たって空振りする。
    let seen = 0;
    for (const f of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql"))) {
      const body = stripComments(readCode(`supabase/migrations/${f}`));
      for (const def of body.matchAll(
        /CREATE OR REPLACE FUNCTION public\.get_tenant_public\([\s\S]*?\$function\$[\s\S]*?\$function\$/g,
      )) {
        seen += 1;
        expect(def[0], f).not.toContain(COL);
      }
    }
    // 検査が空振りしていないこと（関数の書き方が変わったら気づけるように）
    expect(seen).toBeGreaterThan(0);
  });

  it("公開ページは列を読まず、判定用の RPC だけを呼んでいる", () => {
    const code = stripComments(readCode(TRIAL));
    expect(code).not.toContain(COL);
    expect(code).toContain(`supabase.rpc("${RPC}"`);
  });

  it("案内のダイアログも列を持っていない", () => {
    expect(stripComments(readCode(DIALOG))).not.toContain(COL);
  });

  it("RPC は boolean だけを返す（当たった単語も件数も返さない）", () => {
    expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${RPC}\\(p_tenant_id uuid, p_name text\\)\\s*\\n\\s*RETURNS boolean`));
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${RPC}\\(uuid, text\\) TO anon`));
  });
});

describe("🔴 関係のないお客様を弾かないこと", () => {
  it("空の単語を無視している（1件あると全員が当たる）", () => {
    expect(sql).toMatch(new RegExp(`public\\.normalize_name_for_match\\(kw\\) <> ''`));
  });

  it("判定が読めなかったら予約を通す（画面側）", () => {
    // 通信の失敗で新規のお客様を断るほうが実害が大きい
    expect(stripComments(readCode(TRIAL))).toMatch(/if \(!nameErr && needsApp === true\)/);
  });

  it("判定が落ちたら予約を通す（DB側）", () => {
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]{0,80}RETURN NEW;/);
  });

  it("列が読めない環境では「登録なし」に倒す", () => {
    expect(tenantOptionalColumnNames()).toContain(COL);
    expect(TENANT_VALUE_DEFAULTS[COL]).toBeNull();
  });
});

describe("🔴 予約システムの他の経路に影響しないこと", () => {
  it("トリガーは trial_bookings にだけ付いている", () => {
    expect(sql).toMatch(/CREATE TRIGGER enforce_trial_app_only_names\s*\n\s*BEFORE INSERT ON public\.trial_bookings/);
    expect(sql).not.toMatch(/ON public\.bookings/);
  });

  it("ドロップインを除いている（体験と同じテーブルに同居）", () => {
    expect(sql).toMatch(/booking_kind', 'trial'\) <> 'trial'/);
  });

  it("bookings に無い列を NEW から直接読んでいない", () => {
    expect(sql).not.toMatch(/NEW\.booking_kind/);
  });

  it("ドロップインの画面はこの仕組みを見ていない", () => {
    const code = stripComments(readCode(DROPIN));
    expect(code).not.toContain(COL);
    expect(code).not.toContain(RPC);
  });

  it("会員側の予約導線に手を入れていない", () => {
    for (const f of [
      "src/hooks/useBookings.ts",
      "src/components/customer/CustomerBooking.tsx",
      "supabase/functions/trial-book/index.ts",
    ]) {
      const code = stripComments(readCode(f));
      expect(code, f).not.toContain(COL);
      expect(code, f).not.toContain(RPC);
    }
  });

  it("🔴 断りの文面が満枠の文面と取り違えられない", () => {
    // trial-book は insert のエラー文に「この時間帯」が入っていると slot_taken と判定し、
    // 「別の時間をお選びください」と案内してしまう（アプリへの案内にならない）
    const raise = /RAISE EXCEPTION '([^']+)'/g;
    const messages = [...sql.matchAll(raise)].map((m) => m[1]);
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) expect(m).not.toContain("この時間帯");
  });
});

describe("案内の画面", () => {
  it("アプリのリンク（ストア）へ飛ばしている", () => {
    const code = readCode(DIALOG);
    expect(code).toContain("STORE_URLS.ios");
    expect(code).toContain("STORE_URLS.android");
    // URL が空のフォークでは押しても何も起きないボタンを出さない
    expect(code).toMatch(/\{STORE_URLS\.ios && \(/);
    expect(code).toMatch(/\{STORE_URLS\.android && \(/);
  });

  it("必ず閉じられる（人違い・同姓のときに詰ませない）", () => {
    expect(readCode(DIALOG)).toContain('data-testid="trial-app-only-close"');
  });

  it("予約を作らずに出す（案内したら送信しない）", () => {
    const code = stripComments(readCode(TRIAL));
    const guide = code.indexOf("setShowAppOnly(true);");
    const invoke = code.indexOf('supabase.functions.invoke("trial-book"');
    expect(guide).toBeGreaterThan(-1);
    expect(invoke).toBeGreaterThan(-1);
    expect(guide).toBeLessThan(invoke);
    // 案内したらそこで抜ける
    expect(code).toMatch(/setShowAppOnly\(true\);\s*\n\s*setSubmitting\(false\);\s*\n\s*return;/);
  });

  it("設定は店側の画面に置いてある", () => {
    expect(readCode("src/components/trainer/TrainerGymSettings.tsx"))
      .toContain("<TrialAppOnlyNamesCard />");
  });

  it("空白だけの単語を保存させない（DB側の防御と二重にする）", () => {
    expect(readCode(CARD)).toMatch(/const word = draft\.trim\(\);[\s\S]{0,300}if \(!word\) return;/);
  });

  for (const lng of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
    it(`${lng}: 文言がそろっている`, () => {
      const j = JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8"));
      for (const k of ["appOnlyTitle", "appOnlyBody", "appOnlyNote", "appOnlyIos", "appOnlyAndroid"]) {
        expect(typeof j.trialBooking[k], `${lng}.trialBooking.${k}`).toBe("string");
        expect(j.trialBooking[k].length, `${lng}.trialBooking.${k}`).toBeGreaterThan(0);
      }
      // ジム名は差し込みで出す（文言にジム名を焼き付けない）
      expect(j.trialBooking.appOnlyBody, lng).toContain("{{gym}}");
      for (const k of [
        "trialAppOnlySection", "trialAppOnlyLabel", "trialAppOnlyDesc", "trialAppOnlyPlaceholder",
        "trialAppOnlyAdd", "trialAppOnlyRemove", "trialAppOnlyWarning",
        "trialAppOnlySaved", "trialAppOnlySaveFailed",
        "trialAppOnlyTooLong", "trialAppOnlyTooMany",
      ]) {
        expect(typeof j.settings.trainer[k], `${lng}.settings.trainer.${k}`).toBe("string");
        expect(j.settings.trainer[k].length, `${lng}.settings.trainer.${k}`).toBeGreaterThan(0);
      }
    });
  }
});

describe("正規化（書き方の揺れを吸収する）", () => {
  it("NFKC → 空白と中黒の除去 → ひらがな→カタカナ → 小文字化 の順で書かれている", () => {
    // 順番が崩れると、全角スペースが残る／半角カナが揃わない等で静かに当たらなくなる
    const lower = sql.indexOf("SELECT lower(");
    const translate = sql.indexOf("translate(");
    const strip = sql.indexOf("regexp_replace(normalize(COALESCE(p_text, ''), NFKC), '[\\s・]', '', 'g')");
    expect(lower).toBeGreaterThan(-1);
    expect(translate).toBeGreaterThan(lower);
    expect(strip).toBeGreaterThan(translate);
  });

  it("ひらがなとカタカナの対応表が同じ長さ（1文字でもずれると別の字に化ける）", () => {
    const m = /translate\(\s*[\s\S]*?,\s*\n\s*'([ぁ-ゖ]+)',\s*\n\s*'([ァ-ヶ]+)'\s*\n\s*\)/.exec(sql);
    expect(m, "translate の対応表が読めない").not.toBeNull();
    expect([...m![1]].length).toBe([...m![2]].length);
  });

  it("部分一致で見ている（姓だけの登録で姓名にも当たる）", () => {
    expect(sql).toMatch(/strpos\(\s*\n?\s*public\.normalize_name_for_match\(p_name\),/);
  });
});
