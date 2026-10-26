import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, ChevronRight, User, Target, Heart, FileText, StickyNote, Save, Link2 } from "lucide-react";
import { useCounselingResponses, type CounselingResponse } from "@/hooks/useCounselingResponses";
import { useAllCustomerProfiles } from "@/hooks/useProfile";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatJST } from "@/lib/timezone";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

const CounselingResponseList = () => {
  const { t } = useTranslation();
  const { responses, isLoading, markReviewed, updateMemo, linkToClient } = useCounselingResponses();
  const [selected, setSelected] = useState<CounselingResponse | null>(null);

  // counseling.purpose のキー一覧を i18n から動的に引く（配列を直書きすると、
  // 業種特化フォークが vertical.ja.json にキーを足しても選択肢が増えないため）。
  const purposeLabels = t("counseling.purpose", { returnObjects: true }) as Record<string, string>;
  const labelPurpose = (p: string) => purposeLabels?.[p] ?? p;

  const handleOpen = (r: CounselingResponse) => {
    setSelected(r);
    if (!r.reviewed) markReviewed.mutate(r.id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <DumbbellLoader className="w-5 h-5 text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-bold">{t("counseling.headerTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("counseling.headerSubtitle")}</p>
        </div>
      </div>

      {responses.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {t("counseling.empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {responses.map((r) => (
            <Card key={r.id} className="card-hover cursor-pointer" onClick={() => handleOpen(r)}>
              <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <ClipboardList className="w-4 h-4 sm:w-5 sm:h-5 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm truncate">
                      {r.last_name} {r.first_name}
                    </p>
                    {!r.reviewed && (
                      <Badge className="text-[10px] px-1.5 py-0 h-4 bg-accent text-accent-foreground border-0">
                        NEW
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.purposes?.map(labelPurpose).join("・") || t("counseling.noPurpose")}
                  </p>
                </div>
                <div className="text-right shrink-0 flex items-center gap-1">
                  <p className="text-xs text-muted-foreground">
                    {formatJST(r.created_at, "M/d HH:mm")}
                  </p>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-accent" />
              {t("counseling.detailTitle")}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <CounselingDetail
              data={selected}
              updateMemo={updateMemo}
              linkToClient={linkToClient}
              labelPurpose={labelPurpose}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const DetailRow = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div className="flex justify-between items-start py-1.5">
    <span className="text-xs text-muted-foreground shrink-0 w-28">{label}</span>
    <span className="text-sm font-medium text-right">{value || "—"}</span>
  </div>
);

const SectionCard = ({ icon: Icon, title, children }: { icon: typeof User; title: string; children: React.ReactNode }) => (
  <Card className="overflow-hidden">
    <CardHeader className="pb-2 pt-3 px-4">
      <CardTitle className="text-sm font-bold flex items-center gap-2">
        <Icon className="w-4 h-4 text-accent" />
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent className="px-4 pb-3 divide-y divide-border">
      {children}
    </CardContent>
  </Card>
);

// Radix Select は SelectItem の value に空文字を許さないため、未紐付けの選択肢はこの値で表す
const UNLINKED_VALUE = "__unlinked__";

const CounselingDetail = ({
  data,
  updateMemo,
  linkToClient,
  labelPurpose,
}: {
  data: CounselingResponse;
  updateMemo: ReturnType<typeof useCounselingResponses>["updateMemo"];
  linkToClient: ReturnType<typeof useCounselingResponses>["linkToClient"];
  labelPurpose: (p: string) => string;
}) => {
  const { t } = useTranslation();
  const { profiles: customers, loading: customersLoading } = useAllCustomerProfiles();
  const [memo, setMemo] = useState(data.trainer_memo || "");
  const [saving, setSaving] = useState(false);

  const handleSaveMemo = async () => {
    setSaving(true);
    try {
      await updateMemo.mutateAsync({ id: data.id, memo });
      toast.success(t("counseling.memoSaved"));
    } catch {
      toast.error(t("counseling.memoSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleLinkChange = async (value: string) => {
    try {
      await linkToClient.mutateAsync({ id: data.id, userId: value === UNLINKED_VALUE ? null : value });
      toast.success(t("counseling.linkSaved"));
    } catch {
      toast.error(t("counseling.linkSaveFailed"));
    }
  };

  return (
    <div className="space-y-3">
      <SectionCard icon={Link2} title={t("counseling.sectionLink")}>
        <div className="pt-1 pb-1">
          <p className="text-xs text-muted-foreground mb-2">{t("counseling.linkDescription")}</p>
          <Select value={data.user_id ?? UNLINKED_VALUE} onValueChange={handleLinkChange} disabled={customersLoading}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder={t("counseling.linkPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNLINKED_VALUE}>{t("counseling.linkUnlinked")}</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.user_id} value={c.user_id}>
                  {c.display_name || t("counseling.linkUnnamed")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SectionCard>

      <SectionCard icon={StickyNote} title={t("counseling.sectionMemo")}>
        <div className="space-y-2 pt-1">
          <Textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={t("counseling.memoPlaceholder")}
            className="min-h-[80px] text-sm"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSaveMemo} disabled={saving} className="gap-1.5">
              <Save className="w-3.5 h-3.5" />
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard icon={User} title={t("counseling.sectionBasic")}>
        <DetailRow label={t("counseling.fieldName")} value={`${data.last_name} ${data.first_name}`} />
        <DetailRow label={t("counseling.fieldKana")} value={data.last_name_kana && data.first_name_kana ? `${data.last_name_kana} ${data.first_name_kana}` : null} />
        <DetailRow label={t("counseling.fieldAge")} value={data.age ? t("counseling.fieldAgeUnit", { age: data.age }) : null} />
        <DetailRow label={t("counseling.fieldGender")} value={data.gender} />
        <DetailRow label={t("counseling.fieldPhone")} value={data.phone} />
        <DetailRow label={t("counseling.fieldEmail")} value={data.email} />
        <DetailRow label={t("counseling.fieldArea")} value={data.ward} />
      </SectionCard>

      <SectionCard icon={Target} title={t("counseling.sectionGoal")}>
        <DetailRow label={t("counseling.fieldPurpose")} value={data.purposes?.map(labelPurpose).join("、")} />
        <DetailRow label={t("counseling.fieldExperience")} value={data.experience_level} />
        <DetailRow label={t("counseling.fieldFrequency")} value={data.target_frequency} />
      </SectionCard>

      <SectionCard icon={Heart} title={t("counseling.sectionLife")}>
        <DetailRow label={t("counseling.fieldExercise")} value={data.exercise_habit} />
        <DetailRow label={t("counseling.fieldDiet")} value={data.diet_pattern} />
        <DetailRow label={t("counseling.fieldSleep")} value={data.sleep_hours} />
      </SectionCard>

      <SectionCard icon={FileText} title={t("counseling.sectionHealth")}>
        <DetailRow label={t("counseling.fieldPain")} value={data.pain_areas?.join("、")} />
        <DetailRow label={t("counseling.fieldMedical")} value={data.medical_history} />
        <DetailRow label={t("counseling.fieldNotes")} value={data.notes} />
      </SectionCard>

      <p className="text-[11px] text-muted-foreground text-center pt-1">
        {t("counseling.createdAt", { date: formatJST(data.created_at, "yyyy年M月d日 HH:mm") })}
      </p>
    </div>
  );
};

export default CounselingResponseList;
