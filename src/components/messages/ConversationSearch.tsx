import { useTranslation } from "react-i18next";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";

interface ConversationSearchProps {
  query: string;
  onQueryChange: (q: string) => void;
  /** ヒット件数 */
  total: number;
  /** いまの位置（0 始まり）。total が 0 のときは無視される */
  index: number;
  onStep: (dir: "next" | "prev") => void;
  onClose: () => void;
}

/**
 * 会話の中を探すバー。
 *
 * ⚠️ **0件のときに黙らない。** 何も出さないと「検索が壊れている」のか
 *    「本当に無い」のかが分からない。件数を必ず出す。
 */
const ConversationSearch = ({
  query,
  onQueryChange,
  total,
  index,
  onStep,
  onClose,
}: ConversationSearchProps) => {
  const { t } = useTranslation();
  const has = query.trim().length > 0;

  return (
    <div className="flex items-center gap-1.5 border-b border-border px-2 py-2">
      <Search className="w-4 h-4 text-muted-foreground shrink-0" />
      <input
        autoFocus
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && total > 0) onStep(e.shiftKey ? "prev" : "next");
        }}
        placeholder={t("chat.searchPlaceholder")}
        className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {has && (
        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
          {total === 0 ? t("chat.searchNoHit") : `${index + 1}/${total}`}
        </span>
      )}
      <button
        type="button"
        onClick={() => onStep("prev")}
        disabled={total === 0}
        aria-label={t("chat.searchPrev")}
        className="p-1 rounded hover:bg-muted disabled:opacity-30 shrink-0"
      >
        <ChevronUp className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onStep("next")}
        disabled={total === 0}
        aria-label={t("chat.searchNext")}
        className="p-1 rounded hover:bg-muted disabled:opacity-30 shrink-0"
      >
        <ChevronDown className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="p-1 rounded hover:bg-muted shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default ConversationSearch;
