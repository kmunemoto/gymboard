import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

/**
 * 空き枠のグリッド（4列・15分刻み）。お客様の予約画面から切り出した部品。
 *
 * 🔴 受付しない帯（`notAccepting`）の枠は、表示も挙動も「普通に埋まっている枠」と
 * **完全に同一**にする（2026-08-23 店の要望）。ラベルだけ揃えても、帯だけ押せない・
 * 文字が薄い・空き待ちに出せない、が同じグリッドに並ぶと「この時間だけ扱いが違う」と
 * 分かってしまう。そこで表示層では帯を `blocked` と同一視する（`displayBlocked`）。
 * 空き通知は実際の予約のキャンセルでしか発火しないので、帯の枠に待機者が付いても
 * 「誰もキャンセルしない満枠」として静かに待つだけになる。
 *
 * 🔴 グリッドは**素の枠**（オプション無し）で作る。オプションを付けられるかは、枠を
 * 押したあとの確認カードで枠ごとに見る（`src/lib/bookingOptionFit.ts`）。
 * オプションでグリッドを絞ると、「満枠」の意味が変わり、実際には空いている枠に
 * キャンセル待ちが付く。
 */
export interface BookingSlot {
  id: string;
  /** HH:MM */
  time: string;
  available: boolean;
  blocked: boolean;
  tooSoon: boolean;
  overLimit: boolean;
  notAccepting: boolean;
}

interface Props {
  slots: ReadonlyArray<BookingSlot>;
  selectedSlotId: string | null;
  onSelect: (slotId: string) => void;
  /** キャンセル待ちの登録/解除を確認する（フラグ ON かつ満枠の枠だけ呼ばれる）。 */
  onWaitlist: (time: string, alreadyOn: boolean) => void;
  /** キャンセル待ち機能そのものが有効か（`WAITLIST_ENABLED`）。 */
  waitlistEnabled: boolean;
  isOnWaitlist: (time: string) => boolean;
}

const BookingSlotGrid = ({
  slots, selectedSlotId, onSelect, onWaitlist, waitlistEnabled, isOnWaitlist,
}: Props) => {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {slots.map((slot) => {
        const displayBlocked = slot.blocked || slot.notAccepting;
        // 満枠（埋まっている＝displayBlocked かつ 締切前）はキャンセル待ち登録可能（フラグON時のみ）。
        // 回数上限の枠はキャンセル待ちの対象にもしない（空きを待っても自分は取れない）。
        const waitlistable =
          waitlistEnabled && !slot.available && displayBlocked && !slot.tooSoon && !slot.overLimit;
        const listed = waitlistable && isOnWaitlist(slot.time);
        // 当日など締切済みの日の「空いている枠」。予約は不可だが空き状況として区別表示する。
        const viewOnlyOpen = slot.tooSoon && !displayBlocked;
        return (
          <button
            key={slot.id}
            type="button"
            disabled={!slot.available && !waitlistable}
            onClick={() => {
              if (slot.available) onSelect(slot.id);
              else if (waitlistable) onWaitlist(slot.time, listed);
            }}
            className={`relative rounded-lg p-2 text-center text-xs font-semibold transition-all duration-200 min-h-[44px] ${
              slot.available
                ? selectedSlotId === slot.id
                  ? "accent-gradient text-accent-foreground shadow-md scale-105"
                  : "bg-card border border-border hover:border-accent hover:shadow-sm"
                : viewOnlyOpen
                  ? "bg-accent/10 border border-accent/40 text-foreground cursor-default"
                  : waitlistable
                    ? "bg-muted text-muted-foreground/60 hover:bg-muted/80"
                    : "bg-muted text-muted-foreground/40 cursor-not-allowed"
            }`}
          >
            <span>{slot.time}</span>
            {!slot.available && (
              <span className="block text-[9px] font-medium">
                {/* 受付しない帯は「満枠」と完全に同じ表示にする。「受付外」と出すと帯で
                    意図的に閉めていることがお客様に見えるため、普通に埋まった枠と
                    見分けが付かないようにする。判定は displayBlocked に寄せてあるので、
                    帯だけ別のラベルになることが構造的に起きない。 */}
                {slot.overLimit && !displayBlocked
                  ? <span className="text-muted-foreground">{t("bookingLimits.slotLimitReached")}</span>
                  : viewOnlyOpen
                    ? <span className="text-accent">{t("booking.slotOpen")}</span>
                    : <span className="text-destructive/70">{t("booking.slotFull")}</span>}
              </span>
            )}
            {/* キャンセル待ち登録済みは満枠の見た目のまま、隅の小さいドットだけで示す
                （文字ラベルを変えると満枠だらけのグリッドが「キャンセル待ち」で埋まって見づらくなる） */}
            {listed && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-warning" aria-hidden="true" />
            )}
            {selectedSlotId === slot.id && (
              <Check className="w-2.5 h-2.5 absolute top-0.5 right-0.5" />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default BookingSlotGrid;
