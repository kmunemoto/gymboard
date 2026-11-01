/**
 * ログアウトしても端末の通知の登録が消えず、共用の端末に前の人宛ての通知が出続けた穴
 * （2026-11-01・点検の拡大 push-logout-1）。
 *   - DB: `supabase/migrations/20261101080000_push_one_user_per_device.sql`（同じ端末を別の人が登録したら前の人の行を消す。古いアプリにも効く）
 *   - 画面: `src/lib/pushNotifications.ts` の forgetThisDeviceForPush を、ログアウトの前に呼ぶ（src/contexts/AuthContext.tsx）
 *
 * 本番で、同じトークン・購読先を2人が登録すると、適用前は2行残り、適用後は最後の人の1行だけになることを確かめた
 * （mem/ops/tenant-boundary.md 穴26）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  native: false,
  platform: "ios" as "ios" | "android",
  deletes: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  upserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  iosToken: "ios-token-1",
}));

vi.mock("@capacitor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@capacitor/core")>()),
  Capacitor: { isNativePlatform: () => h.native, getPlatform: () => h.platform },
}));

vi.mock("@capacitor-firebase/messaging", () => ({
  FirebaseMessaging: {
    getToken: async () => ({ token: h.iosToken }),
    removeAllListeners: async () => undefined,
    addListener: async () => ({ remove: async () => undefined }),
  },
}));

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    removeAllListeners: async () => undefined,
    addListener: async () => ({ remove: async () => undefined }),
    register: async () => undefined,
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => ({
    upsert: async (row: Record<string, unknown>) => {
      h.upserts.push({ table, row });
      return { error: null };
    },
    delete: () => {
      const entry = { table, filters: [] as Array<[string, unknown]> };
      h.deletes.push(entry);
      const chain = {
        eq: (col: string, val: unknown) => {
          entry.filters.push([col, val]);
          return chain;
        },
        then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
      };
      return chain;
    },
  });
  return { supabase: { from } };
});

import { forgetThisDeviceForPush, registerCurrentDevice } from "@/lib/pushNotifications";

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n");

describe("forgetThisDeviceForPush: ログアウトの前に、この端末の登録だけを消す", () => {
  beforeEach(() => {
    h.deletes = [];
    h.upserts = [];
    h.native = false;
    h.platform = "ios";
  });

  it("🔴 ネイティブ: この端末のトークンの行だけを消す（他の端末の登録は残す）", async () => {
    h.native = true;
    expect(await registerCurrentDevice("u1")).toBe(true);
    expect(h.upserts).toEqual([{ table: "push_devices", row: expect.objectContaining({ user_id: "u1", fcm_token: "ios-token-1" }) }]);
    await forgetThisDeviceForPush("u1");
    expect(h.deletes).toEqual([{ table: "push_devices", filters: [["user_id", "u1"], ["fcm_token", "ios-token-1"]] }]);
  });

  it("ネイティブで保存したトークンが手元に無いとき（iOS）は、端末に聞いてから消す", async () => {
    h.native = true;
    h.iosToken = "ios-token-2";
    await forgetThisDeviceForPush("u2");
    expect(h.deletes.at(-1)).toEqual({ table: "push_devices", filters: [["user_id", "u2"], ["fcm_token", "ios-token-2"]] });
    h.iosToken = "ios-token-1";
  });

  it("🔴 Web: この端末の購読の行を消し、購読も解除する", async () => {
    const unsubscribe = vi.fn(async () => true);
    const sub = { endpoint: "https://push.example/ep-1", unsubscribe };
    const original = (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) },
    });
    try {
      await forgetThisDeviceForPush("u3");
    } finally {
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: original });
    }
    expect(h.deletes).toEqual([{ table: "push_subscriptions", filters: [["user_id", "u3"], ["endpoint", "https://push.example/ep-1"]] }]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("Web で購読が無ければ何もしない・Service Worker が無くても例外を出さない", async () => {
    await expect(forgetThisDeviceForPush("u4")).resolves.toBeUndefined();
    expect(h.deletes).toEqual([]);
  });
});

describe("ログアウト（AuthContext.signOut）", () => {
  const src = stripComments(readFileSync("src/contexts/AuthContext.tsx", "utf8"));

  it("🔴 supabase.auth.signOut の前に、この端末の登録を消す（ログアウト後は RLS で消せない）", () => {
    const forgetAt = src.indexOf("forgetThisDeviceForPush(uid)");
    const signOutAt = src.indexOf("await supabase.auth.signOut();");
    expect(forgetAt).toBeGreaterThan(-1);
    expect(signOutAt).toBeGreaterThan(forgetAt);
  });

  it("待つのは最大2秒（通信が詰まってもログアウトは止めない）", () => {
    expect(src).toMatch(/await Promise\.race\(\[\s*forgetThisDeviceForPush\(uid\),\s*new Promise<void>\(\(resolve\) => setTimeout\(resolve, 2000\)\),\s*\]\);/);
  });
});

describe("DB: 同じ端末を別の人が登録したら、前の人の行を消す（古いアプリにも効く）", () => {
  const sql = readFileSync("supabase/migrations/20261101080000_push_one_user_per_device.sql", "utf8")
    .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ");

  it("🔴 push_devices: 同じ fcm_token の他人の行を消す（SECURITY DEFINER・画面からは呼べない）", () => {
    expect(sql).toContain("DELETE FROM public.push_devices WHERE fcm_token = NEW.fcm_token AND user_id IS DISTINCT FROM NEW.user_id;");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF fcm_token, user_id ON public.push_devices FOR EACH ROW EXECUTE FUNCTION public.push_devices_one_user_per_token();");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.push_devices_one_user_per_token() FROM PUBLIC, anon, authenticated;");
  });

  it("🔴 push_subscriptions: 同じ endpoint の他人の行を消す", () => {
    expect(sql).toContain("DELETE FROM public.push_subscriptions WHERE endpoint = NEW.endpoint AND user_id IS DISTINCT FROM NEW.user_id;");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF endpoint, user_id ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.push_subscriptions_one_user_per_endpoint();");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.push_subscriptions_one_user_per_endpoint() FROM PUBLIC, anon, authenticated;");
  });
});
