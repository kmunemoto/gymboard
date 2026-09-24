import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import {
  SCREEN_RESTORE_MAX_AGE_MS,
  isCustomerScreen,
  isRestorableCustomerTab,
  isTrainerScreen,
  parseSavedScreen,
  screenStorageKey,
  serializeScreen,
  urlHasNavigationIntent,
} from "@/lib/screenRestore";
import { CUSTOMER_TABS } from "@/lib/customerTabs";
import { TRAINER_TABS } from "@/lib/trainerTabs";
import {
  MEALS_ENABLED, MONTHLY_REPORT_ENABLED, POSTURE_ENABLED, WORKOUT_LOG_ENABLED,
} from "@/lib/featureFlags";
import { useRememberScreen, useRestoredScreen } from "@/hooks/useScreenMemory";

// ────────────────────────────────────────────────────────────────
// 開いていた画面を、アプリが起動し直しても戻す（2026-09-24 宗本さん・画面録画つき）
//
// > ジムボードの予約画面を開いていて、他の所に飛んでジムボードに帰ってきたら
// > ホーム画面に帰ってしまうのを直して。ちゃんと開いていたページを保持できてるように。
//
// 録画: 予約画面 → ブラウザで動画（約2秒）→ 戻る → **アプリの起動画面** → ホーム。
// iOS が裏のアプリを終了させ、起動し直していた。タブはメモリにしか無かったので必ずホーム。
//
// 🔴 壊しやすいもの:
//   1. 「離れた時刻」を裏に回ったときに書き直さない → 長く開いていた画面ほど戻らない
//   2. 塞いでいるタブを戻す → 真っ白な画面
//   3. URL の行き先（決済の戻り等）に覚えていた画面を被せる → 完了の案内に着かない
//   4. 端末の保存で例外を投げる → 画面ごと落ちる
// ────────────────────────────────────────────────────────────────

const T0 = Date.parse("2026-09-24T15:49:50+09:00");
const MIN = 60_000;

describe("保存したものを読む", () => {
  const raw = serializeScreen({ tab: "booking" }, T0);

  it("🔴 録画の流れ: 予約画面で離れて2秒後に起動し直す → 予約画面に戻る", () => {
    expect(parseSavedScreen(raw, T0 + 2_000, isCustomerScreen)).toEqual({ tab: "booking" });
  });

  it("30分以内なら戻す", () => {
    expect(parseSavedScreen(raw, T0 + 29 * MIN, isCustomerScreen)).toEqual({ tab: "booking" });
  });

  it("🔴 30分を過ぎたら戻さない（翌朝に昨日の画面、にしない）", () => {
    expect(parseSavedScreen(raw, T0 + SCREEN_RESTORE_MAX_AGE_MS + 1, isCustomerScreen)).toBeNull();
    expect(SCREEN_RESTORE_MAX_AGE_MS).toBe(30 * MIN);
  });

  it("時刻が未来（端末の時計が戻された等）は信じない", () => {
    expect(parseSavedScreen(raw, T0 - 1_000, isCustomerScreen)).toBeNull();
  });

  it("壊れている・版が違う・形が違うものは戻さない", () => {
    expect(parseSavedScreen(null, T0, isCustomerScreen)).toBeNull();
    expect(parseSavedScreen("", T0, isCustomerScreen)).toBeNull();
    expect(parseSavedScreen("{not json", T0, isCustomerScreen)).toBeNull();
    expect(parseSavedScreen(JSON.stringify({ v: 999, at: T0, state: { tab: "booking" } }), T0, isCustomerScreen)).toBeNull();
    expect(parseSavedScreen(JSON.stringify({ v: 1, at: "x", state: { tab: "booking" } }), T0, isCustomerScreen)).toBeNull();
    expect(parseSavedScreen(serializeScreen({ tab: "nope" }, T0), T0, isCustomerScreen)).toBeNull();
  });
});

