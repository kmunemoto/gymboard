import { useState, useEffect } from "react";
import { Bone, Loader2, ChevronDown, Dumbbell, Target, TrendingUp, ArrowLeftRight, X, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { formatJST } from "@/lib/timezone";
import { ja } from "date-fns/locale";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type DiagnosisRow = {
  id: string;
  skeletal_type: string;
  confidence: number;
  scores: { straight: number; wave: number; natural: number };
  metrics: { shoulderHipRatio?: number; upperBodyRatio?: number; limbTorsoRatio?: number };
  image_url: string | null;
  created_at: string;
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  straight: { label: "ストレート", color: "hsl(174, 65%, 50%)" },
  wave: { label: "ウェーブ", color: "hsl(280, 45%, 55%)" },
  natural: { label: "ナチュラル", color: "hsl(160, 40%, 45%)" },
};

const TRAINING_TIPS: Record<string, { area: string; exercises: string[] }[]> = {
  straight: [
    { area: "体幹・腹筋", exercises: ["プランク", "デッドバグ", "ケーブルクランチ"] },
    { area: "背中", exercises: ["ラットプルダウン", "シーテッドロウ"] },
    { area: "下半身", exercises: ["スクワット", "ヒップスラスト"] },
  ],
  wave: [
    { area: "肩・上半身", exercises: ["ショルダープレス", "サイドレイズ", "プッシュアップ"] },
    { area: "下半身・ヒップ", exercises: ["ブルガリアンスクワット", "カーフレイズ"] },
    { area: "体幹", exercises: ["ヒップリフト", "サイドプランク"] },
  ],
  natural: [
    { area: "全身", exercises: ["デッドリフト", "ケトルベルスイング"] },
    { area: "胸・肩", exercises: ["ベンチプレス", "フェイスプル"] },
    { area: "柔軟性", exercises: ["ヨガ", "ダイナミックストレッチ"] },
  ],
};

type Props = { userId: string | undefined; allowDelete?: boolean };

/* ─── Compare view ─── */
const CompareView = ({
  items,
  signedUrls,
  onClose,
}: {
  items: [DiagnosisRow, DiagnosisRow];
  signedUrls: Record<string, string>;
  onClose: () => void;
}) => {
  const [before, after] = items;

  const renderSide = (d: DiagnosisRow, label: string) => {
    const info = TYPE_LABELS[d.skeletal_type] ?? { label: d.skeletal_type, color: "gray" };
    return (
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-[10px] font-bold text-center text-muted-foreground uppercase tracking-wider">{label}</p>
        {d.image_url && signedUrls[d.id] ? (
          <div className="rounded-lg overflow-hidden border border-border/30">
            <img src={signedUrls[d.id]} alt={label} className="w-full h-auto" />
          </div>
        ) : d.image_url ? (
          <div className="flex items-center justify-center py-10 bg-muted/30 rounded-lg">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex items-center justify-center py-10 bg-muted/30 rounded-lg text-[10px] text-muted-foreground">写真なし</div>
        )}
        <div className="text-center">
          <Badge style={{ backgroundColor: info.color, color: "white" }} className="text-[10px]">
            {info.label} {d.confidence}%
          </Badge>
          <p className="text-[10px] text-muted-foreground mt-1">
            {formatJST(d.created_at, "yyyy/M/d", { locale: ja })}
          </p>
        </div>
        {/* Scores */}
        <div className="space-y-1">
          {(["straight", "wave", "natural"] as const).map((t) => {
            const ti = TYPE_LABELS[t];
            const val = d.scores?.[t] ?? 0;
            return (
              <div key={t} className="flex items-center gap-1">
                <span className="text-[9px] w-10 truncate">{ti.label}</span>
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${val}%`, backgroundColor: ti.color }} />
                </div>
                <span className="text-[9px] text-muted-foreground w-6 text-right">{val}%</span>
              </div>
            );
          })}
        </div>
        {/* Metrics */}
        {d.metrics && (
          <div className="space-y-0.5 text-center">
            <p className="text-[9px] text-muted-foreground">肩/ヒップ {d.metrics.shoulderHipRatio ?? "-"}</p>
            <p className="text-[9px] text-muted-foreground">上半身 {d.metrics.upperBodyRatio != null ? `${(d.metrics.upperBodyRatio * 100).toFixed(0)}%` : "-"}</p>
            <p className="text-[9px] text-muted-foreground">四肢/胴 {d.metrics.limbTorsoRatio ?? "-"}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ArrowLeftRight className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-bold">ビフォーアフター比較</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex gap-3">
          {renderSide(before, "BEFORE")}
          {renderSide(after, "AFTER")}
        </div>
      </CardContent>
    </Card>
  );
};

const DiagnosisHistorySection = ({ userId, allowDelete = false }: Props) => {
  const [diagnoses, setDiagnoses] = useState<DiagnosisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (d: DiagnosisRow) => {
    setDeletingId(d.id);
    try {
      // 1) Delete DB row first with .select() to detect RLS silent rejections
      const { data, error } = await supabase
        .from("skeletal_diagnoses")
        .delete()
        .eq("id", d.id)
        .select();

      console.log("[skeletal_diagnoses] delete result:", { data, error });

      if (error) throw error;

      if (!data || data.length === 0) {
        console.warn("[skeletal_diagnoses] 0 rows deleted — RLS拒否またはデータ不在の可能性");
        toast({
          title: "削除できませんでした",
          description: "権限がないか、すでに削除されている可能性があります",
          variant: "destructive",
        });
        return;
      }

      // 2) DB削除成功後にストレージ画像を削除（失敗しても致命的ではない）
      if (d.image_url) {
        const { error: storageError } = await supabase.storage
          .from("posture-photos")
          .remove([d.image_url]);
        if (storageError) {
          console.warn("[skeletal_diagnoses] storage delete failed:", storageError);
        }
      }

      // 3) ローカルstateを更新
      setDiagnoses((prev) => prev.filter((x) => x.id !== d.id));
      setCompareIds((prev) => prev.filter((x) => x !== d.id));
      if (expandedId === d.id) setExpandedId(null);
      toast({ title: "削除しました", description: "骨格診断を削除しました" });
    } catch (e: any) {
      console.error("[skeletal_diagnoses] delete error:", e);
      toast({ title: "削除に失敗しました", description: e?.message ?? "もう一度お試しください", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    if (!userId) return;
    const fetchData = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("skeletal_diagnoses" as any)
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);
      setDiagnoses((data as unknown as DiagnosisRow[] | null) ?? []);
      setLoading(false);
    };
    fetchData();
  }, [userId]);

  // Fetch signed URL when expanding a card or selecting for compare
  useEffect(() => {
    const idsToFetch = new Set<string>();
    if (expandedId) idsToFetch.add(expandedId);
    compareIds.forEach((id) => idsToFetch.add(id));

    idsToFetch.forEach((id) => {
      const d = diagnoses.find((x) => x.id === id);
      if (!d?.image_url || signedUrls[d.id]) return;
      supabase.storage
        .from("posture-photos")
        .createSignedUrl(d.image_url, 300)
        .then(({ data }) => {
          if (data?.signedUrl) {
            setSignedUrls((prev) => ({ ...prev, [d.id]: data.signedUrl }));
          }
        });
    });
  }, [expandedId, compareIds, diagnoses, signedUrls]);

  const toggleCompareId = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const comparePair = compareIds.length === 2
    ? diagnoses
        .filter((d) => compareIds.includes(d.id))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) as [DiagnosisRow, DiagnosisRow]
    : null;

  const diagnosesWithImages = diagnoses.filter((d) => d.image_url);

  return (
    <section>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <Bone className="w-3.5 h-3.5" />
        骨格診断履歴
      </h2>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : diagnoses.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">まだ診断履歴はありません</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Compare toggle */}
          {diagnosesWithImages.length >= 2 && (
            <div className="flex justify-end">
              <Button
                variant={compareMode ? "default" : "outline"}
                size="sm"
                className="text-xs h-7"
                onClick={() => {
                  setCompareMode(!compareMode);
                  if (compareMode) setCompareIds([]);
                }}
              >
                <ArrowLeftRight className="w-3 h-3 mr-1" />
                {compareMode ? "比較を終了" : "ビフォーアフター比較"}
              </Button>
            </div>
          )}

          {compareMode && (
            <p className="text-[11px] text-muted-foreground text-center">
              比較したい2つの診断を選んでください（{compareIds.length}/2 選択中）
            </p>
          )}

          {/* Compare view */}
          {comparePair && (
            <CompareView
              items={comparePair}
              signedUrls={signedUrls}
              onClose={() => {
                setCompareMode(false);
                setCompareIds([]);
              }}
            />
          )}

          {/* Score trend chart */}
          {diagnoses.length >= 2 && !compareMode && (
            <Card>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-accent" />
                  <span className="text-xs font-bold">スコア推移</span>
                </div>
                <div className="flex gap-3 justify-center text-[10px]">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "hsl(174, 65%, 50%)" }} />
                    ストレート
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "hsl(280, 45%, 55%)" }} />
                    ウェーブ
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "hsl(160, 40%, 45%)" }} />
                    ナチュラル
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart
                    data={[...diagnoses]
                      .reverse()
                      .map((d) => ({
                        date: formatJST(d.created_at, "M/d"),
                        ストレート: d.scores?.straight ?? 0,
                        ウェーブ: d.scores?.wave ?? 0,
                        ナチュラル: d.scores?.natural ?? 0,
                      }))}
                    margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                      formatter={(v: number) => `${v}%`}
                    />
                    <Line type="monotone" dataKey="ストレート" stroke="hsl(174, 65%, 50%)" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="ウェーブ" stroke="hsl(280, 45%, 55%)" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="ナチュラル" stroke="hsl(160, 40%, 45%)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {diagnoses.map((d) => {
            const info = TYPE_LABELS[d.skeletal_type] ?? { label: d.skeletal_type, color: "gray" };
            const dt = new Date(d.created_at);
            const isExpanded = expandedId === d.id;
            const tips = TRAINING_TIPS[d.skeletal_type] ?? [];
            const isSelected = compareIds.includes(d.id);

            return (
              <Card
                key={d.id}
                className={`opacity-90 cursor-pointer transition-all ${compareMode && isSelected ? "ring-2 ring-accent" : ""}`}
                onClick={() => {
                  if (compareMode) {
                    if (d.image_url) toggleCompareId(d.id);
                  } else {
                    setExpandedId(isExpanded ? null : d.id);
                  }
                }}
              >
                <CardContent className="p-3">
                  {/* Summary row */}
                  <div className="flex items-center gap-3">
                    {compareMode ? (
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center border-2 shrink-0 transition-colors ${
                          isSelected ? "border-accent bg-accent/10" : "border-muted bg-muted/30"
                        } ${!d.image_url ? "opacity-30" : ""}`}
                      >
                        {isSelected && <span className="text-accent font-bold text-sm">{compareIds.indexOf(d.id) + 1}</span>}
                      </div>
                    ) : (
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: info.color }}
                      >
                        {info.label.slice(0, 2)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold" style={{ color: info.color }}>
                          {info.label}タイプ
                        </p>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {d.confidence}%
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {format(dt, "yyyy年M月d日 HH:mm", { locale: ja })}
                      </p>
                    </div>
                    {!compareMode && (
                      <ChevronDown
                        className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                      />
                    )}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && !compareMode && (
                    <div className="mt-3 pt-3 border-t border-border/50 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                      {/* Overlay photo */}
                      {d.image_url && (
                        <div className="rounded-lg overflow-hidden border border-border/30">
                          {signedUrls[d.id] ? (
                            <img src={signedUrls[d.id]} alt="骨格オーバーレイ" className="w-full h-auto" />
                          ) : (
                            <div className="flex items-center justify-center py-8 bg-muted/30">
                              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Score bars */}
                      <div className="space-y-1.5">
                        {(["straight", "wave", "natural"] as const).map((t) => {
                          const ti = TYPE_LABELS[t];
                          const val = d.scores?.[t] ?? 0;
                          return (
                            <div key={t} className="flex items-center gap-2">
                              <span className="text-[11px] font-medium w-16">{ti.label}</span>
                              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${val}%`, backgroundColor: ti.color }}
                                />
                              </div>
                              <span className="text-[11px] text-muted-foreground w-8 text-right">{val}%</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Metrics */}
                      {d.metrics && (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="bg-muted/40 rounded-lg p-2 text-center">
                            <p className="text-[10px] text-muted-foreground">肩/ヒップ比</p>
                            <p className="text-sm font-bold">{d.metrics.shoulderHipRatio ?? "-"}</p>
                          </div>
                          <div className="bg-muted/40 rounded-lg p-2 text-center">
                            <p className="text-[10px] text-muted-foreground">上半身比率</p>
                            <p className="text-sm font-bold">
                              {d.metrics.upperBodyRatio != null ? `${(d.metrics.upperBodyRatio * 100).toFixed(0)}%` : "-"}
                            </p>
                          </div>
                          <div className="bg-muted/40 rounded-lg p-2 text-center">
                            <p className="text-[10px] text-muted-foreground">四肢/胴比</p>
                            <p className="text-sm font-bold">{d.metrics.limbTorsoRatio ?? "-"}</p>
                          </div>
                        </div>
                      )}

                      {/* Training recommendations */}
                      {tips.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5">
                            <Target className="w-3.5 h-3.5 text-accent" />
                            <span className="text-[11px] font-bold">おすすめトレーニング</span>
                          </div>
                          {tips.map((tip, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <Dumbbell className="w-3 h-3 mt-0.5 shrink-0" style={{ color: info.color }} />
                              <div>
                                <span className="text-[11px] font-medium">{tip.area}：</span>
                                <span className="text-[11px] text-muted-foreground">{tip.exercises.join("、")}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Trainer-only delete */}
                      {allowDelete && (
                        <div className="pt-2 border-t border-border/30" onClick={(e) => e.stopPropagation()}>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30 h-8 text-xs"
                                disabled={deletingId === d.id}
                              >
                                {deletingId === d.id ? (
                                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                                )}
                                この診断を削除
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>骨格診断を削除しますか？</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {format(dt, "yyyy年M月d日 HH:mm", { locale: ja })}の診断結果と画像が完全に削除されます。この操作は取り消せません。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(d)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  削除する
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default DiagnosisHistorySection;
