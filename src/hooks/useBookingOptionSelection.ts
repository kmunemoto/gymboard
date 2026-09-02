import { useState } from "react";
import { useBookingOptions } from "@/hooks/useBookingOptions";
import {
  buildOptionSnapshot,
  optionMinutesFor,
  type BookingOption,
  type BookingOptionSnapshot,
} from "@/lib/bookingOptions";

/**
 * 「予約に付けるオプションを選ぶ」状態ひとまとめ。
 *
 * お客様の予約画面（`CustomerBooking`）と店側の代理予約（`TrainerSchedule`）の
 * 両方で使う。どちらも1ファイルの行数上限（`src/test/qualityRatchet.test.ts`）が
 * すぐそこなので、選択の state・合計分数・保存用の控えをここにまとめる。
 *
 * 🔴 オプションを足すと占有が伸びる（60分 → 90分＋間15分＝105分）ので、選んだ時刻が
 * もう取れない枠になっていることがある。放っておくと「画面では選べているのに送信すると
 * DB に断られる」になる。**揃え方は画面ごとに違う**（2026-09-03 第4段で分かれた）:
 *
 * - お客様の予約画面 … `onChange` を**渡さない**。枠は保持したまま、確認カードで
 *   その枠に入るかを見る（`src/lib/bookingOptionFit.ts`）。毎回付ける人が枠を選び直す
 *   たびにオプションを付け直さずに済む。
 * - 店側の代理予約 … `onChange` で選択中の時刻を外し、枠の一覧をオプション込みで作り直す。
 */
export function useBookingOptionSelection(opts: { onChange?: () => void } = {}): {
  options: BookingOption[];
  selectedIds: string[];
  toggle: (optionId: string) => void;
  reset: () => void;
  /** 選択中のオプションの合計時間（分）。 */
  minutes: number;
  /** 保存用の控え（`bookings.booking_options`）。 */
  snapshot: BookingOptionSnapshot[];
} {
  const { options } = useBookingOptions();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggle = (optionId: string) => {
    setSelectedIds((prev) =>
      prev.includes(optionId) ? prev.filter((x) => x !== optionId) : [...prev, optionId],
    );
    opts.onChange?.();
  };

  return {
    options,
    selectedIds,
    toggle,
    reset: () => setSelectedIds([]),
    minutes: optionMinutesFor(options, selectedIds),
    snapshot: buildOptionSnapshot(options, selectedIds),
  };
}
