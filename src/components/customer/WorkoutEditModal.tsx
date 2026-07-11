import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { buildWorkoutSetsUpdate, type WorkoutSet } from "@/lib/workoutEdit";

export type EditableSet = WorkoutSet;

export interface EditableWorkout {
  id: string;
  exercise_name: string;
  workout_date: string;
  sets: EditableSet[] | null;
  weight: number | null;
  reps: number | null;
}

interface SetInput {
  weight: string;
  reps: string;
}

interface WorkoutEditModalProps {
  workout: EditableWorkout | null;
  open: boolean;
  onClose: () => void;
  /** 保存成功時に、更新後の sets / weight / reps を親へ返す（親のローカル状態を更新する用）。 */
  onSaved: (id: string, sets: EditableSet[], weight: number | null, reps: number | null) => void;
}

// お客様が自分のトレーニング記録（重量・回数・セット数）を編集する。
// RLS 上、お客様は自分の workouts を UPDATE できる（"Users can update own workouts"）。
// トレーナーの記録追加フロー（TrainerClientDetail）は delete+insert で gamification を
// 再発火させるが、こちらは「既存記録の修正」なので純粋な UPDATE のみ行い、
// ミッション・レイド等の報酬は再付与しない（編集での二重付与・不整合を避ける）。
const WorkoutEditModal = ({ workout, open, onClose, onSaved }: WorkoutEditModalProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [sets, setSets] = useState<SetInput[]>([{ weight: "", reps: "" }]);
  const [saving, setSaving] = useState(false);

  // 開くたびに対象記録のセットで初期化する。
  useEffect(() => {
    if (!workout) return;
    const initial = workout.sets && workout.sets.length > 0
      ? workout.sets
      : (workout.weight != null ? [{ set: 1, weight: workout.weight, reps: workout.reps ?? 0 }] : []);
    setSets(
      initial.length > 0
        ? initial.map((s) => ({ weight: String(s.weight ?? ""), reps: String(s.reps ?? "") }))
        : [{ weight: "", reps: "" }],
    );
  }, [workout]);

  const updateSet = (idx: number, field: "weight" | "reps", value: string) => {
    setSets((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };
  const addSet = () => setSets((prev) => [...prev, { weight: "", reps: "" }]);
  const removeSet = (idx: number) => setSets((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const handleSave = async () => {
    if (!workout || !user) return;
    // 重量・回数の両方が入っているセットのみ有効（トレーナー側の保存条件と同じ）。
    const { valid, sets: newSets, weight: topWeight, reps: topReps } = buildWorkoutSetsUpdate(sets);
    if (!valid) {
      toast.error(t("training.editNeedOneSet"));
      return;
    }
    setSaving(true);

    // 自分の記録のみ更新（user_id 条件は RLS と多重防御）。
    const { error } = await supabase
      .from("workouts")
      .update({ sets: newSets as unknown as never, weight: topWeight, reps: topReps })
      .eq("id", workout.id)
      .eq("user_id", user.id);

    if (error) {
      console.error("[WorkoutEditModal] update failed:", error.message);
      toast.error(t("training.editError"));
      setSaving(false);
      return;
    }
    onSaved(workout.id, newSets, topWeight, topReps);
    toast.success(t("training.editSaved"));
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("training.editTitle")}</DialogTitle>
          <DialogDescription>
            {workout ? `${workout.exercise_name} — ${t("training.editSubtitle")}` : t("training.editSubtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 py-1">
          {sets.map((s, si) => (
            <div key={si} className="space-y-1">
              {sets.length > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-muted-foreground">{t("training.setNum", { n: si + 1 })}</span>
                  <button
                    type="button"
                    onClick={() => removeSet(si)}
                    className="text-destructive/60 hover:text-destructive transition-colors p-0.5"
                    aria-label={t("common.deleteAction")}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-0.5 block">{t("training.editWeight")}</label>
                  <Input type="number" inputMode="decimal" step="0.5" placeholder="60" value={s.weight} onChange={(e) => updateSet(si, "weight", e.target.value)} className="h-11" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-0.5 block">{t("training.editReps")}</label>
                  <Input type="number" inputMode="numeric" placeholder="10" value={s.reps} onChange={(e) => updateSet(si, "reps", e.target.value)} className="h-11" />
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addSet}
            className="w-full text-xs text-accent font-medium py-1.5 rounded-lg border border-dashed border-accent/40 hover:bg-accent/5 transition-colors flex items-center justify-center gap-1"
          >
            <Plus className="w-3 h-3" /> {t("training.addSet")}
          </button>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1">
            {t("common.cancel")}
          </Button>
          <Button variant="accent" onClick={handleSave} disabled={saving} className="flex-1">
            {saving && <DumbbellLoader className="w-4 h-4 mr-1.5" />}
            {t("training.editSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WorkoutEditModal;
