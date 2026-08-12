import { useTranslation } from "react-i18next";
import { Settings2 } from "lucide-react";
import type { MessageTemplate } from "@/hooks/useMessageTemplates";

interface MessageTemplateChipsProps {
  templates: MessageTemplate[];
  onPick: (template: MessageTemplate) => void;
  onManage: () => void;
}

/**
 * 入力欄の上に出す定型文のチップ列。
 *
 * ⚠️ 横スクロールにしてある。折り返すとチャット画面の高さが定型文の数で変わり、
 *    メッセージの表示領域が押し潰される。
 */
const MessageTemplateChips = ({ templates, onPick, onManage }: MessageTemplateChipsProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-0.5">
      {templates.map((tpl) => (
        <button
          key={tpl.id}
          type="button"
          onClick={() => onPick(tpl)}
          title={tpl.body}
          className="shrink-0 px-2.5 py-1 rounded-full bg-secondary text-xs font-medium hover:bg-muted transition-colors max-w-[10rem] truncate"
        >
          {tpl.title}
        </button>
      ))}
      <button
        type="button"
        onClick={onManage}
        aria-label={t("messageTemplates.manageTitle")}
        className="shrink-0 w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
      >
        <Settings2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default MessageTemplateChips;
