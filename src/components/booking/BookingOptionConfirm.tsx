import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { BookingOption } from "@/lib/bookingOptions";
import type { OptionFitReason } from "@/lib/bookingOptionFit";

/**
 * 予約の確認カードの中で「オプションを付けますか？」と聞く欄。
 *
 * ## なぜ確認カードの中なのか（2026-09-03・第4段）
 *
 * 第2〜3段は枠グリッドの**手前**に選択欄を置いていた。宗本さんの指摘:
 * 「オプションが分かりづらい、これは気づかない。下にスクロールしてオプションの存在に
 * お客さんが予約する時に気づかない。毎回日にちを予約したときに、確認の時にオプションを
 * 付けるか聞くようにしてください」。
 *
 * お客様は日付を選んだ瞬間からグリッドへ向かってスクロールしていて、その途中にあるものは
 * 読まれない。読まれるのは**指が止まる場所**——枠を押したあとに出る確認カード——だけ。
 * だからここで聞く。ダイアログにしないのは、付けない人（大多数）にも毎回1タップ増え、
 * 「この内容で予約する」が最終確定でなくなるため。
 *
 * ## 🔴 付けられないときは、文字ではなくボタンを出す
 *
 * 宗本さんは「後ろが埋まってたら、オプションの時間分予約を早めるように文字を出す」と
 * 言ったが、文字だけだとお客様は画面を上に戻って別の枠を探し、また予約ボタン、
 * また同じ案内、の往復になる。混む夜の帯では 3,000円 どころか **60分の予約ごと落ちる**。
 * そこで「21:00 に変更してストレッチを付ける」を1タップにして、早める作業をアプリがやる。
 * あわせて「付けずにこの時間で予約する」の逃げ道を必ず出す（トレーニングだけの予約を
 * 取りこぼさないため）。
 *
 * 提案する時刻は**実際に付けられる枠を探した結果**であって「30分前」ではない
 * （`suggestSlotForOption`）。機械的にずらすと、押した先でまた断られる。
 *
 * この部品は純粋（supabase も i18n の外の状態も持たない）。判定は
 * `src/lib/bookingOptionFit.ts`、呼び出しは `CustomerBooking.tsx`。
 */
interface Props {
  options: ReadonlyArray<BookingOption>;
  selectedIds: ReadonlyArray<string>;
  onToggle: (optionId: string) => void;
  /** 選択中の枠の開始時刻 "HH:MM"。案内の文言に出す。 */
  selectedTime: string;
  /** 付けられない理由。付けられる／何も選んでいないときは null。 */
  notFitReason: OptionFitReason | null;
  /** 付けられる、いちばん近い枠。無ければ null（＝その日は付けられない）。 */
  suggestTime: string | null;
  onMoveTo: (time: string) => void;
  /** 「付けずにこの時間で予約する」。オプション無しでそのまま予約を確定させる。 */
  onBookWithout: () => void;
  disabled?: boolean;
}

