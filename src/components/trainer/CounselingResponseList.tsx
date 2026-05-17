import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClipboardList, Loader2, ChevronRight, User, Target, Heart, FileText, StickyNote, Save } from "lucide-react";
import { useCounselingResponses, type CounselingResponse } from "@/hooks/useCounselingResponses";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatJST } from "@/lib/timezone";

const purposeLabels: Record<string, string> = {
  diet: "ダイエット", muscle: "筋力アップ", health: "健康維持",
  posture: "姿勢改善", beauty: "美容・ボディメイク", stress: "ストレス解消",
  rehab: "リハビリ", performance: "パフォーマンス向上",
};

const CounselingResponseList = () => {
  const { responses, isLoading, markReviewed, updateMemo } = useCounselingResponses();
  const [selected, setSelected] = useState<CounselingResponse | null>(null);

  const handleOpen = (r: CounselingResponse) => {
    setSelected(r);
    if (!r.reviewed) markReviewed.mutate(r.id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-accent" />
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
          <h2 className="text-lg font-bold">カウンセリングシート</h2>
          <p className="text-xs text-muted-foreground">送信された回答一覧</p>
        </div>
      </div>

      {responses.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            カウンセリング回答はまだありません
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
                    {r.purposes?.map((p) => purposeLabels[p] || p).join("・") || "目的未入力"}
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
              カウンセリング回答詳細
            </DialogTitle>
          </DialogHeader>
          {selected && <CounselingDetail data={selected} updateMemo={updateMemo} />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* ---------- Sectioned Detail ---------- */

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

const CounselingDetail = ({ data, updateMemo }: { data: CounselingResponse; updateMemo: ReturnType<typeof useCounselingResponses>["updateMemo"] }) => {
  const [memo, setMemo] = useState(data.trainer_memo || "");
  const [saving, setSaving] = useState(false);

  const handleSaveMemo = async () => {
    setSaving(true);
    try {
      await updateMemo.mutateAsync({ id: data.id, memo });
      toast.success("メモを保存しました");
    } catch {
      toast.error("メモの保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* メモ */}
      <SectionCard icon={StickyNote} title="トレーナーメモ">
        <div className="space-y-2 pt-1">
          <Textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="このお客様に関するメモを入力..."
            className="min-h-[80px] text-sm"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSaveMemo} disabled={saving} className="gap-1.5">
              <Save className="w-3.5 h-3.5" />
              {saving ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* 基本情報 */}
      <SectionCard icon={User} title="基本情報">
        <DetailRow label="氏名" value={`${data.last_name} ${data.first_name}`} />
        <DetailRow label="フリガナ" value={data.last_name_kana && data.first_name_kana ? `${data.last_name_kana} ${data.first_name_kana}` : null} />
        <DetailRow label="年齢" value={data.age ? `${data.age}歳` : null} />
        <DetailRow label="性別" value={data.gender} />
        <DetailRow label="電話番号" value={data.phone} />
        <DetailRow label="メール" value={data.email} />
        <DetailRow label="お住まいの地域" value={data.ward} />
      </SectionCard>

      {/* 目的・目標 */}
      <SectionCard icon={Target} title="目的・目標">
        <DetailRow label="通う目的" value={data.purposes?.map((p) => purposeLabels[p] || p).join("、")} />
        <DetailRow label="運動経験" value={data.experience_level} />
        <DetailRow label="希望頻度" value={data.target_frequency} />
      </SectionCard>

      {/* 生活習慣 */}
      <SectionCard icon={Heart} title="生活習慣">
        <DetailRow label="運動習慣" value={data.exercise_habit} />
        <DetailRow label="食事の傾向" value={data.diet_pattern} />
        <DetailRow label="睡眠時間" value={data.sleep_hours} />
      </SectionCard>

      {/* 健康状態 */}
      <SectionCard icon={FileText} title="健康状態">
        <DetailRow label="痛みのある部位" value={data.pain_areas?.join("、")} />
        <DetailRow label="既往歴" value={data.medical_history} />
        <DetailRow label="備考" value={data.notes} />
      </SectionCard>

      <p className="text-[11px] text-muted-foreground text-center pt-1">
        回答日時: {formatJST(data.created_at, "yyyy年M月d日 HH:mm")}
      </p>
    </div>
  );
};

export default CounselingResponseList;
