import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      .from("weight_journey")
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
    const tn = parseFloat(targetW);
    if (!Number.isFinite(s) || !Number.isFinite(tn)) {
      toast.error(t("weightJourney.errNumber"));
      return;
    }
    if (tn >= s) {
      toast.error(t("weightJourney.errTarget"));
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("weight_journey").upsert({
      user_id: clientId,
      start_weight: s,
      target_weight: tn,
      is_active: true,
      created_by: user?.id,
    } as any, { onConflict: "user_id" });
    if (error) {
      toast.error(t("weightJourney.saveFailed", { msg: error.message }));
      return;
    }
    toast.success(t("weightJourney.savedToast"));
    setOpen(false);
    await fetch();
  };

  const handleReset = async () => {
    if (!journey) return;
    const { error } = await supabase
      .from("weight_journey")
      .update({ is_active: false } as any)
      .eq("id", journey.id);
    if (error) {
      toast.error(t("weightJourney.resetFailed"));
      return;
    }
    toast.success(t("weightJourney.resetToast"));
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
        <span className="text-sm font-medium">{t("weightJourney.title")}</span>
      </div>

      {!journey ? (
        <Button variant="outline" size="sm" onClick={handleOpen} className="w-full h-9 gap-1.5">
          <Target className="w-3.5 h-3.5" />
          {t("weightJourney.setBtn")}
        </Button>
      ) : (
        <Card className="border-accent/30">
          <CardContent className="p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">{t("weightJourney.start")}</p>
                <p className="text-sm font-bold">{journey.start_weight.toFixed(1)}kg</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">{t("weightJourney.current")}</p>
                <p className="text-sm font-bold text-accent">
                  {latestWeight != null ? `${latestWeight.toFixed(1)}kg` : t("weightJourney.noWeight")}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">{t("weightJourney.target")}</p>
                <p className="text-sm font-bold">{journey.target_weight.toFixed(1)}kg</p>
              </div>
            </div>
            <div className="text-xs text-center text-muted-foreground">
              {t("weightJourney.progressLine", { lost: lost > 0 ? `-${lost.toFixed(1)}kg` : "0.0kg", goal: totalGoal.toFixed(1) })}
              <span className="ml-1.5 font-bold text-accent">{t("weightJourney.progressPct", { pct: progress.toFixed(0) })}</span>
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
              {t("weightJourney.resetBtn")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("weightJourney.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("weightJourney.fieldStart")}</label>
              <Input
                type="number"
                step="0.1"
                value={startW}
                onChange={(e) => setStartW(e.target.value)}
                placeholder={t("weightJourney.startPh")}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("weightJourney.fieldTarget")}</label>
              <Input
                type="number"
                step="0.1"
                value={targetW}
                onChange={(e) => setTargetW(e.target.value)}
                placeholder={t("weightJourney.targetPh")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSave}>{t("weightJourney.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("weightJourney.resetTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("weightJourney.resetDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>{t("weightJourney.resetConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrainerWeightJourneyPanel;
