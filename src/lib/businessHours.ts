/**
 * 営業時間（tenants.operating_hours）から、予約枠を並べる範囲を求める。
 *
 * ## なぜ1箇所に集めるのか（2026-08-15）
 *
 * **6箇所すべてが別々の数字を直書きしていた。**
 *
 * | 画面 | 直書き | 実際に出ていた範囲 |
 * |---|---|---|
 * | 予約を追加（TrainerSchedule） | `600 → 1260` | 10:00〜21:00 |
 * | 体験予約（TrialBooking） | `600 → 1260` | 10:00〜21:00 |
 * | ドロップイン（DropInBooking） | `600 → 1260` | 10:00〜21:00 |
 * | 週表示（TrainerSchedule） | `600 → 1335` | 10:00〜22:15 |
 * | ブロック枠 開始（TrainerSchedule） | `600 → 1335` | 10:00〜22:15 |
 * | ブロック枠 終了（TrainerSchedule） | `→ 1290` | 〜22:30 |
 *
 * 営業時間を 23:00 にしても、これらは永久に上の時刻で止まる。
 * 設定画面には「お客様の予約画面に表示される営業時間」と書いてあるのに、
 * **お客様側（CustomerBooking）だけが営業時間を読んでいて、店側は読んでいなかった。**
 * つまり「お客様は 22:00 で予約できるのに、店の予約追加画面には 21:00 までしか出ない」
 * という食い違いが起きていた（宗本さんが実機で発見）。
 *
 * ## 分を捨てない
 *
 * CustomerBooking の `parseHour` は `"22:30".split(":")[0]` で**時だけ**を取り、
 * 分を黙って捨てていた。設定画面は 30分刻みで保存できるので、
 * `22:30` を指定すると `22:00` として扱われる。ここでは分まで解釈する。
 *
 * ## 曜日別の営業時間と定休日（2026-08-20）
 *
 * `operating_hours` に `days` を足した。**既存の `start` / `end` は残す。**
 *
 * ```jsonc
 * {
 *   "start": "10:00",          // ← 開いている曜日を通した「いちばん早い開店」
 *   "end":   "23:00",          // ← 開いている曜日を通した「いちばん遅い閉店」
 *   "days": {
 *     "0": null,                                 // 日曜=定休日
 *     "1": { "start": "10:00", "end": "21:00" }, // 月曜
 *     "6": { "start": "09:00", "end": "23:00" }  // 土曜
 *   }
 * }
 * ```
 *
 * ### 🔴 `start` / `end` は「包絡線」として書き続ける
 *
 * `days` を保存するとき、`start`/`end` には**開いている曜日全体を包む最小の範囲**を
 * 入れる（`envelopeFromDays`）。理由は2つ:
 *
 * 1. **古いアプリが端末に残る。** ネイティブアプリなので、`days` を知らない版が
 *    何ヶ月も動き続ける。その版は `start`/`end` しか読まないので、そこに包絡線が
 *    入っていれば「広めに出る」だけで済む。ここに月曜の時間だけを入れてしまうと、
 *    土曜に取れるはずの枠が古い版から消える。**広く出す side に倒す。**
 * 2. `get_tenant_public` は `operating_hours` を jsonb 丸ごと返すので、
 *    **公開ページ用のマイグレーションが要らない**（列を増やしていない）。
 *
 * ### 曜日を渡さない呼び出しは「包絡線」を見る
 *
 * `weekday` を省略した呼び出しは今までどおり `start`/`end`（＝包絡線）で動く。
 * 週表示の時間軸のように「1週間ぶんの行」を作る場所は、これが正しい
 * （どの曜日の枠も収まる軸になる）。日付が決まっている場所だけ `weekday` を渡す。
 */

/** 営業時間の既定値。設定が無い／壊れているテナント向け。 */
export const DEFAULT_OPEN_MINUTES = 10 * 60; // 10:00
export const DEFAULT_CLOSE_MINUTES = 21 * 60; // 21:00

/** 枠を並べる刻み（分）。営業時間とは独立した表示上の粒度。 */
export const SLOT_STEP_MINUTES = 15;

