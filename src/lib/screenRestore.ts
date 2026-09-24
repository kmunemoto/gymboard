/**
 * 開いていた画面を、アプリが起動し直しても元に戻す（2026-09-24）。
 * （アプリに戻るたびにホームへ戻っていた件の主因は Index.tsx。下の「何が起きていたか」）
 *
 * 宗本さん（画面録画を添えて）:
 *
 * > ジムボードの予約画面を開いていて、他の所に飛んでジムボードに帰ってきたら
 * > ホーム画面に帰ってしまうのを直して。ちゃんと開いていたページを保持できてるように。
 *
 * ## 何が起きていたか（本当の原因は別の所にあった）
 *
 * 🔴 **主因は `src/pages/Index.tsx`**。Supabase（auth-js）はアプリに戻るたびに
 * ログインを確かめ直して SIGNED_IN を通知し、`user` が同じ人の新しいオブジェクトに
 * 差し替わる。Index がそれで所属を確かめ直し、全画面の読み込み表示（GBのロゴ＝
 * `DumbbellLoader`）に切り替わって画面を丸ごと作り直していた。全員・毎回起きていた。
 * そちらは Index で直した（見張りは `src/test/indexResume.test.tsx`）。
 *
 * ⚠️ 最初は「GBのロゴ＝ネイティブの起動画面＝iOS がアプリを終了させた」と読み違えた。
 *    アプリ内の読み込み表示も同じ GB のロゴ。**ロゴだけで起動し直したと決めない。**
 *
 * ## それでもこのファイルが要る理由
 *
 * 本当にアプリが起動し直すことはある（iOS がメモリのために裏のアプリを終了させる、
 * ブラウザ版の再読み込み、Service Worker の更新で読み込み直す）。開いていたタブは
 * React のメモリ（`useState("home")`）にしか無いので、そのときは必ずホームに戻る。
 * **起動し直しは止められないので、覚えておいて戻す。**
 *
 * ## 何を戻すか・戻さないか
 *
 * | | |
 * |---|---|
 * | 戻す | タブ（お客様・店とも）、店が開いていたカルテ（どのお客様か） |
 * | 戻さない | 入力の途中（選んだ枠・オプション・事前アンケート）、スクロール位置 |
 *
 * 入力の途中を戻さないのは、離れている間に空きが変わるため。戻った先で
 * 「さっき選んだ枠」を押すと、取れない枠を押すことになりうる。
 *
 * ## 🔴 戻すのは「離れてから30分以内」だけ
 *
 * 翌朝アプリを開いたら昨日の画面、は求められていない（ホームには今日の予定がある）。
 * 「ちょっと他のアプリに行って戻ってきた」だけを戻す。時刻は**裏に回った瞬間**に
 * 書き直す（`useRememberScreen`）。画面を開いた時刻ではない——予約画面を1時間
 * 開いたまま離れた人も、戻ってきたら予約画面に戻す。
 *
 * ## 🔴 URL に行き先があるときは戻さない
 *
 * 決済からの戻り（`?tab=billing&billing=success`）や、会員の Stripe の戻り（`?checkout=`）は
 * URL が行き先を持っている。そこへ「覚えていた画面」を被せると、完了の案内が出る画面に
 * 着かなくなる。
 *
 * ## 🔴 端末の保存に失敗しても画面は壊さない
 *
 * 読めない・書けない・壊れている、はすべて「ホームから始める」（今まで通り）に倒す。
 * 例外は外に出さない（effect の中で投げると、テストは緑のまま vitest が exit 1 する形になる）。
 */
import { CUSTOMER_TABS, type CustomerTab } from "@/lib/customerTabs";
import { TRAINER_TABS, type TrainerTab } from "@/lib/trainerTabs";
import {
  MEALS_ENABLED, MONTHLY_REPORT_ENABLED, POSTURE_ENABLED, WORKOUT_LOG_ENABLED,
} from "@/lib/featureFlags";

/** 戻してよい「離れてからの時間」。これを過ぎたら今まで通りホームから始める。 */
export const SCREEN_RESTORE_MAX_AGE_MS = 30 * 60 * 1000;

const VERSION = 1;

export type ScreenRole = "customer" | "trainer";

/**
 * 保存の鍵。**役割と利用者ごとに分ける**（同じ端末で別の人がログインしても、
 * 前の人が開いていた画面やカルテを引き継がない）。
 */
export const screenStorageKey = (role: ScreenRole, userId: string): string =>
  `gymboard.screen.v${VERSION}.${role}.${userId}`;

export const serializeScreen = <T>(state: T, nowMs: number): string =>
  JSON.stringify({ v: VERSION, at: nowMs, state });

/**
 * 保存してあった画面を読む。戻してよくなければ null（＝今まで通りホームから）。
 *
 * null になるのは: 無い・壊れている・形が違う・版が違う・古すぎる・時刻が未来
 * （端末の時計が戻された等。信じない）。
 */
export const parseSavedScreen = <T>(
  raw: string | null | undefined,
  nowMs: number,
  isValid: (s: unknown) => s is T,
  maxAgeMs: number = SCREEN_RESTORE_MAX_AGE_MS,
): T | null => {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const { v, at, state } = obj as { v?: unknown; at?: unknown; state?: unknown };
  if (v !== VERSION || typeof at !== "number" || !Number.isFinite(at)) return null;
  const age = nowMs - at;
  if (age < 0 || age > maxAgeMs) return null;
  return isValid(state) ? state : null;
};

/** URL が行き先を持っているか。持っていれば、覚えていた画面は被せない。 */
export const urlHasNavigationIntent = (search: string): boolean => {
  const p = new URLSearchParams(search);
  return p.has("tab") || p.has("billing") || p.has("checkout");
};

// ── お客様 ──────────────────────────────────────────────────────────

export interface CustomerScreen {
  tab: CustomerTab;
}

/**
 * そのタブを戻してよいか。
 * 🔴 機能フラグで塞いでいるタブは戻さない。CustomerView はそのタブの中身を描かないので、
 *    戻すと**真っ白な画面**になる（業種ごとのフォークで落としている画面がある）。
 */
export const isRestorableCustomerTab = (tab: unknown): tab is CustomerTab => {
  if (typeof tab !== "string" || !(CUSTOMER_TABS as readonly string[]).includes(tab)) return false;
  switch (tab) {
    case "training":
    case "photos":
      return WORKOUT_LOG_ENABLED;
    case "meals":
      return MEALS_ENABLED;
    case "posture":
      return POSTURE_ENABLED;
    case "report":
      return MONTHLY_REPORT_ENABLED;
    default:
      return true;
  }
};

export const isCustomerScreen = (s: unknown): s is CustomerScreen =>
  !!s && typeof s === "object" && isRestorableCustomerTab((s as { tab?: unknown }).tab);

// ── 店 ──────────────────────────────────────────────────────────────

export interface TrainerScreen {
  tab: TrainerTab;
  /** 開いていたカルテ（お客様の user_id）。顧客タブのときだけ意味がある。 */
  clientId: string | null;
}

const looksLikeId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 64 && /^[0-9a-zA-Z-]+$/.test(v);

export const isTrainerScreen = (s: unknown): s is TrainerScreen => {
  if (!s || typeof s !== "object") return false;
  const { tab, clientId } = s as { tab?: unknown; clientId?: unknown };
  if (typeof tab !== "string" || !(TRAINER_TABS as readonly string[]).includes(tab)) return false;
  if (clientId === null) return true;
  // カルテは顧客タブの中にしか無い。他のタブにカルテの指定が付いていたら壊れている
  return tab === "clients" && looksLikeId(clientId);
};
