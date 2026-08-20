import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useTenantStaff } from "@/hooks/useTenantStaff";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatWeekdayShort } from "@/lib/dateFormat";
import { SHIFT_WEEKDAY_ORDER, type StaffScheduleRow } from "@/lib/staffSchedule";
import { canSelectStaff } from "@/lib/tenantStaff";

/**
 * スタッフごとの「働く曜日と時間帯」（`staff_schedules`）を編集する。
 *
 * ## 🔴 「1曜日もONにしない」＝シフト未設定＝営業時間どおり
 *
 * DB 側と同じ規則（`src/lib/staffSchedule.ts`）。全部OFFにして保存すると行が0件になり、
 * そのスタッフは営業時間どおりに戻る。「全曜日休み」にはできない
 * （それをやりたいならスタッフから外すのが筋なので、UI でも表現しない）。
 *
 * スタッフが1人しかいないジムでは出さない。指名の概念が無いので設定しても効かない。
 */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const total = i * 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
});

type DayState = { enabled: boolean; start: string; end: string };

const TrainerStaffSchedule = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const { staff } = useTenantStaff();
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [days, setDays] = useState<Record<number, DayState>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const defaultStart = tenant?.operating_hours?.start ?? "10:00";
  const defaultEnd = tenant?.operating_hours?.end ?? "21:00";

  const load = useCallback(async () => {
    if (!tenant?.id || !selectedStaffId) return;
    setLoading(true);
    const { data } = await supabase
      .from("staff_schedules")
      .select("user_id, weekday, start_time, end_time")
      .eq("tenant_id", tenant.id)
      .eq("user_id", selectedStaffId);
    const rows = (data ?? []) as StaffScheduleRow[];
    const next: Record<number, DayState> = {};
    for (const d of SHIFT_WEEKDAY_ORDER) {
      const row = rows.find((r) => r.weekday === d);
      next[d] = row
        ? { enabled: true, start: row.start_time, end: row.end_time }
        : { enabled: false, start: defaultStart, end: defaultEnd };
    }
    setDays(next);
    setLoading(false);
  }, [tenant?.id, selectedStaffId, defaultStart, defaultEnd]);

  useEffect(() => { void load(); }, [load]);

  // スタッフが読めたら先頭を選んでおく（毎回選ばせない）。
  useEffect(() => {
    if (!selectedStaffId && staff.length > 0) setSelectedStaffId(staff[0].user_id);
  }, [staff, selectedStaffId]);

  const handleSave = async () => {
    if (!tenant?.id || !selectedStaffId) return;
    const rows = SHIFT_WEEKDAY_ORDER
      .filter((d) => days[d]?.enabled)
      .map((d) => ({
        tenant_id: tenant.id,
        user_id: selectedStaffId,
        weekday: d,
        start_time: days[d].start,
        end_time: days[d].end,
      }));
    // 終わりが始まり以前の曜日があれば DB の CHECK に当たる。先に文言で返す。
    const broken = rows.find((r) => r.end_time <= r.start_time);
    if (broken) {
      toast.error(t("staffSchedule.invalidRange", { day: formatWeekdayShort(broken.weekday) }));
      return;
    }
    setSaving(true);
    // 「消してから入れ直す」でよい。曜日ごとの差分を取るより、
    // 1人ぶんを丸ごと置き換えるほうが状態がずれない（UNIQUE 制約とも喧嘩しない）。
    const { error: delErr } = await supabase
      .from("staff_schedules")
      .delete()
      .eq("tenant_id", tenant.id)
      .eq("user_id", selectedStaffId);
    if (delErr) {
      console.error("シフトの削除に失敗:", delErr);
      toast.error(t("staffSchedule.saveFailed"), { description: delErr.message });
      setSaving(false);
      return;
    }
    if (rows.length > 0) {
      const { error } = await supabase.from("staff_schedules").insert(rows as never);
      if (error) {
        console.error("シフトの保存に失敗:", error);
        toast.error(t("staffSchedule.saveFailed"), { description: error.message });
        setSaving(false);
        return;
      }
    }
    toast.success(rows.length === 0 ? t("staffSchedule.clearedToBusinessHours") : t("staffSchedule.saved"));
    setSaving(false);
    void load();
  };

  // 1人しかいないジムでは指名の概念が無いので出さない。
  if (!canSelectStaff(staff)) return null;

  const anyEnabled = SHIFT_WEEKDAY_ORDER.some((d) => days[d]?.enabled);

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        {t("staffSchedule.section")}
      </h3>
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("staffSchedule.desc")}</p>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t("staffSchedule.staffLabel")}</Label>
            <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.user_id} value={s.user_id}>{s.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            {SHIFT_WEEKDAY_ORDER.map((d) => {
              const state = days[d] ?? { enabled: false, start: defaultStart, end: defaultEnd };
              return (
                <div key={d} className="flex items-center gap-2">
                  <span className="w-6 text-xs font-bold text-muted-foreground shrink-0">
                    {formatWeekdayShort(d)}
                  </span>
                  <Switch
                    checked={state.enabled}
                    aria-label={formatWeekdayShort(d)}
                    disabled={loading}
                    onCheckedChange={(on) => setDays((prev) => ({ ...prev, [d]: { ...state, enabled: on } }))}
                  />
                  {state.enabled ? (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <Select
                        value={state.start}
                        onValueChange={(v) => setDays((prev) => ({ ...prev, [d]: { ...state, start: v } }))}
                      >
                        <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TIME_OPTIONS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground shrink-0">–</span>
                      <Select
                        value={state.end}
                        onValueChange={(v) => setDays((prev) => ({ ...prev, [d]: { ...state, end: v } }))}
                      >
                        <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TIME_OPTIONS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("staffSchedule.off")}</span>
                  )}
                </div>
              );
            })}
          </div>

          {!anyEnabled && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <CalendarClock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("staffSchedule.unsetHint")}
            </p>
          )}

          <Button onClick={handleSave} disabled={saving || loading || !selectedStaffId} size="sm" className="h-10">
            <Save className="w-4 h-4 mr-1" />
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrainerStaffSchedule;
