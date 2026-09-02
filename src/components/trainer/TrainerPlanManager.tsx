import { useEffect, useState } from "react";
import { SLOT_DURATION_OPTIONS } from "@/lib/planSlotDuration";
import { supabase } from "@/integrations/supabase/client";
import { useTenant, type TenantPlan } from "@/hooks/useTenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
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
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { useTranslation } from "react-i18next";

type PlanType = "subscription" | "ticket" | "period";

// 1枠の長さの選択肢は src/lib/planSlotDuration.ts に集約。
// 以前はここと TrainerGymSettings が別々に配列を持ち、ドリフトしうる形だった。

interface FormState {
  plan_name: string;
  plan_type: PlanType;
  max_sessions: string;
  price: string;
  validity_days: string;
  cycle_months: string;
  /** 利用期間の単位。months=応当日ベース（従来）/ weeks / days。保存時は months を null にする */
  cycle_unit: "months" | "weeks" | "days";
  grace_days: string;
  /** 上限を超えた予約を許すか（既定 true＝今までどおり超過できる） */
  allow_overflow: boolean;
  // 空文字列 = 継承（ジムの既定値を使う）。plan_type を問わず全プランで設定可能
  // （cycle_months/grace_days と違い、セッションの長さはサブスク固有の概念ではないため）。
  slot_duration_minutes: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  plan_name: "",
  plan_type: "subscription",
  max_sessions: "",
  price: "",
  validity_days: "",
  cycle_months: "",
  cycle_unit: "months",
  grace_days: "",
  allow_overflow: true,
  slot_duration_minutes: "",
  is_active: true,
};

