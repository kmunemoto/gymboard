import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TENANT_VALUE_DEFAULTS, normalizeTenantRow, tenantOptionalColumnNames } from "@/lib/tenantColumns";

// キャンセルポリシーの検査（2026-08-08）。
//
// ── 調べて分かったこと ────────────────────────────────────────
// 「ペナルティなしに変更してほしい」という依頼だったが、**解除する設定はほぼ無かった。**
//
//   キャンセル料の仕組み     … 存在しない
//   キャンセル期限の仕組み   … 存在しない（キャンセルはいつでも可能）
//   無断キャンセルの仕組み   … 存在しない
//   当日キャンセルの消化扱い … tenants.same_day_cancel_penalty_enabled で切替可
//                              （Salute御所南はもともと false）
//
// 足りなかったのは「ペナルティが無いとお客様に伝える場所」。
// そこで tenants.cancel_policy_body を足した。
//
// ⚠️ **既定文を持たせないこと。** ペナルティの有無は店ごとに違うので、
//    上流が代弁すると事実と食い違う。空欄なら何も表示しない。
//
// ⚠️ 「前日まで」という文言は本文中にあるが、あれは**予約の締切**であって
//    キャンセル期限ではない。混同して booking_cutoff を消さないこと。
//
// ── 変異テスト（2026-08-08 実施・5件とも赤を確認）────────────────
//   1. 既定文（フォールバック文言）を入れる            → 赤
//   2. 空欄でもポリシー欄を描画する                    → 赤
//   3. キャンセル確認からポリシー表示を消す            → 赤
//   4. tenantColumns への登録を消す                    → 赤
//   5. 中国語（簡体）の翻訳を落とす                    → 赤

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
const MIGRATION = "supabase/migrations/20260808010000_cancel_policy.sql";
const BOOKING = "src/components/customer/CustomerBooking.tsx";
const SETTINGS = "src/components/trainer/TrainerGymSettings.tsx";

const read = (p: string) => readFileSync(p, "utf8");

describe("キャンセルポリシーはジムごとの設定", () => {
  it("tenantColumns に登録されている（列が読めない環境でも落ちない）", () => {
    expect(tenantOptionalColumnNames()).toContain("cancel_policy_body");
  });

  it("🔴 既定値が null（＝何も表示しない）", () => {
    // ここに文章を入れると、設定していない全ジムにその文言が出る。
    // ペナルティの有無は店ごとに違うので、上流が代弁してはいけない。
    expect(TENANT_VALUE_DEFAULTS.cancel_policy_body).toBeNull();
    expect(normalizeTenantRow({}).cancel_policy_body).toBeNull();
    expect(normalizeTenantRow({ cancel_policy_body: "自由文" }).cancel_policy_body).toBe("自由文");
  });

  it("マイグレーションが特定ジムの文面を入れていない", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS cancel_policy_body");
    expect(
      sql,
      "マイグレーションで文面を UPDATE しています。文面は店ごとの判断なので本番で個別に入れること",
    ).not.toMatch(/UPDATE\s+public\.tenants[\s\S]{0,200}cancel_policy_body/i);
  });

  it("制約の追加を二度流しても落ちない", () => {
    expect(read(MIGRATION)).toMatch(/FROM pg_constraint WHERE conname = 'tenants_cancel_policy_body_len'/);
  });
});

describe("お客様側の表示", () => {
  const src = read(BOOKING);

  it("空欄なら何も出さない（既定文にフォールバックしない）", () => {
    // `|| t("...")` のようなフォールバックがあると、設定していないジムにも文章が出る
    expect(src).toMatch(/cancel_policy_body\?\.trim\(\) \|\| ""/);
    expect(
      src,
      "cancel_policy_body に既定文言のフォールバックが付いています",
    ).not.toMatch(/cancel_policy_body[^\n]*\|\|\s*t\(/);
  });

  it("予約画面とキャンセル確認の両方に出している", () => {
    // 予約する前に読めることと、キャンセルする瞬間に読めることの両方が要る
    const uses = [...src.matchAll(/\{cancelPolicy && \(|\{!forfeitPending && cancelPolicy && \(/g)];
    expect(uses.length, "cancelPolicy の表示箇所が2つありません").toBeGreaterThanOrEqual(2);
  });

  it("ペナルティ警告が出ているときは、そちらを優先する", () => {
    // 「1回分消化になります」と「ペナルティはありません」が同時に出ると矛盾する
    expect(src).toMatch(/!forfeitPending && cancelPolicy/);
  });

  it("改行を保持して表示している", () => {
    // 3行の箇条書きが1行に潰れると読めない
    const idx = src.indexOf("{cancelPolicy}");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, idx - 400), idx)).toContain("whitespace-pre-line");
  });
});

describe("ジム側の設定UI", () => {
  const src = read(SETTINGS);

  it("入力欄と保存がある", () => {
    expect(src).toContain("handleSaveCancelPolicy");
    expect(src).toContain('id="cancel-policy"');
  });

  it("空欄は NULL で保存する（既定文に落とさない）", () => {
    expect(src).toMatch(/cancel_policy_body: body \|\| null/);
  });

  it("DBの CHECK と同じ上限にしている", () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/char_length\(cancel_policy_body\) <= 500/);
    const i = src.indexOf('id="cancel-policy"');
    expect(src.slice(i, i + 400)).toMatch(/maxLength=\{500\}/);
  });
});

describe("予約の締切（前日まで）と混同していない", () => {
  it("キャンセルポリシーの追加で booking_cutoff を触っていない", () => {
    // 「前日まで」は**いつまでに予約できるか**であって、キャンセル期限ではない。
    // キャンセルを自由にする話と混ぜて消すと、当日予約が通るようになってしまう。
    //
    // ⚠️ コメントは落としてから見る。マイグレーションの冒頭で
    //    「booking_cutoff とは別物」と**説明している**ため、生のまま grep すると
    //    その説明文に反応してしまう（最初そうなって落ちた）。
    const sql = read(MIGRATION)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--[^\n]*/g, "");
    expect(sql, "キャンセルの変更で予約締切を触っています").not.toMatch(/booking_cutoff/);
  });
});

describe("ロケールの取りこぼしが無い", () => {
  it("5言語すべてにキーがある", () => {
    const missing: string[] = [];
    for (const loc of LOCALES) {
      const d = JSON.parse(read(`src/locales/${loc}.json`));
      if (!d.booking?.cancelPolicyTitle) missing.push(`${loc}: booking.cancelPolicyTitle`);
      for (const k of ["cancelPolicyTitle", "cancelPolicyDesc", "cancelPolicyPlaceholder",
                       "cancelPolicyUnset", "cancelPolicySaved", "cancelPolicySaveFailed"]) {
        if (!d.settings?.trainer?.[k]) missing.push(`${loc}: settings.trainer.${k}`);
      }
    }
    expect(missing, "翻訳の取りこぼし:\n  " + missing.join("\n  ")).toEqual([]);
  });

  it("🔴 ロケールに既定のポリシー文を置いていない", () => {
    // プレースホルダ（入力例）はよいが、**実際に表示される既定文**を置くと
    // 設定していないジムに勝手な約束をさせることになる。
    for (const loc of LOCALES) {
      const d = JSON.parse(read(`src/locales/${loc}.json`));
      expect(
        d.booking?.cancelPolicyBody,
        `${loc} に既定のポリシー本文があります。店ごとに方針が違うので持たせないこと`,
      ).toBeUndefined();
    }
  });
});
