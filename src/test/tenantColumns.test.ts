import { describe, it, expect } from "vitest";
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
