import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizePreVisitNote } from "@/lib/preVisitNote";

interface Props {
  /** 店の設定（`tenants.pre_visit_note`）。null・空なら何も出さない */
  note: string | null | undefined;
  /** 小さめに出す（ホームのカードなど、狭い場所用） */
  compact?: boolean;
}

/**
 * 「ご来店前のお願い」（2026-10-27 宗本さん）。何をなぜ出すかは `src/lib/preVisitNote.ts`。
 * 店が書いた文は改行も含めてそのまま出す（店が書いた文を勝手に縮めない）。
 */
const PreVisitNote = ({ note, compact = false }: Props) => {
  const { t } = useTranslation();
  const text = normalizePreVisitNote(note);
  if (!text) return null;
  return (
    <div
      data-testid="pre-visit-note"
      className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-left"
    >
      <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-bold">{t("booking.preVisitTitle")}</p>
        <p className={`${compact ? "text-xs" : "text-sm"} mt-0.5 whitespace-pre-line break-words`}>{text}</p>
      </div>
    </div>
  );
};

export default PreVisitNote;
