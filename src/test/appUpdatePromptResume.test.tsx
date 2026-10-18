import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { LATEST_CACHE_MS } from "@/lib/appVersion";

// ────────────────────────────────────────────────────────────────
// 「アップデートのお願い」: 起動しっぱなしの端末にも、新しい版の案内が届くこと（2026-10-18）
//
// 以前はストアに出ている版（RPC の結果）を**終了するまで使い回していた**。
// スマホはアプリを閉じずにバックグラウンドへ回すので、本番の latest_version を上げても、
// 起動しっぱなしの端末には案内がいつまでも出なかった。
// 控えに寿命（LATEST_CACHE_MS）を付け、切れたら次の復帰で聞き直す。
//
// フックはネイティブでしか動かないので、Capacitor と supabase を差し替えて動かす。
// ────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  running: "1.8.4",
  latest: "1.8.4",
  rpcCalls: 0,
  onResume: null as null | ((state: { isActive: boolean }) => void),
}));

vi.mock("@capacitor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@capacitor/core")>()),
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    getInfo: async () => ({ version: h.running }),
    addListener: (_event: string, cb: (state: { isActive: boolean }) => void) => {
      h.onResume = cb;
      return Promise.resolve({ remove: async () => {} });
    },
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => {
      h.rpcCalls += 1;
      return { data: [{ latest_version: h.latest, released_at: "2026-10-15T00:00:00Z" }], error: null };
    },
  },
}));

import { useAppUpdatePrompt } from "@/hooks/useAppUpdatePrompt";

const START = new Date("2026-10-18T09:00:00+09:00").getTime();

beforeEach(() => {
  h.running = "1.8.4";
  h.latest = "1.8.4";
  h.rpcCalls = 0;
  h.onResume = null;
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

const resumeAt = async (ms: number) => {
  vi.setSystemTime(START + ms);
  await act(async () => {
    h.onResume?.({ isActive: true });
  });
};

describe("🔴 起動しっぱなしの端末にも、新しい版の案内が届く", () => {
  it("起動時は最新なので出さない", async () => {
    const { result } = renderHook(() => useAppUpdatePrompt());
    await waitFor(() => expect(result.current.reason).toBe("up-to-date"));
    expect(result.current.show).toBe(false);
    expect(h.rpcCalls).toBe(1);
  });

  it("控えの寿命のうちは聞き直さない（復帰のたびに RPC を投げない）", async () => {
    const { result } = renderHook(() => useAppUpdatePrompt());
    await waitFor(() => expect(result.current.reason).toBe("up-to-date"));

    h.latest = "1.8.5"; // 本番で latest_version を上げた
    await resumeAt(LATEST_CACHE_MS - 60_000);
    expect(h.rpcCalls).toBe(1);
    expect(result.current.show).toBe(false);
  });

  it("🔴 寿命が切れたら、次の復帰で聞き直して案内を出す", async () => {
    const { result } = renderHook(() => useAppUpdatePrompt());
    await waitFor(() => expect(result.current.reason).toBe("up-to-date"));

    h.latest = "1.8.5";
    await resumeAt(LATEST_CACHE_MS + 60_000);
    await waitFor(() => expect(result.current.show).toBe(true));
    expect(h.rpcCalls).toBe(2);
    expect(result.current.latestVersion).toBe("1.8.5");
    expect(result.current.runningVersion).toBe("1.8.4");
  });

  it("ストアで更新して戻ってきたら、案内が消える（版は控えのまま、手元の版だけ読み直す）", async () => {
    h.latest = "1.8.5";
    const { result } = renderHook(() => useAppUpdatePrompt());
    await waitFor(() => expect(result.current.show).toBe(true));

    h.running = "1.8.5"; // ストアで更新した
    await resumeAt(5 * 60_000);
    await waitFor(() => expect(result.current.show).toBe(false));
    expect(result.current.reason).toBe("up-to-date");
    expect(h.rpcCalls).toBe(1);
  });

  it("寿命は数時間以内（長すぎると、上げた版の案内が届くまで何日もかかる）", () => {
    expect(LATEST_CACHE_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(LATEST_CACHE_MS).toBeLessThanOrEqual(6 * 60 * 60_000);
  });
});
