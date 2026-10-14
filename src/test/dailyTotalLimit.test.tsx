/**
 * 体験も含めた「1日の合計の上限」（tenants.daily_total_limit・2026-10-14）。
 *
 * 宗本さん「今、私のジムは一日4枠までしか取れませんが、体験の予約ではそれ以上取れます。
 * それを体験予約もその日がすでに5枠埋まっていれば体験予約も取れない様にしたい」。
 * 確認: 1. 会員も合計5で止める ／ 2. 「その日だけ上限を外す」日は合計の上限も外す。
 *
 * 🔴 壊しやすいもの:
 *   1. 体験のガードが「手で止めた日」まで止める（2026-09-19 に戻した決定を黙って覆す）
 *   2. 会員が合計の上限で止まらない（「合計5で止めます」）
 *   3. 上限を外した日に合計の上限が残る（「外します」）
 *   4. 画面と DB で数え方がずれる（空きに見えるのに断られる）
 *   5. 店側が入れる分まで止める／ドロップインまで止める（理由の出ない失敗になる）
 *   6. 体験予約ページが送信の直前に読み直さない（trial-book は GB007 を汎用の失敗にする）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import { TENANT_VALUE_DEFAULTS, normalizeTenantRow, tenantOptionalColumnNames } from "@/lib/tenantColumns";

const rpc = vi.fn();
const updates: unknown[] = [];
const tenantRef = { current: null as Record<string, unknown> | null };
const refetch = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      update: (v: unknown) => {
        updates.push(v);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  },
}));
vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ tenant: tenantRef.current, refetch }),
}));

const { useTrialFullDays } = await import("@/hooks/useTrialFullDays");

beforeEach(() => {
  rpc.mockReset();
  updates.length = 0;
  refetch.mockClear();
  tenantRef.current = { id: "t1", daily_booking_limit: 4, daily_total_limit: 5 };
});
afterEach(cleanup);

// ── DB ──────────────────────────────────────────────────────────────────
const MIG = "supabase/migrations/20261014010000_daily_total_limit.sql";
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const SQL = noComments(readFileSync(MIG, "utf8"));

/** `CREATE OR REPLACE FUNCTION public.<name>(` から、次の `$fn$;` までの本文 */
const fnBody = (sql: string, name: string): string => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) return "";
  const end = sql.indexOf("$fn$;", start);
  return sql.slice(start, end > 0 ? end : undefined);
};

/** その関数を最後に定義している migration の本文（後から古い形で上書きされていないかを見る） */
const latestDefinition = (name: string): { file: string; body: string } => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  let hit = { file: "", body: "" };
  for (const f of files) {
    const s = noComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
    const body = fnBody(s, name);
    if (body) hit = { file: f, body };
  }
  return hit;
};

describe("DB: 設定の列", () => {
  it("NULL 可・既定なし（NULL＝今まで通り）・1以上", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS daily_total_limit integer;/);
    expect(SQL).not.toMatch(/daily_total_limit integer\s+(NOT NULL|DEFAULT)/);
    expect(SQL).toMatch(/CHECK \(daily_total_limit IS NULL OR daily_total_limit >= 1\)/);
  });

  it("特定のジムの値を migration に書かない（リポジトリは public）", () => {
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(SQL).not.toMatch(/UPDATE\s+public\.tenants/i);
  });
});

describe("DB: 判定は tenant_day_total_reached の1か所", () => {
  const total = fnBody(SQL, "tenant_day_total_reached");
  const trials = fnBody(SQL, "tenant_day_trial_count");

  it("体験・ドロップインの件数は、会員と同じ形で数える（キャンセル済み以外・JST の日付）", () => {
    expect(trials).toContain("FROM public.trial_bookings x");
    expect(trials).toContain("x.status <> 'キャンセル済み'");
    expect(trials).toContain("(x.booking_date AT TIME ZONE 'Asia/Tokyo')::date = p_date");
    // ドロップインも数える（booking_kind で絞らない）
    expect(trials).not.toContain("booking_kind");
  });

  it("合計 = 会員の件数 + 体験の件数 >= 合計の上限", () => {
    expect(total).toContain("t.daily_total_limit");
    expect(total).toMatch(
      /public\.tenant_day_booking_count\(p_tenant_id, p_date, p_exclude_booking_id\)\s*\+ public\.tenant_day_trial_count\(p_tenant_id, p_date, p_exclude_trial_id\) >= v_total/,
    );
    expect(total).toMatch(/IF v_total IS NULL THEN\s+RETURN false;/);
  });

  it("🔴 上限を外した日は合計の上限も外す（宗本さん「外します」）", () => {
    expect(total).toContain("public.booking_uncapped_days");
    expect(total.indexOf("booking_uncapped_days")).toBeLessThan(total.indexOf("tenant_day_booking_count"));
  });

  it("🔴 手で止めた日はここでは見ない（体験は赤い日でも通る）", () => {
    expect(total).not.toContain("booking_closed_days");
  });

  it("内部用の関数は外から呼ばせない", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.tenant_day_trial_count\(uuid, date, uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.tenant_day_total_reached\(uuid, date, uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.guard_trial_booking_day_full\(\) FROM PUBLIC, anon, authenticated;/);
  });
});

