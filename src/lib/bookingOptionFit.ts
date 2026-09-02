/**
 * 「この枠に、このオプションを付けられるか」。
 *
 * ## なぜ別ファイルなのか（2026-09-03・第4段）
 *
 * 第2〜3段では、お客様の予約画面はオプションを**時間を選ぶ前**に選ばせていた。
 * 選択欄がカレンダーと枠グリッドの間にあり、お客様はグリッドへ向かってスクロールする
 * 途中でそこを素通りする。宗本さんの指摘:
 *
 * > オプションが分かりづらい、これは気づかない。下にスクロールしてオプションの存在に
 * > お客さんが予約する時に気づかない。毎回日にちを予約したときに、確認の時にオプションを
 * > 付けるか聞くようにしてください。
 *
 * そこで**枠を選んだあとの確認カードで聞く**形に変えた。すると、枠は先に決まっていて
 * オプションは後から乗るので、「その枠にオプションが入るか」を枠ごとに見る必要が出る。
 *
 * 🔴 **その判定を新しく書き起こしてはいけない。** 画面の判定と DB
 * （`check_booking_overlap`）の判定がずれると、「空きに見えるのに送信すると断られる」
 * ——お客様には何度押しても取れない画面——になる。だから
 * `CustomerBooking.isSlotBlocked` の本体を**ここへ移した**（写したのではない）。
 * 呼び出し側は薄い皮だけになっている。両方に本体があると必ず片方だけ直される。
 *
 * ## 占有の規則はここでは決めない
 *
 * 長さは `sessionFootprintMinutes`（1枠＋オプション＋間、間は最後に1回だけ）、
 * 重なりは `footprintOverlaps`（半開区間）。どちらも `src/lib/bookingOptions.ts` の
 * ものをそのまま使う。ここがやるのは「誰の予約と重なるか」「何人まで受けられるか」の
 * 数え方だけ。
 *
 * ## 既知の穴（ここでは直さない）
 *
 * - **消化リスケの旧枠**: 同日キャンセル消化が有効な店で予約を動かすとき、旧行は
 *   「同日キャンセル済み」で残り DB は占有として数えるが、`exclude` は無条件に外す。
 *   第2段以前からある挙動をそのまま移した（ここで変えると別の不具合の切り分けが
 *   できなくなる）。詳細は `mem/features/booking-options.md`。
 * - **同時受入数の帯をまたぐ占有**: 画面も DB も**開始時刻の帯**しか見ない。
 *   17:00 開始（2人まで）の予約が 18:00 以降（1人まで）に食い込んでも通る。
 *   これも画面と DB が一致しているので「押しても取れない」にはならない。
 */
import {
  type OperatingHours,
  parseTimeToMinutes,
} from "@/lib/businessHours";
import { resolveSlotCapacity, type BookingCapacityWindow } from "@/lib/bookingCapacity";
import { footprintOverlaps, sessionFootprintMinutes, sessionMinutes } from "@/lib/bookingOptions";
import { staffDayMinutes, type StaffScheduleRow } from "@/lib/staffSchedule";
import type { BookedSlot } from "@/lib/bookedSlots";

export interface FootprintBlockedInput {
  bookedSlots: ReadonlyArray<BookedSlot>;
  /** yyyy-MM-dd */
  date: string;
  /** 0=日 … 6=土。同時受入数の帯に使う。 */
  weekday: number | null;
  /** 候補の開始時刻（0時からの分）。 */
  startMinutes: number;
  /** 候補が塞ぐ長さ（分）。`sessionFootprintMinutes` の結果を渡す。 */
  footprintMinutes: number;
  capacityWindows: ReadonlyArray<BookingCapacityWindow> | null | undefined;
  /** 帯が無いときの店の既定値（`tenants.booking_capacity`）。 */
  defaultCapacity: number;
  /** 指名した担当。null なら担当の重なりは見ない（従来どおり）。 */
  staffUserId: string | null;
  /** 占有から外す枠（予約変更中の「元の枠」）。 */
  exclude: { date: string; startTime: string } | null;
}

/**
 * その枠に、その長さの予約を入れられないか。
 *
 * `CustomerBooking.isSlotBlocked` の本体そのもの。最終判定は DB
 * （`check_booking_overlap`）で、ここは同じ規則を画面で先に見せるためにある。
 */
export const isFootprintBlocked = (input: FootprintBlockedInput): boolean => {
  const { bookedSlots, date, startMinutes, footprintMinutes, exclude, staffUserId } = input;

  const overlapping = bookedSlots.filter((b) => {
    if (b.date !== date) return false;
    // 予約変更中は、変更対象（旧枠）を占有としてカウントしない。
    // これで同日の近い時刻（旧枠のバッファ内）にも移動できる（旧枠は削除して作り直すため）。
    if (exclude && b.date === exclude.date && b.startTime === exclude.startTime) return false;
    const bMin = parseTimeToMinutes(b.startTime);
    const bEnd = parseTimeToMinutes(b.endTime);
    // 壊れた行で店を丸ごと塞がない（DB が最終判定なので、ここは通して構わない）
    if (bMin === null || bEnd === null) return false;
    return footprintOverlaps(startMinutes, footprintMinutes, { startMin: bMin, endMin: bEnd });
  });

  // ブロック枠は空きベッド数に関係なく店全体を塞ぐ。それ以外は同時受入数で判定する。
  if (overlapping.some((b) => b.isBlock)) return true;
  // 同時受入数は時間帯で変わりうる（昼は2人・夜は1人など）。帯が無ければ店の既定値。
  const capacityHere = resolveSlotCapacity(
    input.capacityWindows, input.weekday, startMinutes, input.defaultCapacity,
  );
  if (overlapping.length >= capacityHere) return true;
  // 店に空きがあっても、指名した担当がその時間帯に別の予約を持っていれば取れない。
  // 指名なし（staffUserId === null）のときはこの判定を通らない＝従来どおり。
  // DB 側 check_booking_overlap も同じ二段構えで最終判定する。
  return !!staffUserId && overlapping.some((b) => b.staffUserId === staffUserId);
};

