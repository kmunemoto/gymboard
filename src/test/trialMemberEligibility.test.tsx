import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "@/lib/i18n";
import { useTrialMemberEligibility } from "@/hooks/useTrialMemberEligibility";
import TrialBooking from "@/pages/TrialBooking";
import { NATIVE_APP_SCHEME, PRODUCTION_WEB_ORIGIN, STORE_URLS } from "@/lib/brand";

const { invoke, rpc } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke }, rpc } }));
vi.mock("@/lib/legacyDefaultTenant", () => ({ LEGACY_DEFAULT_TENANT_ID: "tenant-a" }));
vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => (
    <button data-testid="trial-calendar" onClick={() => onSelect(new Date(2026, 8, 20))}>Select trial date</button>
  ),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T03:00:00Z"));
  invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const finishCheck = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(400); }); };

describe("trial eligibility check", () => {
  it("does not call the API for an empty name or disabled feature", async () => {
    const { rerender } = renderHook(({ name, enabled }) => useTrialMemberEligibility("tenant-a", name, enabled), {
      initialProps: { name: "", enabled: true },
    });
    await finishCheck();
    rerender({ name: "テスト会員", enabled: false });
    await finishCheck();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("checks only the final input and sends no email or reservation date", async () => {
    const { result, rerender } = renderHook(({ name }) => useTrialMemberEligibility("tenant-a", name, true), {
      initialProps: { name: "テ" },
    });
    rerender({ name: "テスト会員" });
    await finishCheck();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("trial-book", {
      body: { tenant_id: "tenant-a", guest_name: "テスト会員", check_only: true },
    });
    expect(result.current.status).toBe("allowed");
  });

  it("ignores a stale allowed response after the name changes", async () => {
    let resolveOld!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(({ name }) => useTrialMemberEligibility("tenant-a", name, true), {
      initialProps: { name: "新規のお客様" },
    });
    await finishCheck();
    rerender({ name: "テスト会員" });
    expect(result.current.status).toBe("checking");
    invoke.mockResolvedValue({ data: { ok: false, code: "member_booking_required" }, error: null });
    await finishCheck();
    await act(async () => { resolveOld({ data: { ok: true }, error: null }); });
    expect(result.current.status).toBe("member");
  });

  it("invalidates a previous result immediately when the tenant changes", async () => {
    const { result, rerender } = renderHook(({ tenant }) => useTrialMemberEligibility(tenant, "テスト会員", true), {
      initialProps: { tenant: "tenant-a" },
    });
    await finishCheck();
    expect(result.current.status).toBe("allowed");
    rerender({ tenant: "tenant-b" });
    expect(result.current.status).toBe("checking");
  });

  it("leaves a failed optional precheck idle so the final POST can decide", async () => {
    invoke.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useTrialMemberEligibility("tenant-a", "テスト", true));
    await finishCheck();
    expect(result.current.status).toBe("idle");
  });

  it("does not let a late precheck undo rejection from the final POST", async () => {
    let resolveCheck!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveCheck = resolve; }));
    const { result } = renderHook(() => useTrialMemberEligibility("tenant-a", "テスト会員", true));
    await finishCheck();
    act(() => result.current.requireMemberBooking());
    await act(async () => { resolveCheck({ data: { ok: true }, error: null }); });
    expect(result.current.status).toBe("member");
  });
});

describe("trial page member guidance", () => {
  it("does not introduce precheck requests for another gym", async () => {
    render(<MemoryRouter initialEntries={["/trial/tenant-b?name=テスト会員"]}>
      <Routes><Route path="/trial/:tenantId" element={<TrialBooking />} /></Routes>
    </MemoryRouter>);
    await finishCheck();
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId("trial-calendar")).toBeVisible();
  });

  it.each(["old-api", "offline"])("keeps ordinary submission available when the precheck is %s", async (failure) => {
    if (failure === "old-api") invoke.mockResolvedValueOnce({ data: { ok: false, code: "validation" }, error: null });
    else invoke.mockRejectedValueOnce(new Error("offline"));
    render(<MemoryRouter initialEntries={["/trial/tenant-a?name=初めてのお客様&email=test@example.com"]}>
      <Routes><Route path="/trial/:tenantId" element={<TrialBooking />} /></Routes>
    </MemoryRouter>);
    await finishCheck();
    fireEvent.click(screen.getByTestId("trial-calendar"));
    fireEvent.click(screen.getByRole("button", { name: "11:00" }));
    const submitButton = screen.getByRole("button", { name: i18n.t("trialBooking.submitBooking") });
    expect(submitButton).toBeEnabled();
    await act(async () => { fireEvent.click(submitButton); });
    expect(invoke).toHaveBeenLastCalledWith("trial-book", {
      body: expect.objectContaining({ tenant_id: "tenant-a", guest_contact: "test@example.com", booking_date: "2026-09-20T11:00:00+09:00" }),
    });
    expect(invoke.mock.calls.filter(([, args]) => args.body.check_only !== true)).toHaveLength(1);
  });

  it("replaces booking controls with app links for a member and restores them for a corrected name", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: false, code: "member_booking_required" }, error: null });
    render(<MemoryRouter initialEntries={["/trial/tenant-a?name=テスト会員"]}>
      <Routes><Route path="/trial/:tenantId" element={<TrialBooking />} /></Routes>
    </MemoryRouter>);
    await finishCheck();
    expect(screen.getByText(i18n.t("trialBooking.memberTitle"))).toBeVisible();
    expect(screen.queryByTestId("trial-calendar")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/メールアドレス/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /アプリを開く/ })).toHaveAttribute("href", `${NATIVE_APP_SCHEME}//`);
    expect(screen.getByRole("link", { name: "App Store" })).toHaveAttribute("href", STORE_URLS.ios);
    expect(screen.getByRole("link", { name: "Google Play" })).toHaveAttribute("href", STORE_URLS.android);
    expect(screen.getByRole("link", { name: i18n.t("trialBooking.memberWebLogin") })).toHaveAttribute("href", PRODUCTION_WEB_ORIGIN);
    expect(invoke.mock.calls.every(([, args]) => args.body.check_only === true)).toBe(true);

    fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: "初めてのお客様" } });
    await finishCheck();
    expect(screen.queryByText(i18n.t("trialBooking.memberTitle"))).not.toBeInTheDocument();
    expect(screen.getByTestId("trial-calendar")).toBeVisible();
  });
});