describe("DB: 会員の自己予約（宗本さん「合計5で止めます」）", () => {
  const closed = fnBody(SQL, "tenant_day_closed");

  it("🔴 合計の上限でも止まる", () => {
    expect(closed).toContain("public.tenant_day_total_reached(p_tenant_id, p_date, p_exclude_booking_id, NULL)");
  });

  it("順番は今まで通り: 手で止めた日 → 上限を外した日 → 会員の上限 → 合計の上限", () => {
    const at = (s: string) => closed.indexOf(s);
    expect(at("booking_closed_days")).toBeGreaterThan(0);
    expect(at("booking_closed_days")).toBeLessThan(at("booking_uncapped_days"));
    expect(at("booking_uncapped_days")).toBeLessThan(at("t.daily_booking_limit"));
    expect(at("t.daily_booking_limit")).toBeLessThan(at("tenant_day_total_reached"));
  });

  it("引数の形を変えていない（会員のガードがこの形で呼んでいる）", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.tenant_day_closed\(uuid, date, uuid\) FROM PUBLIC, anon, authenticated;/);
  });
});

describe("DB: 体験予約のガード", () => {
  const guard = fnBody(SQL, "guard_trial_booking_day_full");

  it("trial_bookings の INSERT の前に、合計の上限で止める", () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_guard_trial_booking_day_full\s+BEFORE INSERT ON public\.trial_bookings/);
    expect(guard).toContain("public.tenant_day_total_reached(NEW.tenant_id,");
    expect(guard).toContain("ERRCODE = 'GB007'");
  });

  it("🔴 手で止めた日・会員の上限は見ない（2026-09-01 / 2026-09-19 の決定のまま）", () => {
    expect(guard).not.toContain("booking_closed_days");
    expect(guard).not.toContain("tenant_day_closed");
    expect(guard).not.toContain("daily_booking_limit");
  });

  it("店側（オーナー・トレーナー）が入れる分・取り込み・キャンセル済みは通す", () => {
    expect(guard).toMatch(/m\.role IN \('owner', 'trainer'\)/);
    expect(guard).toContain("salute_sync");
    expect(guard).toContain("NEW.status = 'キャンセル済み'");
  });

  it("ドロップインは止めない（ページがこの判定を見ていないので、止めると理由の出ない失敗になる）", () => {
    expect(guard).toMatch(/COALESCE\(to_jsonb\(NEW\) ->> 'booking_kind', 'trial'\) <> 'trial'/);
  });

  it("⚠️ 文面に「この時間帯」を入れない（trial-book が slot_taken と誤判定する）", () => {
    const raise = guard.slice(guard.indexOf("RAISE EXCEPTION"));
    expect(raise.slice(0, raise.indexOf(";"))).not.toContain("この時間帯");
  });
});

describe("DB: 画面へ届ける", () => {
  it("会員の予約カレンダー・予定表: 合計に達した日も「上限に達した日」として返す", () => {
    const body = fnBody(SQL, "get_tenant_closed_days");
    expect(body).toContain("public.tenant_day_total_reached(p_tenant_id, d.day, NULL, NULL)");
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_closed_days\(uuid, date, date\) TO anon, authenticated;/);
  });

  it("🔴 体験予約ページ用: 合計に達した日だけ（手で止めた日・会員の上限の日は返さない）", () => {
    const body = fnBody(SQL, "get_tenant_trial_closed_days");
    expect(body).toContain("public.tenant_day_total_reached(p_tenant_id, d::date, NULL, NULL)");
    expect(body).not.toContain("booking_closed_days");
    expect(body).not.toContain("daily_booking_limit");
    expect(body).toContain("t.daily_total_limit IS NOT NULL");
    expect(body).toContain("to_date > from_date + 92");
    // 未ログインで開くページなので anon に渡す
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_trial_closed_days\(uuid, date, date\) TO anon, authenticated;/);
  });

  it("残り枠: min(会員の上限 − 会員, 合計の上限 − 会員 − 体験)。自分のジムの会員だけ", () => {
    const body = fnBody(SQL, "get_tenant_daily_limit_left");
    expect(body).toContain("LEAST(");
    expect(body).toContain("v_total - public.tenant_day_booking_count(p_tenant_id, d::date)");
    expect(body).toContain("- public.tenant_day_trial_count(p_tenant_id, d::date)");
    expect(body).toMatch(/IF v_uid IS NULL OR NOT public\.is_tenant_member\(p_tenant_id, v_uid\) THEN\s+RETURN;/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.get_tenant_daily_limit_left\(uuid, date, date\) FROM PUBLIC, anon;/);
  });

  it("🔴 後の migration が古い形で上書きしていない（最後の定義が合計の上限を見ている）", () => {
    for (const name of ["tenant_day_closed", "get_tenant_closed_days", "get_tenant_daily_limit_left"]) {
      const { file, body } = latestDefinition(name);
      expect(body, `${name} の最後の定義（${file}）が合計の上限を見ていない`).toMatch(/tenant_day_total_reached|tenant_day_trial_count/);
    }
  });
});

