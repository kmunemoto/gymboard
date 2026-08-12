import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type MessageTemplate,
  type TemplateDraft,
  MAX_TEMPLATES,
  useMessageTemplates,
} from "@/hooks/useMessageTemplates";

interface MessageTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  /** 一覧・作成・更新・削除は呼び出し元と同じフックを共有する（保存後に即反映するため） */
  store: ReturnType<typeof useMessageTemplates>;
}

const EMPTY: TemplateDraft = { title: "", body: "" };

/** 定型文の管理。チャット画面から開く（設定画面まで行かせない）。 */
const MessageTemplateDialog = ({ open, onClose, store }: MessageTemplateDialogProps) => {
  const { t } = useTranslation();
  const { templates, atLimit, create, update, remove, move } = store;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const startNew = () => {
    setEditingId("new");
    setDraft(EMPTY);
  };

  const startEdit = (tpl: MessageTemplate) => {
    setEditingId(tpl.id);
    setDraft({ title: tpl.title, body: tpl.body });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(EMPTY);
  };

  const handleSave = async () => {
    if (!draft.title.trim() || !draft.body.trim()) {
      toast.error(t("messageTemplates.errEmpty"));
      return;
    }
    setSaving(true);
    try {
      if (editingId === "new") await create(draft);
      else if (editingId) await update(editingId, draft);
      cancelEdit();
    } catch (e) {
      console.error("定型文の保存に失敗:", e);
      toast.error(t("messageTemplates.errSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await remove(id);
      if (editingId === id) cancelEdit();
    } catch (e) {
      console.error("定型文の削除に失敗:", e);
      toast.error(t("messageTemplates.errDeleteFailed"));
    }
  };

  const handleMove = async (id: string, direction: -1 | 1) => {
    try {
      await move(id, direction);
    } catch (e) {
      console.error("定型文の並べ替えに失敗:", e);
      toast.error(t("messageTemplates.errSaveFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("messageTemplates.manageTitle")}</DialogTitle>
          <DialogDescription>{t("messageTemplates.manageDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {templates.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">{t("messageTemplates.empty")}</p>
          )}
          {templates.map((tpl, i) => (
            <div key={tpl.id} className="rounded-lg border border-border p-2.5">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{tpl.title}</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words line-clamp-3">
                    {tpl.body}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => handleMove(tpl.id, -1)}
                    disabled={i === 0}
                    aria-label={t("messageTemplates.moveUp")}
                    className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleMove(tpl.id, 1)}
                    disabled={i === templates.length - 1}
                    aria-label={t("messageTemplates.moveDown")}
                    className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => startEdit(tpl)}
                    aria-label={t("common.edit")}
                    className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-muted"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(tpl.id)}
                    aria-label={t("common.delete")}
                    className="w-7 h-7 rounded flex items-center justify-center text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {editingId ? (
          <div className="space-y-2 border-t border-border pt-3">
            <Input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder={t("messageTemplates.titlePlaceholder")}
              maxLength={30}
            />
            <textarea
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              placeholder={t("messageTemplates.bodyPlaceholder")}
              maxLength={1000}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
            <p className="text-[11px] text-muted-foreground">{t("messageTemplates.varHint")}</p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                {t("common.cancel")}
              </Button>
              <Button variant="accent" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={startNew}
            disabled={atLimit}
            className="w-full"
          >
            <Plus className="w-4 h-4 mr-1" />
            {atLimit
              ? t("messageTemplates.atLimit", { max: MAX_TEMPLATES })
              : t("messageTemplates.add")}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MessageTemplateDialog;