const BookingOptionConfirm = ({
  options, selectedIds, onToggle, selectedTime,
  notFitReason, suggestTime, onMoveTo, onBookWithout, disabled,
}: Props) => {
  const { t } = useTranslation();
  if (options.length === 0) return null;

  const chosen = options.filter((o) => selectedIds.includes(o.id));
  // 案内の文言に出す名前。複数付けているときは並べる。
  const names = chosen.map((o) => o.name).join("・");
  const none = chosen.length === 0;

  const meta = (o: BookingOption) => (
    <span className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-muted-foreground">
      {o.duration_minutes > 0 && (
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {t("bookingOptions.pickerPlusMinutes", { count: o.duration_minutes })}
        </span>
      )}
      {/* 0 は「無料」ではなく「料金を表示しない」 */}
      {o.price_yen > 0 && (
        <span>{t("bookingOptions.pickerPrice", { price: o.price_yen.toLocaleString() })}</span>
      )}
    </span>
  );

  const only = options.length === 1 ? options[0] : null;

  return (
    <div className="mb-3 text-left rounded-xl bg-background/60 p-3" data-testid="booking-option-confirm">
      <p className="text-[11px] font-bold text-muted-foreground mb-2 flex items-center gap-1">
        <Sparkles className="w-3 h-3" />
        {t("bookingOptions.confirmTitle")}
      </p>

      {only ? (
        // オプションが1つだけの店（いちばん多い形）は、2択のタイルにして見落とさせない。
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            data-testid="booking-option-none"
            aria-pressed={none}
            disabled={disabled}
            onClick={() => { if (!none) onToggle(only.id); }}
            className={`rounded-lg border p-2.5 min-h-[56px] text-sm font-bold transition-all ${
              none ? "border-accent bg-accent/10 text-foreground" : "border-border bg-card text-muted-foreground"
            } ${disabled ? "opacity-60" : ""}`}
          >
            {t("bookingOptions.confirmNone")}
          </button>
          <button
            type="button"
            data-testid="booking-option-tile"
            aria-pressed={!none}
            disabled={disabled}
            onClick={() => { if (none) onToggle(only.id); }}
            className={`relative rounded-lg border p-2.5 min-h-[56px] transition-all ${
              none ? "border-border bg-card" : "border-accent bg-accent/10"
            } ${disabled ? "opacity-60" : ""}`}
          >
            {!none && <Check className="w-3 h-3 absolute top-1 right-1 text-accent" />}
            <span className="block text-sm font-bold break-words">{only.name}</span>
            {meta(only)}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {options.map((o) => {
            const checked = selectedIds.includes(o.id);
            return (
              <label
                key={o.id}
                data-testid="booking-option-row"
                className={`flex items-center gap-2.5 rounded-lg border p-2.5 min-h-[56px] transition-colors ${
                  checked ? "border-accent bg-accent/10" : "border-border bg-card"
                } ${disabled ? "opacity-60" : "cursor-pointer"}`}
              >
                <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => onToggle(o.id)} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-bold break-words">{o.name}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {o.duration_minutes > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {t("bookingOptions.pickerPlusMinutes", { count: o.duration_minutes })}
                      </span>
                    )}
                    {o.price_yen > 0 && (
                      <span>{t("bookingOptions.pickerPrice", { price: o.price_yen.toLocaleString() })}</span>
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* 🔴 付けられないときの案内。色は destructive ではなく warning にする。
          お客様が読むべき一文目は「この枠がダメ」ではなく「トレーニングは取れる」。
          以前 ON にしたまま忘れている人が赤い警告を見ると、枠自体が取れないと誤解して
          別の枠を探し回る（実際にはトレーニングだけなら取れる）。 */}
      {notFitReason && !none && (
        <div className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 space-y-2">
          <p className="text-xs font-bold flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0 text-warning" />
            <span>{t("bookingOptions.notFitTitle", { time: selectedTime })}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {notFitReason === "hours"
              ? t("bookingOptions.notFitHours", { name: names })
              : t("bookingOptions.notFitOccupied", { name: names })}
          </p>
          {suggestTime ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full h-10 whitespace-normal"
              data-testid="booking-option-move"
              disabled={disabled}
              onClick={() => onMoveTo(suggestTime)}
            >
              <span className="line-clamp-2">
                {t("bookingOptions.notFitMove", { time: suggestTime, name: names })}
              </span>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("bookingOptions.notFitNone", { name: names })}
            </p>
          )}
          <Button
            type="button"
            variant="accent"
            size="sm"
            className="w-full h-10 whitespace-normal"
            data-testid="booking-option-keep"
            disabled={disabled}
            onClick={onBookWithout}
          >
            <span className="line-clamp-2">
              {t("bookingOptions.notFitKeep", { time: selectedTime, name: names })}
            </span>
          </Button>
        </div>
      )}
    </div>
  );
};

export default BookingOptionConfirm;
