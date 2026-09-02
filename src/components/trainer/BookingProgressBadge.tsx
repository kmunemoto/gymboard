import CourseProgressBadge from "./CourseProgressBadge";

/**
 * 予約1件のコース進捗バッジ（「3/8」など）。進捗が出せない予約なら何も描かない。
 *
 * 予定表の**週グリッドと日別カードで同じもの**を出しており、以前は同じ17行の
 * 即時関数が2箇所に写されていた。増えるたびに片方だけ直す事故が起きるので1つにした
 * （`TrainerSchedule` は行数の上限ぎりぎりでもある）。
 *
 * `progress` は `getBookingProgressIndex` の戻り（`null` なら未確定・ブロック枠）。
 */
interface Props {
  progress: {
    index: number;
    total: number | null;
    isUnlimited: boolean;
    isUnconfigured: boolean;
    isOverflow: boolean;
    isGraceCarryover?: boolean;
  } | null;
  className?: string;
}

const BookingProgressBadge = ({ progress, className }: Props) => {
  if (!progress) return null;
  return (
    <CourseProgressBadge
      index={progress.index}
      total={progress.total}
      isUnlimited={progress.isUnlimited}
      isUnconfigured={progress.isUnconfigured}
      isOverflow={progress.isOverflow}
      isGraceCarryover={progress.isGraceCarryover}
      className={className}
    />
  );
};

export default BookingProgressBadge;
