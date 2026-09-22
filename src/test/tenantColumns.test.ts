import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  TENANT_BASE_COLS,
  TENANT_COL_VARIANTS,
  TENANT_DEFAULT_FALSE_COLS,
  TENANT_DEFAULT_TRUE_COLS,
  TENANT_OPTIONAL_COL_GROUPS,
  TENANT_VALUE_DEFAULTS,
  normalizeTenantRow,
  tenantOptionalColumnNames,
} from "@/lib/tenantColumns";
import {
  DASHBOARD_SECTION_TOGGLES,
  DASHBOARD_STAT_TOGGLES,
  NAV_TAB_TOGGLES,
} from "@/lib/gymDisplaySettings";

const cols = (variant: string) => variant.split(",").map((c) => c.trim());

/**
 * `Tenant` 型（`src/lib/tenantTypes.ts`）が宣言しているフィールド名。
 *
 * 🔴 型に足しただけで select に足し忘れると、**その値は永遠に undefined になる**。
 * 画面は既定値（OFF）を出し続けるので「設定したのに反映されない」ように見える。
 */
const tenantInterfaceFields = (): string[] => {
  const src = readFileSync("src/lib/tenantTypes.ts", "utf8");
  const m = /export interface Tenant \{([\s\S]*?)\n\}/.exec(src);
  expect(m, "Tenant インターフェースが読めない").not.toBeNull();
  return [...m![1].matchAll(/^ {2}([a-z_][a-z0-9_]*)\??:/gm)].map((x) => x[1]);
};

// ────────────────────────────────────────────────────────────────
// 🔴 2026-09-22: 型に足して select に足し忘れ、本番で実害が出た
//
// 「次回分の入金まで次回分の予約を受け付けない」の設定を入れたとき、
// `Tenant` 型と設定画面とマイグレーションは揃っていたのに、
// **`TENANT_OPTIONAL_COL_GROUPS` に足すのを忘れていた。**
//
// 症状がたちが悪い:
//   - スイッチを押すと DB は**本当に更新される**（トーストも「保存しました」と出る）
//   - しかし読み直した tenant にその列が無いので、スイッチは **OFF のまま戻る**
//   - 店主には「ONにできない」としか見えない。実際には**ONになっている**
//   - 同じ列を見ているカルテのスイッチも出ないので、**解除する手段も無い**
//
// 本番では在籍39人中38人に予約制限がかかり、翌日から12人が予約できない状態だった
// （気づいて即 OFF に戻した。`mem/features/next-cycle-payment.md`）。
//
// tenantColumns.ts の冒頭コメントは「書き漏らすと『設定画面には出るのに読めない』
// というズレが静かに入る」と**まさにこれを警告していた**が、
// 見張るテストが無かったので静かに入った。ここで塞ぐ。
// ────────────────────────────────────────────────────────────────

describe("🔴 Tenant 型と取得カラムが揃っている", () => {
  /**
   * 型にはあるが、**わざと**一括の select に入れないもの。理由を書くこと。
   * ⚠️ 「面倒だから」で足さない。足した時点で、その値は画面から読めなくなる。
   */
  const INTENTIONALLY_NOT_SELECTED: Record<string, string> = {
    invite_code:
      "招待コードは専用の RPC（get_my_tenant_invite_code など）で読む。" +
      "全画面が引く tenant に混ぜると、必要のない画面にも配ってしまう",
  };

  it("型が宣言したカラムは、すべて select に入っている", () => {
    const selected = new Set(cols(TENANT_COL_VARIANTS[0]));
    const missing = tenantInterfaceFields()
      .filter((f) => !selected.has(f))
      .filter((f) => !(f in INTENTIONALLY_NOT_SELECTED));
    expect(
      missing,
      "Tenant 型にあるのに select に無いカラムです。**この値は永遠に undefined になります**"
        + "（設定しても画面は既定値のまま＝「ONにできない」に見える）。"
        + `TENANT_OPTIONAL_COL_GROUPS の末尾に足してください: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("走査が空振りしていない", () => {
    // 型の書き方を変えて 0 件になったら、この検査は黙って無意味になる
    expect(tenantInterfaceFields().length).toBeGreaterThan(40);
    expect(tenantInterfaceFields()).toContain("gym_name");
  });

  it("例外にした理由が書かれている", () => {
    for (const [col, why] of Object.entries(INTENTIONALLY_NOT_SELECTED)) {
      expect(why.length, `${col} の理由が短すぎます`).toBeGreaterThan(20);
    }
  });
});

describe("tenants の取得カラム定義", () => {
  it("フォールバック段はグループ数+1（全部入り〜基本のみ）", () => {
    expect(TENANT_COL_VARIANTS).toHaveLength(TENANT_OPTIONAL_COL_GROUPS.length + 1);
    expect(TENANT_COL_VARIANTS[0]).toContain(TENANT_OPTIONAL_COL_GROUPS.at(-1));
    expect(TENANT_COL_VARIANTS.at(-1)).toBe(TENANT_BASE_COLS);
  });

  it("段が下がるほどカラムが単調に減り、基本カラムは常に残る", () => {
    const baseCols = cols(TENANT_BASE_COLS);
    let prev = Infinity;
    for (const variant of TENANT_COL_VARIANTS) {
      const list = cols(variant);
      expect(list.length).toBeLessThan(prev);
      prev = list.length;
      // 1段落ちても基本カラムだけは必ず取れる（tenant 自体が読めなくなる事故を防ぐ）
      for (const c of baseCols) expect(list).toContain(c);
    }
  });

  it("同じカラムを2度 select していない", () => {
    const all = cols(TENANT_COL_VARIANTS[0]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("後から足した全カラムに既定値が定義されている", () => {
    // ここが落ちる = select に足したのに、列が無い環境での既定値を決め忘れている。
    // 未適用環境で undefined のまま画面に流れ込み、トグルが不定な見え方になる。
    const covered = new Set([
      ...TENANT_DEFAULT_TRUE_COLS,
      ...TENANT_DEFAULT_FALSE_COLS,
      ...Object.keys(TENANT_VALUE_DEFAULTS),
    ]);
    // 例外: 「列が読めない(undefined)」と「未設定(null)」を区別する必要がある列。
    // 既定値を与えると両者が潰れてしまうため、あえて定義しない。
    const INTENTIONALLY_NO_DEFAULT: Record<string, string> = {
      booking_capacity_confirmed_at:
        "undefined=列が読めない / null=店にまだ聞いていない、を区別する。既定値を入れると保存できない環境で聞き続けてしまう",
    };
    const missing = tenantOptionalColumnNames()
      .filter((c) => !covered.has(c))
      .filter((c) => !(c in INTENTIONALLY_NO_DEFAULT));
    expect(missing, `既定値が未定義: ${missing.join(", ")}`).toEqual([]);
  });

  it("既定値の定義が重複していない", () => {
    const all = [
      ...TENANT_DEFAULT_TRUE_COLS,
      ...TENANT_DEFAULT_FALSE_COLS,
      ...Object.keys(TENANT_VALUE_DEFAULTS),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("既定値を定義したカラムは必ず select にも入っている", () => {
    const selected = new Set(cols(TENANT_COL_VARIANTS[0]));
    const orphans = [
      ...TENANT_DEFAULT_TRUE_COLS,
      ...TENANT_DEFAULT_FALSE_COLS,
      ...Object.keys(TENANT_VALUE_DEFAULTS),
    ].filter((c) => !selected.has(c));
    expect(orphans, `select に無いのに既定値だけある: ${orphans.join(", ")}`).toEqual([]);
  });

  it("表示ON/OFFトグルの全カラムが select に含まれ、既定は表示側に倒れている", () => {
    // gymDisplaySettings（設定画面と描画側が参照する定義）と select のズレ防止。
    // 落ちる = 設定画面にトグルは出るのに値が読めない、あるいは
    // 未適用環境でその機能が既定OFFになって消える。
    const selected = new Set(cols(TENANT_COL_VARIANTS[0]));
    const defaultTrue = new Set(TENANT_DEFAULT_TRUE_COLS);
    const toggles = [...DASHBOARD_STAT_TOGGLES, ...DASHBOARD_SECTION_TOGGLES, ...NAV_TAB_TOGGLES];
    expect(toggles.length).toBeGreaterThan(0);
    for (const t of toggles) {
      expect(selected, `${t.column} が select に無い`).toContain(t.column);
      expect(defaultTrue, `${t.column} の既定が表示側でない`).toContain(t.column);
    }
  });
});

describe("normalizeTenantRow（列が読めなかったときの穴埋め）", () => {
  it("列が1つも無くても、表示系は全て表示・お客様不利な設定はOFFで返る", () => {
    const out = normalizeTenantRow({ id: "t1", gym_name: "テストジム" });
    for (const c of TENANT_DEFAULT_TRUE_COLS) expect(out[c], c).toBe(true);
    for (const c of TENANT_DEFAULT_FALSE_COLS) expect(out[c], c).toBe(false);
    expect(out.booking_buffer_minutes).toBe(15);
    expect(out.line_url).toBeNull();
    expect(out.id).toBe("t1");
    expect(out.gym_name).toBe("テストジム");
  });

  it("明示的な false のときだけ非表示になる（null / undefined は表示のまま）", () => {
    expect(normalizeTenantRow({ show_nav_messages: false }).show_nav_messages).toBe(false);
    expect(normalizeTenantRow({ show_nav_messages: null }).show_nav_messages).toBe(true);
    expect(normalizeTenantRow({}).show_nav_messages).toBe(true);
  });

  it("同日キャンセルの自動消化は明示的な true のときだけ有効", () => {
    // お客様に不利益が及ぶ設定なので、読めなかった場合は必ずOFFに倒す
    expect(normalizeTenantRow({ same_day_cancel_penalty_enabled: true }).same_day_cancel_penalty_enabled).toBe(true);
    expect(normalizeTenantRow({ same_day_cancel_penalty_enabled: null }).same_day_cancel_penalty_enabled).toBe(false);
    expect(normalizeTenantRow({}).same_day_cancel_penalty_enabled).toBe(false);
  });

  it("0 を既定値で上書きしない（?? を使っているため）", () => {
    // buffer を「0分」に設定したジムが 15分に戻されると、予約枠が実際より詰まらなくなる
    expect(normalizeTenantRow({ booking_buffer_minutes: 0 }).booking_buffer_minutes).toBe(0);
  });

  it("元の行を書き換えない", () => {
    const raw: Record<string, unknown> = { id: "t1" };
    normalizeTenantRow(raw);
    expect(raw).toEqual({ id: "t1" });
  });
});