/**
 * 「付けられない理由」。お客様への案内を分けるためだけに使う。
 *
 * `occupied` … 後ろの時間に空きが足りない（他の予約・店のブロック・同時受入数・担当）
 * `hours`    … 閉店時刻（指名した担当の勤務終わり）を過ぎてしまう
 *
 * 🔴 「受付しない帯」（GB006）・締切・回数上限はここに出さない。どれも**開始時刻**で
 * 決まるので、オプションを付けても付けなくても同じ答えになる（＝枠グリッドの時点で
 * すでに押せない）。ここに混ぜると、店が意図的に閉めている帯の存在がお客様に見える。
 */
export type OptionFitReason = "occupied" | "hours";

export interface OptionFitInput {
  bookedSlots: ReadonlyArray<BookedSlot>;
  date: string;
  weekday: number | null;
  /** 候補の開始時刻 "HH:MM"。 */
  time: string;
  slotMinutes: number;
  /** 付けようとしているオプションの合計分数。 */
  optionMinutes: number;
  bufferMinutes: number;
  capacityWindows: ReadonlyArray<BookingCapacityWindow> | null | undefined;
  defaultCapacity: number;
  staffUserId: string | null;
  exclude: { date: string; startTime: string } | null;
  businessHours: OperatingHours | null | undefined;
  staffSchedules: ReadonlyArray<StaffScheduleRow> | null | undefined;
}

/**
 * その枠にオプションを付けられるか。付けられるなら null、付けられないなら理由。
 *
 * 🔴 閉店の判定に使うのは `sessionMinutes`（1枠＋オプション）で、**間は入れない**。
 * 枠グリッドの `staffBookingSlotMinutes(hours, totalMinutes, ...)` と同じ長さにしないと、
 * グリッドが出した最後の枠を、こちらが「閉店を過ぎる」と言って弾いてしまう。
 */
export const optionFitReason = (input: OptionFitInput): OptionFitReason | null => {
  const startMinutes = parseTimeToMinutes(input.time);
  if (startMinutes === null) return null;
  if (input.optionMinutes <= 0) return null;

  const day = staffDayMinutes(
    input.businessHours, input.weekday, input.staffSchedules, input.staffUserId,
  );
  if (!day) return "hours";
  if (startMinutes + sessionMinutes(input.slotMinutes, input.optionMinutes) > day.close) {
    return "hours";
  }

  const blocked = isFootprintBlocked({
    bookedSlots: input.bookedSlots,
    date: input.date,
    weekday: input.weekday,
    startMinutes,
    footprintMinutes: sessionFootprintMinutes(
      input.slotMinutes, input.optionMinutes, input.bufferMinutes,
    ),
    capacityWindows: input.capacityWindows,
    defaultCapacity: input.defaultCapacity,
    staffUserId: input.staffUserId,
    exclude: input.exclude,
  });
  return blocked ? "occupied" : null;
};

/**
 * オプションを付けられる、いちばん近い枠。無ければ null。
 *
 * 宗本さんの「後ろが埋まってたら、オプションの時間分予約を早めるように文字を出す」を
 * 実装したもの。ただし**「30分早める」ではなく、実際に付けられる枠を探して出す**。
 * 後ろの予約の位置によっては30分早めても足りないことがあり、機械的にずらした時刻を
 * 案内すると、押した先でまた断られる。
 *
 * 🔴 候補は**素の枠として取れる（`available`）もの**だけ。締切・回数上限・受付しない帯で
 * 押せない枠を提案すると、押した瞬間に DB に断られる。
 *
 * 早い側を優先する（店の意図が「前に詰めてもらう」なので）。前に無ければ後ろを出す。
 */
export const suggestSlotForOption = (
  slots: ReadonlyArray<{ time: string; available: boolean }>,
  selectedTime: string,
  fits: (time: string) => boolean,
): string | null => {
  const selected = parseTimeToMinutes(selectedTime);
  if (selected === null) return null;

  let earlier: { time: string; minutes: number } | null = null;
  let later: { time: string; minutes: number } | null = null;
  for (const s of slots) {
    if (!s.available) continue;
    const minutes = parseTimeToMinutes(s.time);
    if (minutes === null || minutes === selected) continue;
    if (!fits(s.time)) continue;
    if (minutes < selected) {
      if (!earlier || minutes > earlier.minutes) earlier = { time: s.time, minutes };
    } else if (!later || minutes < later.minutes) {
      later = { time: s.time, minutes };
    }
  }
  return (earlier ?? later)?.time ?? null;
};