/**
 * 1日の終わり（分）。**終業だけに使える特別な値** `"24:00"` に対応する。
 *
 * 24時間営業のジムは珍しくないので、終業として「その日いっぱい」を表せる必要がある。
 * `"23:59"` で代用すると枠の計算に半端な1分が混ざるため、`24:00 = 1440` を正とする。
 * 開店側には使わない（`"24:00"` に開店する店は無い）。
 */
export const DAY_END_MINUTES = 24 * 60;

/** 曜日（JS の `Date.getDay()` と同じ。0=日曜 … 6=土曜）。 */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** 1曜日ぶんの営業時間。`null` は**定休日**。 */
export interface DayHours {
  start?: string | null;
  end?: string | null;
}

export interface OperatingHours {
  /** 開いている曜日を通した「いちばん早い開店」。曜日別が無いときは全曜日の開店。 */
  start?: string | null;
  /** 開いている曜日を通した「いちばん遅い閉店」。曜日別が無いときは全曜日の閉店。 */
  end?: string | null;
  /**
   * 曜日別の営業時間。キーは `"0"`（日）〜`"6"`（土）の文字列。
   * - キーが無い曜日 … `start`/`end` を使う（＝曜日別を設定していない店は従来どおり）
   * - 値が `null` … **定休日**
   */
  days?: Record<string, DayHours | null> | null;
}

/**
 * `"HH:MM"` を0時からの分に変換する。**分を捨てない。**
 * 解釈できない値（空・`"あ"`・`"25:00"`・`"10:70"`）は null を返す。
 */
export const parseTimeToMinutes = (t?: string | null): number | null => {
  if (!t) return null;
  const trimmed = t.trim();
  // 🔴 "24:00" だけは特別扱い（終業＝その日いっぱい。24時間営業のため）。
  //    "24:30" や "25:00" は下の h > 23 で従来どおり弾く。
  if (trimmed === "24:00") return DAY_END_MINUTES;
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};

/** 営業時間を分に解決する（不正値・逆転は既定値に落とす）。曜日別は見ない＝包絡線。 */
export const resolveBusinessMinutes = (
  hours?: OperatingHours | null,
): { open: number; close: number } => {
  const open = parseTimeToMinutes(hours?.start) ?? DEFAULT_OPEN_MINUTES;
  const close = parseTimeToMinutes(hours?.end) ?? DEFAULT_CLOSE_MINUTES;
  // 終業が開店以前だと枠が1つも出ない（画面が真っ白になる）。既定値に戻す。
  if (close <= open) return { open: DEFAULT_OPEN_MINUTES, close: DEFAULT_CLOSE_MINUTES };
  return { open, close };
};

/**
 * `"yyyy-MM-dd"` → 曜日（0=日 … 6=土）。解釈できなければ null。
 *
 * 🔴 **`new Date("2026-08-20").getDay()` を使わないこと。**
 * `getDay()` は実行環境のタイムゾーンで曜日を出すので、CI（UTC）と端末（JST）で
 * 答えが変わる。日付キーは既に「JSTの暦日」であってタイムゾーンを持たないので、
 * 数字をそのまま UTC に置いて `getUTCDay()` で読むのが唯一ブレない方法。
 */
export const weekdayOfDateKey = (dateKey?: string | null): number | null => {
  if (!dateKey) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // "2026-02-31" のような存在しない日は Date が繰り上げる。繰り上がったら無効とみなす。
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.getUTCDay();
};

/** 曜日別の設定を持っているか（1曜日でも `days` にキーがあれば true）。 */
export const hasPerDayHours = (hours?: OperatingHours | null): boolean => {
  const days = hours?.days;
  return !!days && typeof days === "object" && Object.keys(days).length > 0;
};

/**
 * **その曜日の**営業時間を分に解決する。**定休日なら null。**
 *
 * - `weekday` が null/undefined … 曜日を問わない包絡線（`resolveBusinessMinutes`）
 * - `days` にキーが無い曜日 … 包絡線（＝曜日別を使っていない店は従来どおり）
 * - `days[weekday]` が `null` … 定休日 → `null`
 * - 時刻が壊れている／逆転している … その曜日は**定休日ではなく**包絡線に倒す
 *   （設定ミスで店が丸ごと予約不能になるほうが実害が大きい）
 */
