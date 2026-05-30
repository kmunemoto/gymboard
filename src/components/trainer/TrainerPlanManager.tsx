import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant, type TenantPlan } from "@/hooks/useTenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, CreditCard } from "lucide-react";

type PlanType = "subscription" | "ticket" | "period";

interface FormState {
  plan_name: string;
  plan_type: PlanType;
  max_sessions: string;
  price: string;
  validity_days: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  plan_name: "",
  plan_type: "subscription",
  max_sessions: "",
  price: "",
  validity_days: "",
  is_active: true,
};

const TYPE_LABELS: Record<PlanType, string> = {
  subscription: "月額制",
  ticket: "チケット制",
  period: "期間制",
};

const TrainerPlanManager = () => {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const [plans, setPlans] = useState<TenantPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TenantPlan | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TenantPlan | null>(null);

  const fetchPlans = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("tenant_plans")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("sort_order");
    if (error) toast.error("プランの取得に失敗しました");
    setPlans((data as TenantPlan[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (plan: TenantPlan) => {
    setEditing(plan);
    setForm({
      plan_name: plan.plan_name,
      plan_type: plan.plan_type as PlanType,
      max_sessions: plan.max_sessions != null ? String(plan.max_sessions) : "",
      price: String(plan.price ?? ""),
      validity_days: plan.validity_days != null ? String(plan.validity_days) : "",
      is_active: plan.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!tenantId) return;
    const name = form.plan_name.trim();
    if (!name) {
      toast.error("プラン名を入力してください");
      return;
    }
    setSaving(true);
    const payload = {
      tenant_id: tenantId,
      plan_name: name,
      plan_type: form.plan_type,
      max_sessions:
        form.plan_type === "period"
          ? null
          : form.max_sessions
          ? parseInt(form.max_sessions)
          : null,
      price: parseInt(form.price) || 0,
      validity_days:
        form.plan_type === "ticket" || form.plan_type === "period"
          ? form.validity_days
            ? parseInt(form.validity_days)
            : null
          : null,
      is_active: form.is_active,
    };

    if (editing) {
      const { error } = await supabase
        .from("tenant_plans")
        .update(payload)
        .eq("id", editing.id);
      if (error) {
        toast.error("更新に失敗しました");
        setSaving(false);
        return;
      }
      toast.success("プランを更新しました");
    } else {
      const sort_order = (plans[plans.length - 1]?.sort_order ?? 0) + 1;
      const { error } = await supabase
        .from("tenant_plans")
        .insert({ ...payload, sort_order });
      if (error) {
        toast.error("作成に失敗しました");
        setSaving(false);
        return;
      }
      toast.success("プランを追加しました");
    }
    setSaving(false);
    setDialogOpen(false);
    fetchPlans();
  };

  const toggleActive = async (plan: TenantPlan, next: boolean) => {
    setPlans((prev) =>
      prev.map((p) => (p.id === plan.id ? { ...p, is_active: next } : p))
    );
    const { error } = await supabase
      .from("tenant_plans")
      .update({ is_active: next })
      .eq("id", plan.id);
    if (error) {
      toast.error("切り替えに失敗しました");
      fetchPlans();
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { count } = await supabase
      .from("tenant_members")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", deleteTarget.id);
    if ((count ?? 0) > 0) {
      toast.error("このプランは使用中のため削除できません");
      setDeleteTarget(null);
      return;
    }
    const { error } = await supabase
      .from("tenant_plans")
      .delete()
      .eq("id", deleteTarget.id);
    if (error) {
      toast.error("削除に失敗しました");
    } else {
      toast.success("プランを削除しました");
      fetchPlans();
    }
    setDeleteTarget(null);
  };

  const showMaxSessions = form.plan_type !== "period";
  const showValidity = form.plan_type !== "subscription";

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex justify-center py-6">
          <DumbbellLoader className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            プランがまだ登録されていません
          </CardContent>
        </Card>
      ) : (
        plans.map((plan) => (
          <Card key={plan.id} className={!plan.is_active ? "opacity-60" : ""}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <CreditCard className="w-4 h-4 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-sm break-all">{plan.plan_name}</h4>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {TYPE_LABELS[plan.plan_type as PlanType] || plan.plan_type}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ¥{plan.price.toLocaleString()}
                    {plan.max_sessions != null && ` / ${plan.max_sessions}回`}
                    {plan.validity_days != null && ` / ${plan.validity_days}日`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(plan)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => setDeleteTarget(plan)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between pl-12">
                <Label className="text-xs text-muted-foreground">有効</Label>
                <Switch
                  checked={plan.is_active}
                  onCheckedChange={(v) => toggleActive(plan, v)}
                />
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Button onClick={openCreate} variant="outline" className="w-full h-10" disabled={!tenantId}>
        <Plus className="w-4 h-4 mr-1" />
        プランを追加
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "プランを編集" : "プランを追加"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>プラン名</Label>
              <Input
                value={form.plan_name}
                onChange={(e) => setForm({ ...form, plan_name: e.target.value })}
                maxLength={50}
                placeholder="例：月4回コース"
              />
            </div>
            <div>
              <Label>タイプ</Label>
              <select
                value={form.plan_type}
                onChange={(e) => setForm({ ...form, plan_type: e.target.value as PlanType })}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="subscription">月額制（月X回）</option>
                <option value="ticket">チケット制（X回分・有効期限あり）</option>
                <option value="period">期間制（X日間通い放題）</option>
              </select>
            </div>
            {showMaxSessions && (
              <div>
                <Label>{form.plan_type === "subscription" ? "月の上限回数" : "総回数"}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.max_sessions}
                  onChange={(e) => setForm({ ...form, max_sessions: e.target.value })}
                  placeholder="例：4"
                />
              </div>
            )}
            <div>
              <Label>料金（円）</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="例：30000"
              />
            </div>
            {showValidity && (
              <div>
                <Label>有効期限（日間）</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.validity_days}
                  onChange={(e) => setForm({ ...form, validity_days: e.target.value })}
                  placeholder="例：30"
                />
              </div>
            )}
            <div className="flex items-center justify-between pt-1">
              <Label>有効にする</Label>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <DumbbellLoader className="w-4 h-4 mr-1 animate-spin" />}
              {editing ? "更新" : "追加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>プランを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.plan_name}」を削除します。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrainerPlanManager;