// ── 体験予約ページ ───────────────────────────────────────────────────────
describe("useTrialFullDays（体験予約ページ）", () => {
  it("合計に達した日を返す。RPC にはジムと日付の範囲を渡す", async () => {
    rpc.mockResolvedValue({ data: [{ closed_date: "2026-10-15" }], error: null });
    const { result } = renderHook(() => useTrialFullDays(true, "t1"));
    await waitFor(() => expect(result.current.isFull("2026-10-15")).toBe(true));
    expect(result.current.isFull("2026-10-16")).toBe(false);
    expect(rpc).toHaveBeenCalledWith("get_tenant_trial_closed_days", expect.objectContaining({ p_tenant_id: "t1" }));
  });

  it("🔴 体験予約を出していない（フラグOFF）・ジムが分からないときは問い合わせない", async () => {
    renderHook(() => useTrialFullDays(false, "t1"));
    renderHook(() => useTrialFullDays(true, null));
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("🔴 読めなければ止めない（新規のお客様を断るほうが実害が大きい。最終判定は DB）", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const { result } = renderHook(() => useTrialFullDays(true, "t1"));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(result.current.isFull("2026-10-15")).toBe(false);
  });

  it("送信の直前に読み直す（開いている間に埋まった日を止める）", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useTrialFullDays(true, "t1"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    rpc.mockResolvedValueOnce({ data: [{ closed_date: "2026-10-15" }], error: null });
    await expect(result.current.recheck("2026-10-15")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("体験予約ページの配線", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
  const src = strip(readFileSync("src/pages/TrialBooking.tsx", "utf8"));

  it("カレンダーで合計に達した日を選べなくする", () => {
    expect(src).toContain("useTrialFullDays(TRIAL_BOOKING_ENABLED, effectiveTenantId)");
    expect(src).toContain("if (trialFullDays.isFull(yyyyMMdd)) return true;");
  });

  it("🔴 送信の直前（trial-book を呼ぶ前）に読み直す", () => {
    const recheck = src.indexOf("await trialFullDays.recheck(dateKey)");
    const invoke = src.indexOf('supabase.functions.invoke("trial-book"');
    expect(recheck).toBeGreaterThan(0);
    expect(recheck).toBeLessThan(invoke);
  });
});

// ── 設定画面 ─────────────────────────────────────────────────────────────
describe("設定（予約のルール → 1日の上限人数）", () => {
  const renderCard = async () => {
    const { default: TrainerDailyBookingLimit } = await import("@/components/trainer/TrainerDailyBookingLimit");
    return render(<TrainerDailyBookingLimit />);
  };

  it("会員の上限と、体験も含めた合計の上限の両方が出て、今の値が選ばれている", async () => {
    await renderCard();
    expect(screen.getByText(i18n.t("closedDays.totalLimitLabel"))).toBeTruthy();
    expect(screen.getByText(i18n.t("closedDays.limitUnit", { count: 4 }))).toBeTruthy();
    expect(screen.getByText(i18n.t("closedDays.limitUnit", { count: 5 }))).toBeTruthy();
  });

  it("保存すると2つとも書く", async () => {
    await renderCard();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));
    await waitFor(() => expect(updates).toEqual([{ daily_booking_limit: 4, daily_total_limit: 5 }]));
  });

  it("🔴 合計を設定していない店は『上限なし』のまま保存される（今まで通り）", async () => {
    tenantRef.current = { id: "t1", daily_booking_limit: 4, daily_total_limit: null };
    await renderCard();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));
    await waitFor(() => expect(updates).toEqual([{ daily_booking_limit: 4, daily_total_limit: null }]));
  });
});

describe("店の設定の読み込み（tenantColumns）", () => {
  it("取得する列に入っている。列が読めない環境の既定は『上限なし』（null）", () => {
    expect(tenantOptionalColumnNames()).toContain("daily_total_limit");
    expect(TENANT_VALUE_DEFAULTS.daily_total_limit).toBeNull();
    expect(normalizeTenantRow({ id: "t1" }).daily_total_limit).toBeNull();
  });
});

describe("説明文（5言語）", () => {
  const LANGS = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  it("合計の上限の文言が5言語そろっている", () => {
    for (const l of LANGS) {
      const c = JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8")).closedDays;
      expect(c.totalLimitLabel, `${l} totalLimitLabel`).toBeTruthy();
      expect(c.totalLimitDesc, `${l} totalLimitDesc`).toBeTruthy();
    }
  });
});
