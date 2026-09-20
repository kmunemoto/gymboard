import { useTranslation } from "react-i18next";
import { Ban, CalendarCheck, Infinity as InfinityIcon, Users } from "lucide-react";
import type { ClosedDay } from "@/lib/bookingClosedDays";

interface Props {
  /** JST の日付（yyyy-MM-dd） */
  dateKey: string;
  /** その日が閉まっていれば理由つきの行。開いていれば null */
  closed: ClosedDay | null;
  /** その日に入っている件数（ブロック枠は含まない） */
  bookedCount: number;
  /** 店の1日の上限。未設定なら null */
  dailyLimit: number | null;
  /** その日だけ「1日の上限人数」を適用しない指定があるか（2026-09-20） */
  uncapped: boolean;
  saving: boolean;
  onClose: (dateKey: string) => void;
  onReopen: (dateKey: string) => void;
  /** 上限を外す（オレンジをタップ） */
  onLiftCap: (dateKey: string) => void;
  /** 上限を戻す（「上限なし」をタップ） */
  onRestoreCap: (dateKey: string) => void;
  compact?: boolean;
}

/**
 * その日の受付を止める／解除する、1タップのスイッチ。
 *
 * 実店舗の要望（2026-09-01 宗本さん）:「枠を1つずつブロックするのは面倒。
 * その日はもう受けない、を一発でやりたい。空いたらすぐ解除できるように」。
 *
 * 状態は3つ:
 *   受付中          … 押すと止まる
 *   受付停止中(手動) … 押すと戻る（＝すぐ解除できる、が要望の後半）
 *   上限に達した     … 押すと**その日だけ上限なし**になる（2026-09-20 に追加）
 *   上限なし        … 押すと上限が戻る。件数が上限以上なら、その場でまた「上限に達した」へ
 *
 * ## 🔴 「上限に達した」を押せるようにした（2026-09-20 宗本さんの要望）
 *
 * > ベースは1日4人。特定の日はそのルールを適応しない様にしたい。
 * > 日にちを2回目のタップを押したらルールを外せるとかの仕様を追加してほしい。
 *
 * それまでは押せない札だった（「解除したのにまた閉まる」を避けるため）。
 * **解除の実体を `booking_uncapped_days` に持たせた**ので、押しても閉まり直さない。
 *
 * ⚠️ 1回目のタップは既に「受付を止める」に使われているので、
 *    3状態を1つのボタンで回すと戻すのに3回押すことになる。そこで
 *    **オレンジ（上限で閉まった状態）からだけ**上限を外せるようにしてある。
 *    上限に達していない日は、そもそも上限が邪魔をしていないので外す必要が無い。
 *
 * ## 🔴 手で止めた日のほうが強い
 *
 * 「上限なし」にした日でも、店が手で閉めれば赤（受付停止中）になる。
 * 判定は DB の `tenant_day_closed` が先に手動を見てから上限なしを見る。
 * ここの分岐の順番も**それに合わせてある**（closed を先に見る）。
 */
const DayReceptionToggle = ({
  dateKey, closed, bookedCount, dailyLimit, uncapped, saving,
  onClose, onReopen, onLiftCap, onRestoreCap, compact,
}: Props) => {
  const { t } = useTranslation();
  const size = compact ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-1";

  // 🔴 上限で自動的に閉まっている日。押すと「この日だけ上限なし」になる。
  //    順番が大事: 手で閉めた日（下の closed）より**後**に見えるが、
  //    closed.manual が true のときはここに入らないので、手動のほうが強いまま。
  if (closed && !closed.manual) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => onLiftCap(dateKey)}
        aria-label={t("closedDays.uncapAria", { date: dateKey })}
        title={t("closedDays.atLimitHelp", { limit: dailyLimit ?? bookedCount })}
        className={`inline-flex items-center gap-1 rounded-full font-bold transition-colors bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 ${size}`}
      >
        <Users className="w-3 h-3" />
        {t("closedDays.atLimit")}
      </button>
    );
  }

  // 上限を外した日。押すと元に戻る（件数が上限以上なら、その場でまた上の札になる）。
  if (uncapped) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => onRestoreCap(dateKey)}
        aria-label={t("closedDays.recapAria", { date: dateKey })}
        title={t("closedDays.uncappedHelp")}
        className={`inline-flex items-center gap-1 rounded-full font-bold transition-colors bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50 ${size}`}
      >
        <InfinityIcon className="w-3 h-3" />
        {t("closedDays.uncapped")}
      </button>
    );
  }

  if (closed) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => onReopen(dateKey)}
        aria-label={t("closedDays.reopenAria", { date: dateKey })}
        className={`inline-flex items-center gap-1 rounded-full font-bold transition-colors bg-destructive/15 text-destructive hover:bg-destructive/25 disabled:opacity-50 ${size}`}
      >
        <Ban className="w-3 h-3" />
        {t("closedDays.closedTapToReopen")}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      onClick={() => onClose(dateKey)}
      aria-label={t("closedDays.closeAria", { date: dateKey })}
      className={`inline-flex items-center gap-1 rounded-full font-semibold transition-colors text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 ${size}`}
    >
      <CalendarCheck className="w-3 h-3" />
      {dailyLimit
        ? t("closedDays.openWithCount", { count: bookedCount, limit: dailyLimit })
        : t("closedDays.stopReception")}
    </button>
  );
};

export default DayReceptionToggle;
