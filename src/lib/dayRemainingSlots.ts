/**
 * お客様の予約カレンダーに出す「その日の残り枠」（2026-10-06）。
 *
 * 宗本さん（予約画面のスクリーンショット）:
 *
 * > お客様側の予約サイトで各日にちが残り何枠空いているかリアルタイムで表示される機能を追加して
 *
 * ## 🔴 「枠」は開始時刻の数ではない
 *
 * 予約の開始時刻は **15分刻み**で並ぶ（`staffBookingSlotMinutes`）。御所南
 * （10:00〜22:30・60分）なら 1日47通りある。これを数えると「残47」になり、
 * お客様にとって意味のない数字になる。
 *
 * 数えるのは **「その日、あと何回（何人）入れられるか」**。
 * 朝から順に、取れる最初の時刻に1回ぶん（1枠＋間）を置き、置いたものも
 * 「埋まっている」として次を探す——を繰り返した回数。
 * 同時に1人の店では、これが入れられる最大の回数になる（同じ長さの予定を
 * 早い順に詰めるのが最適、という性質）。同時に複数人の店でも、帯ごとの受入数まで
 * 同じ判定（`isFootprintBlocked`）で数えるので、画面の枠一覧とズレない。
 *
 * ## 何を「取れない」とするか（`isDayFull` と同じ）
 *
 *   効く     … 他の予約・店のブロック・同時受入数・指名した担当の重なり
 *              ／受付しない時間帯／予約の締切（当日の分）
 *   効かない … **その人の事情**（予約回数の制限・プランの残り回数）。
 *              日付の空きではないので数えない（`bookingDayFull.ts` と同じ理由）。
 *
 * 判定の式は持たない。呼ぶ側の `isSlotBlocked` と同じ材料を受け取って
 * `isFootprintBlocked` に渡すだけ。ここに式を写すと、カレンダーの数字と
 * 押した先の枠一覧が食い違う。
 */
import { isFootprintBlocked, type FootprintBlockedInput } from "@/lib/bookingOptionFit";
import { minutesToTime } from "@/lib/businessHours";
import type { BookedSlot } from "@/lib/bookedSlots";
import type { DayUnselectableReason } from "@/lib/bookingCalendarDay";

/** これ以下なら「残りわずか」として色を変える。 */
export const FEW_REMAINING_SLOTS = 2;

export interface RemainingSlotsInput
  extends Omit<FootprintBlockedInput, "startMinutes" | "bookedSlots"> {
  /** その日に出る枠の開始時刻（分）。営業時間・担当のシフトを反映済みのもの（枠一覧と同じ）。 */
  starts: readonly number[];
  /** その日の占有（`bookedSlotsOnDate` の結果）。 */
  bookedSlots: ReadonlyArray<BookedSlot>;
  /** 重なり以外の理由で、その開始時刻を受けないか（受付しない時間帯・締切）。 */
  isClosedAt: (startMinutes: number) => boolean;
}

/** その日、あと何回入れられるか。 */
export const countRemainingSlots = (input: RemainingSlotsInput): number => {
  const { starts, isClosedAt, bookedSlots, ...rest } = input;
  const placed: BookedSlot[] = [];
  for (const m of starts) {
    if (isClosedAt(m)) continue;
    const taken = isFootprintBlocked({
      ...rest,
      bookedSlots: placed.length === 0 ? bookedSlots : [...bookedSlots, ...placed],
      startMinutes: m,
    });
    if (taken) continue;
    // 置いた1回ぶんも「埋まっている」として次を探す（間 buffer も含めた長さで塞ぐ）
    placed.push({
      date: rest.date,
      startTime: minutesToTime(m),
      endTime: minutesToTime(m + rest.footprintMinutes),
      isBlock: false,
      staffUserId: rest.staffUserId,
    });
  }
  return placed.length;
};

export type DayRemainingBadge =
  | { kind: "remaining"; count: number; few: boolean }
  | { kind: "full" }
  | null;

/**
 * カレンダーの日付の下に何を出すか。
 *
 * - 選べる日 … 「残N」（N が少なければ色を変える）。0 なら何も出さない
 *   （当日で締切を過ぎた日など。押せるが取れない＝数字を出すと誤解させる）
 * - **満枠・1日の上限に達した日・受付を止めた日**は「満」。定休日・予約できる範囲の外などは何も出さない
 *
 * 受付を止めた日（ジムが手で受付終了にした日。トレーナー側の「受付停止中」）も「満」にする
 * （2026-10-07 宗本さん「受付停止中も満と表示するようにして、枠の上限と同意味」）。
 * お客様から見れば「その日はもう取れない」で同じ。定休日（曜日で決まった休み）は今まで通り出さない。
 */
export const dayRemainingBadge = (
  reason: DayUnselectableReason | null,
  /** 残りの回数。選べない日では数えないで済むよう、関数でも受ける */
  count: number | (() => number),
): DayRemainingBadge => {
  // 満枠の日・1日の上限人数に達した日・受付を止めた日は「満」（お客様にはどれも「もう取れない日」）
  if (reason === "full" || reason === "limitReached" || reason === "hardClosed") return { kind: "full" };
  if (reason !== null) return null;
  const n = typeof count === "function" ? count() : count;
  if (n <= 0) return null;
  return { kind: "remaining", count: n, few: n <= FEW_REMAINING_SLOTS };
};