const TrainerPlanManager = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const TYPE_LABELS: Record<PlanType, string> = {
    subscription: t("settings.plans.typeSubscription"),
    ticket: t("settings.plans.typeTicket"),
    period: t("settings.plans.typePeriod"),
  };

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
    if (error) toast.error(t("settings.plans.fetchFailed"));
    setPlans(data || []);
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
      cycle_months: plan.cycle_months != null ? String(plan.cycle_months) : "",
      cycle_unit: plan.cycle_unit === "weeks" || plan.cycle_unit === "days" ? plan.cycle_unit : "months",
      grace_days: plan.grace_days != null ? String(plan.grace_days) : "",
      // null（未設定）は既定の true として扱う（今までどおり超過できる）
      allow_overflow: plan.allow_overflow !== false,
      slot_duration_minutes: plan.slot_duration_minutes != null ? String(plan.slot_duration_minutes) : "",
      is_active: plan.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!tenantId) return;
    const name = form.plan_name.trim();
    if (!name) {
      toast.error(t("settings.plans.enterName"));
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
      // 利用期間（サイクル単位数）はサブスクのみ。未入力は null（＝1ヶ月）。
      cycle_months:
        form.plan_type === "subscription" && form.cycle_months
          ? Math.max(1, parseInt(form.cycle_months) || 1)
          : null,
      // 利用期間の単位。既定の months は null で保存する（旧データと同じ表現に揃える）。
      cycle_unit:
        form.plan_type === "subscription" && form.cycle_unit !== "months"
          ? form.cycle_unit
          : null,
      // 猶予日数はサブスクのみ。未入力は null（＝0＝猶予なし）。
      grace_days:
        form.plan_type === "subscription" && form.grace_days
          ? Math.max(0, parseInt(form.grace_days) || 0)
          : null,
      // 上限を超えた予約を許すか。🔴 **サブスクでだけ**設定できる。
      // 期間プランは回数無制限、回数券は窓が購入日起算で月次窓と別物
      // （DB の guard_booking_plan_limit も subscription 以外は強制しない）。
      // ここで true に倒さないと「設定は保存できるのに何も効かない」無言の無効化になる。
      allow_overflow: form.plan_type === "subscription" ? form.allow_overflow : true,
      // 空欄（"継承"）は null。plan_type を問わず全プランで設定できる。
      slot_duration_minutes: form.slot_duration_minutes ? parseInt(form.slot_duration_minutes) : null,
      is_active: form.is_active,
    };

    if (editing) {
      const { error } = await supabase
        .from("tenant_plans")
        .update(payload)
        .eq("id", editing.id);
      if (error) {
        toast.error(t("settings.plans.updateFailed"));
        setSaving(false);
        return;
      }
      toast.success(t("settings.plans.updated"));
    } else {
      const sort_order = (plans[plans.length - 1]?.sort_order ?? 0) + 1;
      const { error } = await supabase
        .from("tenant_plans")
        .insert({ ...payload, sort_order });
      if (error) {
        toast.error(t("settings.plans.addFailed"));
        setSaving(false);
        return;
      }
      toast.success(t("settings.plans.added"));
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
      toast.error(t("settings.plans.toggleFailed"));
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
      toast.error(t("settings.plans.inUse"));
      setDeleteTarget(null);
      return;
    }
    const { error } = await supabase
      .from("tenant_plans")
      .delete()
      .eq("id", deleteTarget.id);
    if (error) {
      toast.error(t("settings.plans.deleteFailed"));
    } else {
      toast.success(t("settings.plans.deleted"));
      fetchPlans();
    }
    setDeleteTarget(null);
  };

  const showMaxSessions = form.plan_type !== "period";
  const showValidity = form.plan_type !== "subscription";
  const showCycleMonths = form.plan_type === "subscription";

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex justify-center py-6">
          <DumbbellLoader className="w-5 h-5 text-muted-foreground" />
        </div>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            {t("settings.plans.empty")}
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
                    {plan.max_sessions != null && ` / ${t("settings.plans.sessionsSuffix", { count: plan.max_sessions })}`}
                    {plan.validity_days != null && ` / ${t("settings.plans.daysSuffix", { count: plan.validity_days })}`}
                    {plan.plan_type === "subscription" && plan.cycle_unit === "weeks" && ` / ${t("settings.plans.cycleWeeksSuffix", { count: plan.cycle_months ?? 1 })}`}
                    {plan.plan_type === "subscription" && plan.cycle_unit === "days" && ` / ${t("settings.plans.cycleDaysSuffix", { count: plan.cycle_months ?? 1 })}`}
                    {plan.plan_type === "subscription" && (plan.cycle_unit == null || plan.cycle_unit === "months") && plan.cycle_months != null && plan.cycle_months > 1 && ` / ${t("settings.plans.cycleMonthsSuffix", { count: plan.cycle_months })}`}
                    {plan.plan_type === "subscription" && plan.grace_days != null && plan.grace_days > 0 && ` / ${t("settings.plans.graceDaysSuffix", { count: plan.grace_days })}`}
                    {plan.slot_duration_minutes != null && ` / ${t("settings.plans.slotDurationSuffix", { count: plan.slot_duration_minutes })}`}
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
                <Label className="text-xs text-muted-foreground">{t("settings.plans.enabledLabel")}</Label>
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
        {t("settings.plans.addBtn")}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("settings.plans.editTitle") : t("settings.plans.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("settings.plans.name")}</Label>
              <Input
                value={form.plan_name}
                onChange={(e) => setForm({ ...form, plan_name: e.target.value })}
                maxLength={50}
                placeholder={t("settings.plans.namePlaceholder")}
              />
            </div>
            <div>
              <Label>{t("settings.plans.type")}</Label>
              <select
                value={form.plan_type}
                onChange={(e) => setForm({ ...form, plan_type: e.target.value as PlanType })}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="subscription">{t("settings.plans.typeSubscriptionLong")}</option>
                <option value="ticket">{t("settings.plans.typeTicketLong")}</option>
                <option value="period">{t("settings.plans.typePeriodLong")}</option>
              </select>
            </div>
            {showMaxSessions && (
              <div>
                <Label>{form.plan_type === "subscription" ? t("settings.plans.monthlyLimit") : t("settings.plans.total")}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.max_sessions}
                  onChange={(e) => setForm({ ...form, max_sessions: e.target.value })}
                  placeholder={t("settings.plans.sessionsPlaceholder")}
                />
              </div>
            )}
            <div>
              <Label>{t("settings.plans.price")}</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder={t("settings.plans.pricePlaceholder")}
              />
            </div>
            <div>
              <Label>{t("settings.plans.slotDuration")}</Label>
              <select
                value={form.slot_duration_minutes}
                onChange={(e) => setForm({ ...form, slot_duration_minutes: e.target.value })}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">
                  {t("settings.plans.slotDurationInherit", { minutes: tenant?.slot_duration_minutes ?? 60 })}
                </option>
                {SLOT_DURATION_OPTIONS.map((min) => (
                  <option key={min} value={min}>
                    {t("settings.plans.slotDurationSuffix", { count: min })}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">{t("settings.plans.slotDurationHint")}</p>
            </div>
            {showValidity && (
              <div>
                <Label>{t("settings.plans.validity")}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.validity_days}
                  onChange={(e) => setForm({ ...form, validity_days: e.target.value })}
                  placeholder={t("settings.plans.validityPlaceholder")}
                />
              </div>
            )}
            {showCycleMonths && (
              <div>
                <Label>{t("settings.plans.cycleMonths")}</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={form.cycle_months}
                    onChange={(e) => setForm({ ...form, cycle_months: e.target.value })}
                    placeholder={t("settings.plans.cycleMonthsPlaceholder")}
                    className="flex-1"
                  />
                  <select
                    value={form.cycle_unit}
                    onChange={(e) => setForm({ ...form, cycle_unit: e.target.value as FormState["cycle_unit"] })}
                    className="h-10 px-3 rounded-md border border-input bg-background text-sm shrink-0"
                  >
                    <option value="months">{t("settings.plans.cycleUnitMonths")}</option>
                    <option value="weeks">{t("settings.plans.cycleUnitWeeks")}</option>
                    <option value="days">{t("settings.plans.cycleUnitDays")}</option>
                  </select>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{t("settings.plans.cycleMonthsHint")}</p>
              </div>
            )}
            {showCycleMonths && (
              <div>
                <Label>{t("settings.plans.graceDays")}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.grace_days}
                  onChange={(e) => setForm({ ...form, grace_days: e.target.value })}
                  placeholder={t("settings.plans.graceDaysPlaceholder")}
                />
                <p className="text-[11px] text-muted-foreground mt-1">{t("settings.plans.graceDaysHint")}</p>
              </div>
            )}
            {/* 🔴 サブスクでだけ出す。期間プランは回数無制限、回数券は窓が購入日起算で
                月次窓と別物（DB 側も subscription 以外は強制しない）。出すと
                「ONにしたのに効かない」を店に踏ませる。 */}
            {form.plan_type === "subscription" && (
              <div className="pt-1">
                <div className="flex items-center justify-between">
                  <Label>{t("settings.plans.blockOverflow")}</Label>
                  <Switch
                    checked={!form.allow_overflow}
                    onCheckedChange={(v) => setForm({ ...form, allow_overflow: !v })}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {t("settings.plans.blockOverflowHint")}
                </p>
              </div>
            )}
            <div className="flex items-center justify-between pt-1">
              <Label>{t("settings.plans.enable")}</Label>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <DumbbellLoader className="w-4 h-4 mr-1" />}
              {editing ? t("settings.plans.update") : t("settings.plans.addAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.plans.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.plans.deleteDesc", { name: deleteTarget?.plan_name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("settings.plans.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrainerPlanManager;
