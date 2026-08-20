import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardList, Plus, Trash2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useBookingQuestions } from "@/hooks/useBookingQuestions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  MAX_QUESTIONS_PER_TENANT,
  MAX_QUESTION_OPTIONS,
  QUESTION_HELP_MAX,
  QUESTION_INPUT_TYPES,
  QUESTION_LABEL_MAX,
  resolveInputType,
  type BookingQuestion,
} from "@/lib/bookingQuestions";

/**
 * 予約時のカスタム質問（事前アンケート）の管理。
 *
 * 1問ずつカードにして、その場で保存する（まとめて保存にすると
 * 「どれが保存済みか」が画面から分からなくなる）。
 *
 * 選択肢（`select`）はカンマ区切りの1行入力にしてある。行を増やすUIにすると
 * 質問1つあたりの高さが倍以上になり、スマホで全体が見渡せなくなるため。
 */
const TrainerBookingQuestions = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const { questions, refetch } = useBookingQuestions();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // 未保存の編集内容。id → 変更後の値。
  const [drafts, setDrafts] = useState<Record<string, Partial<BookingQuestion> & { optionsText?: string }>>({});

  const draftOf = (q: BookingQuestion) => ({ ...q, ...drafts[q.id] });

  const setDraft = (id: string, patch: Partial<BookingQuestion> & { optionsText?: string }) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleAdd = async () => {
    if (!tenant?.id) return;
    if (questions.length >= MAX_QUESTIONS_PER_TENANT) {
      toast.error(t("bookingQuestions.limitReached", { count: MAX_QUESTIONS_PER_TENANT }));
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("booking_questions").insert({
      tenant_id: tenant.id,
      label: t("bookingQuestions.newQuestionLabel"),
      input_type: "text",
      sort_order: questions.length,
    } as never);
    if (error) {
      console.error("質問の追加に失敗:", error);
      toast.error(t("bookingQuestions.saveFailed"), { description: error.message });
    } else {
      await refetch();
    }
    setCreating(false);
  };

  const handleSave = async (q: BookingQuestion) => {
    if (!tenant?.id) return;
    const d = draftOf(q);
    const label = (d.label ?? "").trim();
    if (!label) {
      toast.error(t("bookingQuestions.errorEmptyLabel"));
      return;
    }
    const type = resolveInputType(d.input_type);
    const optionsText = drafts[q.id]?.optionsText;
    const options =
      type === "select"
        ? (optionsText ?? (q.options ?? []).join("、"))
            .split(/[、,]/)
            .map((o) => o.trim())
            .filter(Boolean)
            .slice(0, MAX_QUESTION_OPTIONS)
        : null;
    if (type === "select" && (!options || options.length === 0)) {
      toast.error(t("bookingQuestions.errorNoOptions"));
      return;
    }
    setSavingId(q.id);
    const { error } = await supabase
      .from("booking_questions")
      .update({
        label,
        help_text: (d.help_text ?? "").trim() || null,
        input_type: type,
        options,
        required: d.required === true,
        is_active: d.is_active !== false,
        ask_on_member: d.ask_on_member !== false,
        ask_on_trial: d.ask_on_trial === true,
      } as never)
      .eq("id", q.id);
    if (error) {
      console.error("質問の保存に失敗:", error);
      toast.error(t("bookingQuestions.saveFailed"), { description: error.message });
    } else {
      toast.success(t("bookingQuestions.saved"));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[q.id];
        return next;
      });
      await refetch();
    }
    setSavingId(null);
  };

  const handleDelete = async (q: BookingQuestion) => {
    const { error } = await supabase.from("booking_questions").delete().eq("id", q.id);
    if (error) {
      console.error("質問の削除に失敗:", error);
      toast.error(t("bookingQuestions.saveFailed"), { description: error.message });
      return;
    }
    // 過去の回答は bookings.custom_answers に文言ごと焼き付いているので消えない。
    toast.success(t("bookingQuestions.deleted"));
    await refetch();
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        {t("bookingQuestions.section")}
      </h3>
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("bookingQuestions.desc")}</p>

          {questions.length === 0 && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <ClipboardList className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("bookingQuestions.empty")}
            </p>
          )}

          {questions.map((q) => {
            const d = draftOf(q);
            const type = resolveInputType(d.input_type);
            return (
              <div key={q.id} className="rounded-lg border border-border p-3 space-y-2.5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("bookingQuestions.labelField")}</Label>
                  <Input
                    value={d.label ?? ""}
                    maxLength={QUESTION_LABEL_MAX}
                    onChange={(e) => setDraft(q.id, { label: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("bookingQuestions.helpField")}</Label>
                  <Input
                    value={d.help_text ?? ""}
                    maxLength={QUESTION_HELP_MAX}
                    placeholder={t("bookingQuestions.helpPlaceholder")}
                    onChange={(e) => setDraft(q.id, { help_text: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("bookingQuestions.typeField")}</Label>
                  <Select value={type} onValueChange={(v) => setDraft(q.id, { input_type: v })}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {QUESTION_INPUT_TYPES.map((ty) => (
                        <SelectItem key={ty} value={ty}>{t(`bookingQuestions.type.${ty}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {type === "select" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">{t("bookingQuestions.optionsField")}</Label>
                    <p className="text-xs text-muted-foreground">{t("bookingQuestions.optionsHint")}</p>
                    <Input
                      value={drafts[q.id]?.optionsText ?? (q.options ?? []).join("、")}
                      onChange={(e) => setDraft(q.id, { optionsText: e.target.value })}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-normal">{t("bookingQuestions.requiredToggle")}</Label>
                  <Switch
                    checked={d.required === true}
                    onCheckedChange={(v) => setDraft(q.id, { required: v })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-normal">{t("bookingQuestions.askOnMemberToggle")}</Label>
                  <Switch
                    checked={d.ask_on_member !== false}
                    onCheckedChange={(v) => setDraft(q.id, { ask_on_member: v })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-normal">{t("bookingQuestions.askOnTrialToggle")}</Label>
                  <Switch
                    checked={d.ask_on_trial === true}
                    onCheckedChange={(v) => setDraft(q.id, { ask_on_trial: v })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-normal">{t("bookingQuestions.activeToggle")}</Label>
                  <Switch
                    checked={d.is_active !== false}
                    onCheckedChange={(v) => setDraft(q.id, { is_active: v })}
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" className="h-9" disabled={savingId === q.id} onClick={() => void handleSave(q)}>
                    <Save className="w-4 h-4 mr-1" />
                    {savingId === q.id ? t("common.saving") : t("common.save")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 text-destructive"
                    onClick={() => void handleDelete(q)}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            );
          })}

          <Button
            variant="outline"
            size="sm"
            className="h-10"
            disabled={creating || questions.length >= MAX_QUESTIONS_PER_TENANT}
            onClick={() => void handleAdd()}
          >
            <Plus className="w-4 h-4 mr-1" />
            {t("bookingQuestions.addQuestion")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrainerBookingQuestions;
