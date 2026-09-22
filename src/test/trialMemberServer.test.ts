import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind } from "typescript";
import { getTrialMemberPatterns, requiresMemberBooking } from "../../supabase/functions/_shared/trial-member-redirect";

// Execute the actual Edge Function with an in-memory Supabase boundary. This
// proves that direct POSTs cannot insert bookings or send notifications when
// rejected, without touching production or depending on Deno in the web CI.
const code = transpileModule(readFileSync("supabase/functions/trial-book/index.ts", "utf8"), {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;
const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
const insert = vi.fn();
const network = vi.fn();
let queriedTables: string[];
let privateRules: string | undefined;
let bookingCount: number;
let insertError: string | undefined;
let handler: (request: Request) => Promise<Response>;

function from(table: string) {
  queriedTables.push(table);
  let tenantId: string;
  let inserted: Record<string, unknown> | undefined;
  const result = () => {
    if (table === "tenants") return { data: { id: tenantId, gym_name: "テストジム", status: "active" }, error: null };
    if (inserted) return {
      data: insertError ? null : { id: "trial-id", cancel_token: "test-token", ...inserted },
      error: insertError ? { message: insertError } : null,
    };
    return { data: [], error: null, count: bookingCount };
  };
  const query = {
    select: () => query,
    eq: (column: string, value: string) => { if (column === "id" || column === "tenant_id") tenantId = value; return query; },
    neq: () => query,
    gte: () => query,
    in: () => query,
    order: () => Promise.resolve(result()),
    maybeSingle: () => Promise.resolve(result()),
    single: () => Promise.resolve(result()),
    insert: (row: Record<string, unknown>) => { insert(row); inserted = row; return query; },
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return query;
}

beforeEach(() => {
  queriedTables = [];
  privateRules = JSON.stringify({ [tenantA]: ["山田", "やまだ"] });
  bookingCount = 0;
  insertError = undefined;
  insert.mockReset();
  network.mockReset().mockImplementation(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", network);
  vi.stubGlobal("AbortSignal", { timeout: () => undefined });
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-17T10:00:00+09:00").getTime());
  const requireMock = (path: string) => {
    if (path.startsWith("https://esm.sh/")) return { createClient: () => ({ from }) };
    if (path === "../_shared/trial-member-redirect.ts") return { getTrialMemberPatterns, requiresMemberBooking };
    throw new Error(`Unexpected dependency: ${path}`);
  };
  new Function("require", "Deno", "exports", code)(requireMock, {
    env: { get: (key: string) => key === "TRIAL_MEMBER_REDIRECT_RULES" ? privateRules
      : key === "SUPABASE_URL" ? "https://example.com" : "test-only" },
    serve: (callback: typeof handler) => { handler = callback; },
  }, {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const submit = (body: Record<string, unknown>) => handler(new Request("https://example.com/trial-book", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));
const booking = { tenant_id: tenantA, guest_name: "山田 太郎", guest_contact: "test@example.com", booking_date: "2026-09-20T11:00:00+09:00" };

describe("trial-book member guard", () => {
  it("rejects a direct booking POST before insert and all notifications", async () => {
    const response = await submit(booking);
    expect(await response.json()).toMatchObject({ ok: false, code: "member_booking_required" });
    expect(insert).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(queriedTables).toEqual([]);
  });

  it("performs the same check for kana variants and ignores client-supplied rule overrides", async () => {
    const response = await submit({ ...booking, guest_name: "ﾔﾏﾀﾞ ﾀﾛｳ", name_patterns: [], member_booking_required: false });
    expect(await response.json()).toMatchObject({ ok: false, code: "member_booking_required" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("check_only never reserves a slot or sends a notification", async () => {
    const response = await submit({ tenant_id: tenantA, guest_name: "鈴木 花子", check_only: true });
    expect(await response.json()).toEqual({ ok: true });
    expect(insert).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(queriedTables).toEqual([]);
  });

  it.each([
    { ...booking, guest_name: "鈴木 花子" },
    { ...booking, tenant_id: tenantB },
  ])("keeps ordinary bookings and other tenants working", async (payload) => {
    const response = await submit(payload);
    expect(await response.json()).toMatchObject({ ok: true, trial_booking_id: "trial-id" });
    expect(insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tenant_id: payload.tenant_id, guest_name: payload.guest_name }));
    expect(network).toHaveBeenCalledTimes(3);
  });

  it.each([undefined, "{", "null", JSON.stringify({ [tenantA]: [null] })])(
    "preserves ordinary bookings when optional configuration is missing or malformed: %s", async (rules) => {
    privateRules = rules;
    const response = await submit(booking);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(queriedTables.every((table) => ["tenants", "trial_bookings", "tenant_members"].includes(table))).toBe(true);
  });

  it("leaves other tenants independent of a malformed tenant-specific rule", async () => {
    privateRules = JSON.stringify({ [tenantA]: "invalid" });
    expect(await (await submit({ ...booking, tenant_id: tenantB })).json()).toMatchObject({ ok: true });
  });

  it.each([
    [{ guest_contact: "invalid" }, "validation"],
    [{ booking_date: "2026-09-17T11:00:00+09:00" }, "too_soon"],
    [{ booking_date: "2026-10-20T11:00:00+09:00" }, "too_far"],
    [{ booking_date: "2026-09-20T11:07:00+09:00" }, "validation"],
    [{ check_only: "true", booking_date: "invalid" }, "validation"],
  ])("keeps existing booking validation: %s", async (overrides, code) => {
    const response = await submit({ ...booking, guest_name: "鈴木 花子", ...overrides });
    expect(await response.json()).toMatchObject({ ok: false, code });
    expect(insert).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it("keeps the existing rate limit before any booking or notification", async () => {
    bookingCount = 3;
    const response = await submit({ ...booking, guest_name: "鈴木 花子" });
    expect(await response.json()).toMatchObject({ ok: false, code: "rate_limited" });
    expect(insert).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it("preserves overlap rejection and never notifies on an unsuccessful insert", async () => {
    insertError = "booking overlap";
    const response = await submit({ ...booking, guest_name: "鈴木 花子" });
    expect(await response.json()).toMatchObject({ ok: false, code: "slot_taken" });
    expect(network).not.toHaveBeenCalled();
  });
});
