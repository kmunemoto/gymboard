import { useTranslation } from "react-i18next";
import { Smile } from "lucide-react";
import { STICKERS } from "@/lib/stickers";

/**
 * スタンプを選ぶ欄。入力欄のすぐ上に開く。
 *
 * 🔴 **チャットの外枠の高さを変えないこと。** 外枠は
 * `bottom: max(var(--kb,0px), var(--nav-h,6rem))` で画面に貼り付けてあり、
 * キーボードの計算はそこに依存している（`mem/features/messaging.md`。同じ場所を
 * 3回直している）。この欄は外枠の**中**で開き、メッセージ一覧が縮むだけにする。
 * 外枠に高さを足すと、キーボードまわりが4回目の作り直しになる。
 *
 * 高さは固定（`h-56`）。中身の枚数で伸び縮みさせると、スタンプを足した日に
 * 一覧の見え方が変わる。
 */
interface Props {
  onPick: (stickerId: string) => void;
  disabled?: boolean;
}

export const StickerPickerButton = ({
  open, onToggle, disabled,
}: { open: boolean; onToggle: () => void; disabled?: boolean }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={t("chat.stickers")}
      aria-pressed={open}
      data-testid="sticker-button"
      className={`p-2 rounded-lg shrink-0 transition-colors ${
        open ? "bg-accent/15 text-accent" : "text-muted-foreground hover:bg-muted"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <Smile className="w-5 h-5" />
    </button>
  );
};

const StickerPicker = ({ onPick, disabled }: Props) => {
  const { t } = useTranslation();
  if (STICKERS.length === 0) return null;

  return (
    <div
      data-testid="sticker-picker"
      className="h-56 overflow-y-auto border-t border-border bg-muted/30 p-2"
    >
      <p className="text-[10px] text-muted-foreground px-1 pb-1">{t("chat.stickerHint")}</p>
      {/* 列数は幅に任せる。スマホ（max-w-md）で6列＝8枚が2段に収まり、
          スタッフ側の広い画面でも1つが大きくなりすぎない。
          固定の列数だと、どちらかで必ず不格好になる。 */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-1.5">
        {STICKERS.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s.id)}
            aria-label={s.text}
            data-testid="sticker-option"
            className="aspect-square rounded-lg bg-background/60 p-1 hover:bg-background
              active:scale-95 transition-transform disabled:opacity-50"
          >
            {/* 一覧では文字まで読めなくてよい（絵で選ぶ）。読み上げには aria-label が要る。 */}
            <img src={s.src} alt="" className="w-full h-full object-contain" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default StickerPicker;
