import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Target, Mountain, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  clientId: string;
}

interface Journey {
  id: string;
  start_weight: number;
  target_weight: number;
  start_date: string;
  is_active: boolean;
}

const TrainerWeightJourneyPanel = ({ clientId }: Props) => {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [startW, setStartW] = useState("");
  const [targetW, setTargetW] = useState("");

  const fetch = async () => {
    setLoading(true);
    const { data: j } = await supabase
      .from("weight_journey" as any)
      .select("id, start_weight, target_weight, start_date, is_active")
      .eq("user_id", clientId)
      .eq("is_active", true)
      .maybeSingle();
    if (j) {
      setJourney({
        id: (j as any).id,
        start_weight: Number((j as any).start_weight),
        target_weight: Number((j as any).target_weight),
        start_date: (j as any).start_date,
        is_active: (j as any).is_active,
      });
    } else {
      setJourney(null);
    }
    const { data: m } = await supabase
      .from("user_measurements")
      .select("weight")
      .eq("user_id", clientId)
      .not("weight", "is", null)
      .order("measured_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLatestWeight(m?.weight != null ? Number(m.weight) : null);
    setLoading(false);
  };

  useEffect(() => { fetch(); }, [clientId]);

  const handleOpen = () => {
    setStartW(latestWeight != null ? String(latestWeight) : "");
    setTargetW("");
    setOpen(true);
  };

  const handleSave = async () => {
    const s = parseFloat(startW);
    const t = parseFloat(targetW);
    if (!Number.isFinite(s) || !Number.isFinite(t)) {
      toast.error("数値を入力してください");
      return;
    }
    if (t >= s) {
      toast.error("目標体重は開始体重より小さくしてください");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("weight_journey" as any).upsert({
      user_id: clientId,
      start_weight: s,
      target_weight: t,
      is_active: true,
      created_by: user?.id,
    } as any, { onConflict: "user_id" });
    if (error) {
      toast.error("設定に失敗しました: " + error.message);
      return;
    }
    toast.success("ダイエット目標を設定しました");
    setOpen(false);
    await fetch();
    // Trigger immediate evaluation
    await supabase.rpc("check_weight_milestones" as any, { p_user_id: clientId });
  };

  const handleReset = async () => {
    if (!journey) return;
    const { error } = await supabase
      .from("weight_journey" as any)
      .update({ is_active: false } as any)
      .eq("id", journey.id);
    if (error) {
      toast.error("リセットに失敗しました");
      return;
    }
    toast.success("目標をリセットしました");
    setResetOpen(false);
    await fetch();
  };

  if (loading) return null;

  const totalGoal = journey ? journey.start_weight - journey.target_weight : 0;
  const lost = journey && latestWeight != null ? Math.max(0, journey.start_weight - latestWeight) : 0;
  const progress = totalGoal > 0 ? Math.min(100, (lost / totalGoal) * 100) : 0;

  return (
    <div className="pt-2 border-t border-border space-y-2">
      <div className="flex items-center gap-2">
        <Mountain className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">ダイエット目標</span>
      </div>

      {!journey ? (
        <Button variant="outline" size="sm" onClick={handleOpen} className="w-full h-9 gap-1.5">
          <Target className="w-3.5 h-3.5" />
          ダイエット目標を設定
        </Button>
      ) : (
        <Card className="border-accent/30">
          <CardContent className="p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">開始</p>
                <p className="text-sm font-bold">{journey.start_weight.toFixed(1)}kg</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">現在</p>
                <p className="text-sm font-bold text-accent">
                  {latestWeight != null ? `${latestWeight.toFixed(1)}kg` : "未記録"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">目標</p>
                <p className="text-sm font-bold">{journey.target_weight.toFixed(1)}kg</p>
              </div>
            </div>
            <div className="text-xs text-center text-muted-foreground">
              {lost > 0 ? `-${lost.toFixed(1)}kg` : "0.0kg"} / 目標 -{totalGoal.toFixed(1)}kg
              <span className="ml-1.5 font-bold text-accent">（{progress.toFixed(0)}% 達成）</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResetOpen(true)}
              className="w-full h-8 text-xs gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              目標をリセット
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ダイエット目標を設定</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">開始時体重 (kg)</label>
              <Input
                type="number"
                step="0.1"
                value={startW}
                onChange={(e) => setStartW(e.target.value)}
                placeholder="例: 70.0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">目標体重 (kg)</label>
              <Input
                type="number"
                step="0.1"
                value={targetW}
                onChange={(e) => setTargetW(e.target.value)}
                placeholder="例: 60.0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
            <Button onClick={handleSave}>設定する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>目標をリセットしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              現在の目標を終了します。獲得済みのバッジやマイルストーン記録は保持されます。新しい目標を再設定できます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>リセット</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrainerWeightJourneyPanel;
