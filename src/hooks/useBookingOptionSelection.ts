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
 * 🔴 `onChange` で必ず**選択中の枠を外す**こと。オプションを足すと占有が伸びるので
 * （60分 → 90分＋間15分＝105分）、選んだ時刻がもう取れない枠になっている場合がある。
 * 外さないと「画面では選べているのに送信すると DB に断られる」になる。
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
