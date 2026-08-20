/**
 * 「何日先まで予約を受け付けるか」（tenants.booking_window_days）。
 *
 * ## なぜ必要か（2026-08-20）
 *
 * 締切（`src/lib/bookingCutoff.ts`）は「**手前**の締め」＝これ以降は遅すぎる、を決める。
 * その対になる「**先**の上限」＝これ以上先は早すぎる、が**どこにも設定として無く、
 * 画面ごとに違う数字が直書きされていた**。
 *
 * | 画面 | 直書き | 実際の上限 |
 * |---|---|---|
 * | お客様の予約（CustomerBooking） | `addMonths(today, 1)` | 1ヶ月先 |
 * | 体験予約（TrialBooking） | `TRIAL_BOOKING_MAX_DAYS_AHEAD = 10` | 10日先 |
 * | ドロップイン（DropInBooking） | `DROP_IN_BOOKING_MAX_DAYS_AHEAD = 10` | 10日先 |
 * | 予約を追加（TrainerSchedule） | 無し | 無制限 |
 *
 * エアリザーブでいう「受付開始時期」。「予約は30日前から受け付けます」を店が決められる。
 *
 * ## 未設定のときは**画面ごとの従来の上限をそのまま使う**
 *
 * 列を足しただけで既存店の見え方が変わってはいけないので、`null`（未設定）は
 * 「今までどおり」を意味する。だから既定値はこのファイルが1つ持つのではなく、
 * **呼び出し側が「自分の従来の既定」を `fallback` として渡す**。
 * 数字はここ（`LEGACY_*`）に集めてあるので、直書きは残っていない。
 *
 * ## 上限は「日」で数える
 *
 * `addMonths(today, 1)` は月によって 28〜31 日と長さが変わる。設定として店に見せるなら
 * 「30日先まで」のほうが説明しやすいので、設定値は日数で持つ。未設定の会員予約だけは
 * 従来互換のため月で数え続ける（`LEGACY_MEMBER_WINDOW_MONTHS`）。
 */
import { addDays, addMonths, format, startOfDay } from "date-fns";
import { getJSTNow } from "@/lib/timezone";

/** お客様の予約カレンダーの従来の上限。「今日から1ヶ月先」。 */
export const LEGACY_MEMBER_WINDOW_MONTHS = 1;

/** 公開ページ（体験・ドロップイン）の従来の上限。「今日から10日先」。 */
export const LEGACY_GUEST_WINDOW_DAYS = 10;

/** 店が設定できる日数の範囲。0 は「当日のみ」ではなく**未設定**として扱う（下記 normalize 参照）。 */
export const BOOKING_WINDOW_MIN_DAYS = 1;
export const BOOKING_WINDOW_MAX_DAYS = 365;

/** 設定画面に出す選択肢（日）。「未設定」は別途 UI 側が持つ。 */
export const BOOKING_WINDOW_OPTIONS = [7, 14, 30, 60, 90, 180, 365] as const;

/**
 * 設定値を正規化する。**使える値でなければ null（＝未設定）**。
 *
 * 0・負・NaN・範囲外を null に倒すのは、`0` を「当日しか取れない」と解釈すると
 * 設定ミス1つで店の予約が全部止まるため。止めたいなら定休日や締切で止める。
 */
export const normalizeBookingWindowDays = (raw: unknown): number | null => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.floor(raw);
  if (n < BOOKING_WINDOW_MIN_DAYS || n > BOOKING_WINDOW_MAX_DAYS) return null;
  return n;
};

/** 呼び出し側が渡す「従来の既定」。`days` か `months` のどちらか一方を入れる。 */
export interface LegacyWindow {
  days?: number;
  months?: number;
}

/**
 * 予約を受け付ける**最終日**（その日は含む）を返す。
 *
 * @param configuredDays `tenants.booking_window_days`。null/不正なら fallback を使う。
 * @param fallback       設定が無いときの従来の上限。
 * @param now            基準時刻。既定は JST の現在。
 */
export const bookingWindowEnd = (
  configuredDays: number | null | undefined,
  fallback: LegacyWindow,
  now: Date = getJSTNow(),
): Date => {
  const base = startOfDay(now);
  const days = normalizeBookingWindowDays(configuredDays);
  if (days !== null) return addDays(base, days);
  if (typeof fallback.days === "number") return addDays(base, fallback.days);
  return addMonths(base, fallback.months ?? LEGACY_MEMBER_WINDOW_MONTHS);
};

/** 受付の最終日を `"yyyy-MM-dd"` で返す。 */
export const bookingWindowEndDateKey = (
  configuredDays: number | null | undefined,
  fallback: LegacyWindow,
  now: Date = getJSTNow(),
): string => format(bookingWindowEnd(configuredDays, fallback, now), "yyyy-MM-dd");

/**
 * その日付が受付範囲より先か（＝まだ早すぎて取れないか）。**上限日の当日は取れる。**
 *
 * 🔴 比較は `"yyyy-MM-dd"` の**文字列**で行う。`getJSTNow()` が返すのは
 * 「ローカルのゲッターがJSTの壁時計を返す」プロキシで、`.getTime()` は実時刻ではない
 * （`src/lib/timezone.ts` の IMPORTANT 参照）。ここで実時刻同士の引き算をすると
 * 端末のタイムゾーン次第で1日ズレる。日付キーは辞書順＝時系列順なのでこれで足りる。
 */
export const isBeyondBookingWindow = (
  dateKey: string | null | undefined,
  configuredDays: number | null | undefined,
  fallback: LegacyWindow,
  now: Date = getJSTNow(),
): boolean => {
  if (!dateKey) return false;
  return dateKey > bookingWindowEndDateKey(configuredDays, fallback, now);
};