export const resolveDayBusinessMinutes = (
  hours: OperatingHours | null | undefined,
  weekday?: number | null,
): { open: number; close: number } | null => {
  const fallback = resolveBusinessMinutes(hours);
  if (weekday == null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return fallback;
  const days = hours?.days;
  if (!days || typeof days !== "object") return fallback;
  if (!Object.prototype.hasOwnProperty.call(days, String(weekday))) return fallback;
  const entry = days[String(weekday)];
  if (entry === null || entry === undefined) return null; // 定休日
  const open = parseTimeToMinutes(entry.start);
  const close = parseTimeToMinutes(entry.end);
  if (open === null || close === null || close <= open) return fallback;
  return { open, close };
};

/** その曜日が定休日か。 */
export const isClosedWeekday = (
  hours: OperatingHours | null | undefined,
  weekday?: number | null,
): boolean => resolveDayBusinessMinutes(hours, weekday) === null;

/** その日付（`"yyyy-MM-dd"`）が定休日か。日付が壊れていれば false（＝閉めない）。 */
export const isClosedDate = (
  hours: OperatingHours | null | undefined,
  dateKey?: string | null,
): boolean => {
  const weekday = weekdayOfDateKey(dateKey);
  if (weekday === null) return false;
  return isClosedWeekday(hours, weekday);
};

/** 定休日の曜日一覧（昇順）。設定していなければ空配列。 */
export const closedWeekdays = (hours?: OperatingHours | null): number[] =>
  WEEKDAYS.filter((d) => isClosedWeekday(hours, d));

/**
 * 曜日別の設定から `start`/`end`（包絡線）を作る。**保存時に必ず通すこと。**
 *
 * 開いている曜日が1つも無ければ既定値を返す（`start > end` を書かない）。
 * これがファイル冒頭に書いた「古いアプリが端末に残る」への対策の実体。
 */
export const envelopeFromDays = (
  days: Record<string, DayHours | null> | null | undefined,
): { start: string; end: string } => {
  let open: number | null = null;
  let close: number | null = null;
  for (const d of WEEKDAYS) {
    const entry = days?.[String(d)];
    if (entry === null || entry === undefined) continue;
    const o = parseTimeToMinutes(entry.start);
    const c = parseTimeToMinutes(entry.end);
    if (o === null || c === null || c <= o) continue;
    open = open === null ? o : Math.min(open, o);
    close = close === null ? c : Math.max(close, c);
  }
  if (open === null || close === null) {
    return { start: minutesToTime(DEFAULT_OPEN_MINUTES), end: minutesToTime(DEFAULT_CLOSE_MINUTES) };
  }
  return { start: minutesToTime(open), end: minutesToTime(close) };
};

/**
 * **予約枠**（お客様の予約・予約を追加・体験・ドロップイン）の開始時刻を並べる。
 *
 * 施術が終業までに終わる必要があるので、最後の開始は `終業 − 枠の長さ`。
 * 例: 営業 10:00-23:00 / 枠60分 → 最後は 22:00（22:00+60分=23:00）。
 *
 * `weekday` を渡すとその曜日の営業時間で並べる。**定休日なら空配列。**
 */
export const bookingSlotMinutes = (
  hours: OperatingHours | null | undefined,
  slotMinutes: number,
  weekday?: number | null,
  step: number = SLOT_STEP_MINUTES,
): number[] => {
  const day = resolveDayBusinessMinutes(hours, weekday);
  if (!day) return [];
  const lastStart = day.close - slotMinutes;
  const out: number[] = [];
  for (let m = day.open; m <= lastStart; m += step) out.push(m);
  return out;
};

/**
 * **営業時間そのもの**を並べる（週表示の行・ブロック枠の開始）。
 *
 * 予約枠と違って施術の長さを引かない。ブロック枠は「休憩」「設営」なので、
 * 終業ちょうどまで置けてよい。最後は `終業 − 刻み`（終業ちょうどに開始はできない）。
 *
 * `weekday` を省略すると包絡線で並べる。週表示の行はこちら
 * （どの曜日の枠も収まる行が必要なので、曜日で狭めてはいけない）。
 */
export const businessGridMinutes = (
  hours: OperatingHours | null | undefined,
  weekday?: number | null,
  step: number = SLOT_STEP_MINUTES,
): number[] => {
  const day = resolveDayBusinessMinutes(hours, weekday);
  if (!day) return [];
  const out: number[] = [];
  for (let m = day.open; m <= day.close - step; m += step) out.push(m);
  return out;
};

/**
 * ブロック枠の**終了**時刻を並べる（開始より後、終業まで）。
 * 終業ちょうどで終われる。
 *
 * 🔴 **ただし 24:00 は出さない（`24:00 − 刻み` で打ち切る）。**
 * ブロック枠は `blocked_slots.end_blocked_date` に
 * `` `${日付}T${時刻}:00+09:00` `` の形で保存される。`"24:00"` を入れると
 * **翌日の 00:00 として保存され、読み戻したときに `endTime` が `"00:00"` になる**。
 * すると重なり判定（`開始 < 終了`）が成立せず、**そのブロックが何も塞がなくなる**。
 * 24時間営業の店でも、最後の1刻みは別の手段（営業時間の設定）で塞ぐこと。
 */
export const blockEndMinutes = (
  hours: OperatingHours | null | undefined,
  startMinutes: number,
  weekday?: number | null,
  step: number = SLOT_STEP_MINUTES,
): number[] => {
  const day = resolveDayBusinessMinutes(hours, weekday);
  if (!day) return [];
  const last = Math.min(day.close, DAY_END_MINUTES - step);
  const out: number[] = [];
  for (let m = startMinutes + step; m <= last; m += step) out.push(m);
  return out;
};

/** 分を `"HH:MM"` に戻す。 */
export const minutesToTime = (total: number): string => {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/**
 * **タイムライン表示（週表示）の時間軸**を求める。
 *
 * 軸は「時」単位の目盛りなので、開店は切り捨て・閉店は切り上げて、
 * 営業時間が丸ごと収まるようにする（10:30-22:30 なら 10:00-23:00 の軸）。
 *
 * 🔴 **営業時間の外にある予約も必ず軸に含める。**
 * 営業時間を狭めると、それ以前に入っていた予約が軸からはみ出して
 * **画面から消える**（負の座標に描かれてスクロールしても出てこない）。
 * 予約が消えたように見えるのは実害が大きいので、軸のほうを広げる。
 *
 * 週表示は7日ぶんを1枚に描くので、**曜日別があっても包絡線で軸を作る**
 * （曜日ごとに軸の高さが変わると行がガタつくうえ、他の曜日の予約が描けない）。
 *
 * @param bookingMinutes 表示対象の予約の開始・終了（分）。空でよい。
 */
export const timelineHourRange = (
  hours: OperatingHours | null | undefined,
  bookingMinutes: ReadonlyArray<{ start: number; end: number }> = [],
): { startHour: number; endHour: number } => {
  const { open, close } = resolveBusinessMinutes(hours);
  let startHour = Math.floor(open / 60);
  let endHour = Math.ceil(close / 60);
  for (const b of bookingMinutes) {
    if (!Number.isFinite(b.start) || !Number.isFinite(b.end)) continue;
    startHour = Math.min(startHour, Math.floor(b.start / 60));
    endHour = Math.max(endHour, Math.ceil(b.end / 60));
  }
  // endHour > startHour は常に成り立つ（resolveBusinessMinutes が close > open を
  // 保証し、endHour は切り上げ・startHour は切り捨てのため）。
  // 保険の分岐を書いたが到達できず、変異検証で「消しても赤くならない」＝死んだコードだと
  // 分かったので置いていない。不変条件はテスト側で検査する。
  return { startHour, endHour: Math.min(endHour, 24) };
};