describe("お客様のタブ", () => {
  it("ふつうのタブは戻せる", () => {
    for (const tab of ["home", "booking", "chat", "settings", "videos"]) {
      expect(isRestorableCustomerTab(tab), tab).toBe(true);
    }
  });

  it("🔴 機能フラグで塞いでいるタブは戻さない（戻すと真っ白な画面）", () => {
    expect(isRestorableCustomerTab("training")).toBe(WORKOUT_LOG_ENABLED);
    expect(isRestorableCustomerTab("photos")).toBe(WORKOUT_LOG_ENABLED);
    expect(isRestorableCustomerTab("meals")).toBe(MEALS_ENABLED);
    expect(isRestorableCustomerTab("posture")).toBe(POSTURE_ENABLED);
    expect(isRestorableCustomerTab("report")).toBe(MONTHLY_REPORT_ENABLED);
  });

  it("知らないタブ・文字列でないものは戻さない", () => {
    expect(isRestorableCustomerTab("admin")).toBe(false);
    expect(isRestorableCustomerTab(3)).toBe(false);
    expect(isCustomerScreen(null)).toBe(false);
  });

  it("一覧と CustomerView の描き分けがズレていない", () => {
    const view = readFileSync("src/components/customer/CustomerView.tsx", "utf8");
    for (const tab of CUSTOMER_TABS) {
      expect(view, `CustomerView が ${tab} を描いていない`).toContain(`tab === "${tab}"`);
    }
  });
});

describe("店のタブとカルテ", () => {
  it("タブだけ・顧客タブ＋カルテは戻せる", () => {
    expect(isTrainerScreen({ tab: "schedule", clientId: null })).toBe(true);
    expect(isTrainerScreen({ tab: "clients", clientId: "be995913-b2ae-421a-bf4d-06a80a27a6bd" })).toBe(true);
  });

  it("🔴 顧客タブ以外にカルテの指定が付いていたら壊れている", () => {
    expect(isTrainerScreen({ tab: "schedule", clientId: "be995913-b2ae-421a-bf4d-06a80a27a6bd" })).toBe(false);
  });

  it("おかしな値は戻さない", () => {
    expect(isTrainerScreen({ tab: "nope", clientId: null })).toBe(false);
    expect(isTrainerScreen({ tab: "clients", clientId: "<script>" })).toBe(false);
    expect(isTrainerScreen({ tab: "clients", clientId: "x".repeat(65) })).toBe(false);
    expect(isTrainerScreen({ tab: "clients" })).toBe(false);
  });

  it("一覧と TrainerView の描き分けがズレていない", () => {
    const view = readFileSync("src/components/trainer/TrainerView.tsx", "utf8");
    for (const tab of TRAINER_TABS) {
      expect(view, `TrainerView が ${tab} を描いていない`).toContain(`tab === "${tab}"`);
    }
  });
});

describe("URL の行き先", () => {
  it("🔴 決済の戻り・会員の購入の戻りには被せない", () => {
    expect(urlHasNavigationIntent("?tab=billing&billing=success")).toBe(true);
    expect(urlHasNavigationIntent("?checkout=success&session_id=x")).toBe(true);
  });

  it("行き先の無い URL（通知から開いた / 等）なら戻す", () => {
    expect(urlHasNavigationIntent("")).toBe(false);
    expect(urlHasNavigationIntent("?foo=1")).toBe(false);
  });
});

describe("保存の鍵", () => {
  it("🔴 役割と利用者ごとに分ける（別の人に前の人の画面・カルテを引き継がない）", () => {
    expect(screenStorageKey("customer", "u1")).not.toBe(screenStorageKey("customer", "u2"));
    expect(screenStorageKey("customer", "u1")).not.toBe(screenStorageKey("trainer", "u1"));
  });
});

// ────────────────────────────────────────────────────────────────
// フック（実際に端末の保存へ読み書きする）
// ────────────────────────────────────────────────────────────────
describe("🔴 覚えて、起動し直したら戻す", () => {
  const KEY = screenStorageKey("customer", "u1");

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("録画の流れをそのまま: 予約画面 → 裏へ → 終了 → 2秒後に起動 → 予約画面", () => {
    // 1回目の起動: 予約画面を開く
    const first = renderHook(({ tab }) => useRememberScreen(KEY, { tab }), { initialProps: { tab: "home" } });
    first.rerender({ tab: "booking" });
    // 裏に回る
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    // iOS に終了させられる
    first.unmount();
    // 2秒後に起動し直す
    vi.setSystemTime(T0 + 2_000);
    const second = renderHook(() => useRestoredScreen(KEY, isCustomerScreen));
    expect(second.result.current).toEqual({ tab: "booking" });
  });

  it("🔴 長く開いていた画面でも、裏に回った時刻から数える", () => {
    const h = renderHook(({ tab }) => useRememberScreen(KEY, { tab }), { initialProps: { tab: "booking" } });
    // 予約画面を1時間開いたまま
    vi.setSystemTime(T0 + 60 * MIN);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    h.unmount();
    // 裏に回ってから5分後に戻る
    vi.setSystemTime(T0 + 65 * MIN);
    const r = renderHook(() => useRestoredScreen(KEY, isCustomerScreen));
    expect(r.result.current).toEqual({ tab: "booking" });
  });

  it("URL に行き先があれば戻さない", () => {
    window.localStorage.setItem(KEY, serializeScreen({ tab: "booking" }, T0));
    window.history.replaceState({}, "", "/?checkout=success&session_id=x");
    const r = renderHook(() => useRestoredScreen(KEY, isCustomerScreen));
    expect(r.result.current).toBeNull();
  });

  it("🔴 端末の保存が読めなくても落ちない（ホームから始める）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const r = renderHook(() => useRestoredScreen(KEY, isCustomerScreen));
    expect(r.result.current).toBeNull();
  });

  it("🔴 端末の保存に書けなくても落ちない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => {
      const h = renderHook(({ tab }) => useRememberScreen(KEY, { tab }), { initialProps: { tab: "home" } });
      h.rerender({ tab: "booking" });
      act(() => { window.dispatchEvent(new Event("pagehide")); });
      h.unmount();
    }).not.toThrow();
  });

  it("ログインしていない（鍵が無い）ときは何もしない", () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    renderHook(() => useRememberScreen(null, { tab: "booking" }));
    expect(set).not.toHaveBeenCalled();
    expect(renderHook(() => useRestoredScreen(null, isCustomerScreen)).result.current).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// 画面への組み込み
// ────────────────────────────────────────────────────────────────
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

describe("🔴 お客様・店の両方の画面が覚えて戻す", () => {
  const customer = strip(readFileSync("src/components/customer/CustomerView.tsx", "utf8"));
  const trainer = strip(readFileSync("src/components/trainer/TrainerView.tsx", "utf8"));

  it("お客様: 覚えていたタブから始める", () => {
    expect(customer).toContain('useRestoredScreen(screenKey, isCustomerScreen)');
    expect(customer).toContain('useState<CustomerTab>(restored?.tab ?? "home")');
    expect(customer).toContain("useRememberScreen(screenKey, { tab })");
    expect(customer).not.toMatch(/useState<CustomerTab>\("home"\)/);
  });

  it("店: 覚えていたタブとカルテから始める", () => {
    expect(trainer).toContain('useRestoredScreen(screenKey, isTrainerScreen)');
    expect(trainer).toContain('useState<TrainerTab>(restored?.tab ?? "dashboard")');
    expect(trainer).toContain("useState<string | null>(restored?.clientId ?? null)");
    expect(trainer).not.toMatch(/useState<TrainerTab>\("dashboard"\)/);
  });

  it("店: カルテは顧客タブのときだけ覚える", () => {
    expect(trainer).toContain('clientId: tab === "clients" ? selectedClientId : null');
  });

  it("鍵は役割ごと・ログインしている人ごと", () => {
    expect(customer).toContain('screenStorageKey("customer", user.id)');
    expect(trainer).toContain('screenStorageKey("trainer", user.id)');
  });
});

describe("🔴 裏に回ったときに書き直している", () => {
  const hook = strip(readFileSync("src/hooks/useScreenMemory.ts", "utf8"));

  it("ブラウザ・アプリの両方で拾う", () => {
    expect(hook).toContain('"visibilitychange"');
    expect(hook).toContain('"pagehide"');
    expect(hook).toContain('CapApp.addListener("pause", write)');
  });

  it("読み書きを try で包んでいる", () => {
    expect(hook).toMatch(/try \{\s*if \(urlHasNavigationIntent/);
    expect(hook).toMatch(/try \{\s*window\.localStorage\.setItem/);
  });
});
