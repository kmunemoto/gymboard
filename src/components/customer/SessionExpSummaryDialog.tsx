import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Star, Dumbbell, TrendingUp, Flame, Heart } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { SessionRewardResult } from "@/lib/raidUtils";

interface Props {
  open: boolean;
  onClose: () => void;
  result: SessionRewardResult | null;
}

const expForLevel = (lv: number) => 250 + lv * 50;
const totalExpToReach = (lv: number) => {
  let s = 0;
  for (let i = 1; i < lv; i++) s += expForLevel(i);
  return s;
};

const SessionExpSummaryDialog = ({ open, onClose, result }: Props) => {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!open || !result) return;
    setCount(0);
    const target = result.session_total;
    const start = performance.now();
    const dur = 800;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setCount(Math.floor(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [open, result]);

  if (!result) return null;

  const lv = result.level;
  const inLv = result.total_exp - totalExpToReach(lv);
  const need = expForLevel(lv);
  const pct = Math.min(100, (inLv / need) * 100);
  const remain = Math.max(0, need - inLv);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <div className="text-center pt-2">
          <h2 className="text-base font-bold mb-4" style={{ color: "#0ABAB5" }}>{t("sessionExp.title")}</h2>
          <div className="space-y-2 text-left text-sm">
            <Row icon={<Star className="w-4 h-4 text-primary" />} label={t("sessionExp.baseExp")} value={`+${result.session_base}`} />
            {result.volume_bonus > 0 && (
              <Row
                icon={<Dumbbell className="w-4 h-4 text-amber-600" />}
                label={t("sessionExp.volumeBonus")}
                sub={t("sessionExp.totalVolume", { volume: Math.floor(result.volume_kg).toLocaleString() })}
                value={`+${result.volume_bonus}`}
              />
            )}
            {result.pr_count > 0 && (
              <Row
                icon={<TrendingUp className="w-4 h-4 text-green-600" />}
                label={t("sessionExp.personalBest")}
                sub={(result.pr_exercises || []).filter(Boolean).slice(0, 3).join(", ")}
                value={`+${result.pr_count * 30}`}
              />
            )}
            {result.combo >= 2 && (
              <Row icon={<Flame className="w-4 h-4 text-orange-500" />} label={t("sessionExp.combo", { count: result.combo })} value={`×${result.multiplier.toFixed(1)}`} />
            )}
            {result.companion_exp_gained && result.companion_exp_gained > 0 && (
              <Row
                icon={<Heart className="w-4 h-4 text-pink-500" />}
                label={result.companion_name ? t("sessionExp.companionWithName", { name: result.companion_name }) : t("sessionExp.companion")}
                value={`+${result.companion_exp_gained}`}
              />
            )}
          </div>
          <div className="border-t border-border my-3" />
          <div className="flex items-end justify-center gap-1.5 mb-3">
            <span className="text-3xl font-extrabold" style={{ color: "#0ABAB5" }}>+{count}</span>
            <span className="text-sm font-bold text-muted-foreground mb-1">EXP</span>
          </div>
          <div className="text-left">
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="font-bold">Lv.{lv}</span>
              <span className="text-muted-foreground">{t("sessionExp.remainExp", { count: remain })}</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
          <Button onClick={onClose} className="w-full mt-4">{t("common.close")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Row = ({ icon, label, sub, value }: { icon: React.ReactNode; label: string; sub?: string; value: string }) => (
  <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-gray-50">
    <div className="flex items-center gap-2 min-w-0">
      {icon}
      <div className="min-w-0">
        <p className="text-xs font-bold break-all">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground break-all">{sub}</p>}
      </div>
    </div>
    <span className="text-sm font-extrabold" style={{ color: "#0ABAB5" }}>{value}</span>
  </div>
);

export default SessionExpSummaryDialog;