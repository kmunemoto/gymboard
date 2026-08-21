import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatWeekdayShort } from "@/lib/dateFormat";
import { SHIFT_WEEKDAY_ORDER } from "@/lib/staffSchedule";

/**
 * 時間帯別の同時受け入れ数（`booking_capacity_windows`）を編集する。
 *
 * 「平日の夜は1人で回すので同時1件」「土曜の午前は応援がいるので3件」のように、
 * 時間帯によって受けられる数が変わる店のための設定。帯を1つも作らなければ、
 * 営業時間カードの「同時に受けられる予約数」がそのまま全時間に効く（従来どおり）。
 *
 * 🔴 これは**その時間の枠そのもの**を絞る設定で、「予約回数の制限」（お一人が
 * 取りすぎるのを防ぐ）とは別物。並べて置いてあるので、説明文で違いを示す。
 *
 * 保存は挿入 → 差分削除の順（削除→挿入だと、挿入だけ失敗したときに帯が全部
 * 静かに消えて「制限なし」に戻る。TrainerBookingLimits と同じ理由）。
 */

// 30分刻みの時刻。営業時間・シフト・回数制限の設定と同じ範囲。
const windowTime = (i: number) => {
  const total = i * 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const WINDOW_START_OPTIONS = Array.from({ length: 48 }, (_, i) => windowTime(i));
const WINDOW_END_OPTIONS = Array.from({ length: 48 }, (_, i) => windowTime(i + 1));
// 営業時間カードの BUSINESS_CAPACITY_OPTIONS と同じ並びにする（同じ概念の設定なので）
const CAPACITY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];

interface EditableWindow {
  key: string;
  weekdays: number[];
  start: string;
  end: string;
  capacity: number;
  enabled: boolean;
}

const newWindowKey = () => `w-${Math.random().toString(36).slice(2, 10)}`;

/** 追加ボタンの既定値。よくある形（平日の夜は手薄）をそのまま出す。 */
const defaultWindow = (): EditableWindow => ({
  key: newWindowKey(),
  weekdays: [1, 2, 3, 4, 5],
  start: "18:00",
  end: "21:00",
  capacity: 1,
  enabled: true,
});

const TrainerCapacityWindows = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const [windows, setWindows] = useState<EditableWindow[]>([]);
  const [loading, setLoading] = useState(true);
  // 読み込み失敗を「帯0件」と区別する。区別しないと、一時的な通信断のあとに
  // 保存を押しただけで既存の帯を全削除できてしまう。
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setLoadFailed(false);
    const { data, error } = await supabase
      .from("booking_capacity_windows")
      .select("id, weekdays, start_time, end_time, capacity, enabled")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: true });
    if (error || !data) {
      setWindows([]);
      setLoadFailed(true);
    } else {
      setWindows(
        data.map((w) => ({
          key: w.id,
          weekdays: (w.weekdays as number[]) ?? [],
          start: w.start_time,
          end: w.end_time,
          capacity: w.capacity,
          enabled: w.enabled,
        })),
      );
    }
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { void load(); }, [load]);

  const patchWindow = (key: string, patch: Partial<EditableWindow>) =>
    setWindows((prev) => prev.map((w) => (w.key === key ? { ...w, ...patch } : w)));

  const toggleWeekday = (key: string, d: number) =>
    setWindows((prev) =>
      prev.map((w) => {
        if (w.key !== key) return w;
        const has = w.weekdays.includes(d);
        return { ...w, weekdays: has ? w.weekdays.filter((x) => x !== d) : [...w.weekdays, d] };
      }),
    );

  const handleSave = async () => {
    if (!tenant?.id) return;
    if (windows.some((w) => w.weekdays.length === 0)) {
      toast.error(t("capacityWindows.invalidWeekdays"));
      return;
    }
    if (windows.some((w) => w.end <= w.start)) {
      toast.error(t("capacityWindows.invalidRange"));
      return;
    }
    setSaving(true);
    if (windows.length > 0) {
      const rows = windows.map((w) => ({
        tenant_id: tenant.id,
        weekdays: [...w.weekdays].sort((a, b) => a - b),
        start_time: w.start,
        end_time: w.end,
        capacity: w.capacity,
        enabled: w.enabled,
      }));
      const { data: inserted, error } = await supabase
        .from("booking_capacity_windows")
        .insert(rows as never)
        .select("id");
      if (error) {
        console.error("時間帯別の同時受入数の保存に失敗:", error);
        toast.error(t("capacityWindows.saveFailed"));
        setSaving(false);
        return;
      }
      const keepIds = (inserted ?? []).map((r: { id: string }) => r.id);
      const { error: delErr } = await supabase
        .from("booking_capacity_windows")
        .delete()
        .eq("tenant_id", tenant.id)
        .not("id", "in", `(${keepIds.join(",")})`);
      if (delErr) {
        console.error("時間帯別の同時受入数の旧行削除に失敗:", delErr);
        toast.error(t("capacityWindows.saveFailed"));
        setSaving(false);
        void load();
        return;
      }
    } else {
      const { error: delErr } = await supabase
        .from("booking_capacity_windows")
        .delete()
        .eq("tenant_id", tenant.id);
      if (delErr) {
        console.error("時間帯別の同時受入数の削除に失敗:", delErr);
        toast.error(t("capacityWindows.saveFailed"));
        setSaving(false);
        return;
      }
    }
    toast.success(windows.length === 0 ? t("capacityWindows.cleared") : t("capacityWindows.saved"));
    setSaving(false);
    void load();
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        {t("capacityWindows.section")}
      </h3>
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("capacityWindows.desc")}</p>

          {loadFailed && !loading && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-destructive">{t("capacityWindows.loadFailed")}</p>
              <Button variant="outline" size="sm" className="h-8" onClick={() => void load()}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                {t("capacityWindows.reload")}
              </Button>
            </div>
          )}
          {windows.length === 0 && !loading && !loadFailed && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <LayoutGrid className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("capacityWindows.empty")}
            </p>
          )}

          {windows.map((w) => (
            <div key={w.key} className="rounded-lg border border-border p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={w.enabled}
                    aria-label={t("capacityWindows.enabledLabel")}
                    onCheckedChange={(on) => patchWindow(w.key, { enabled: on })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {w.enabled ? t("capacityWindows.enabledLabel") : t("capacityWindows.disabledLabel")}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-destructive"
                  aria-label={t("common.delete")}
                  onClick={() => setWindows((prev) => prev.filter((x) => x.key !== w.key))}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {SHIFT_WEEKDAY_ORDER.map((d) => {
                  const on = w.weekdays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleWeekday(w.key, d)}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold border transition-colors ${
                        on
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-muted-foreground border-border"
                      }`}
                    >
                      {formatWeekdayShort(d)}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5">
                <Select value={w.start} onValueChange={(v) => patchWindow(w.key, { start: v })}>
                  <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* SQL直挿入等で30分刻み外の値が入っていても表示を保つ（黙って丸めない） */}
                    {!WINDOW_START_OPTIONS.includes(w.start) && (
                      <SelectItem value={w.start}>{w.start}</SelectItem>
                    )}
                    {WINDOW_START_OPTIONS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground shrink-0">–</span>
                <Select value={w.end} onValueChange={(v) => patchWindow(w.key, { end: v })}>
                  <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!WINDOW_END_OPTIONS.includes(w.end) && (
                      <SelectItem value={w.end}>{w.end}</SelectItem>
                    )}
                    {WINDOW_END_OPTIONS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={String(w.capacity)}
                  onValueChange={(v) => patchWindow(w.key, { capacity: Number(v) })}
                >
                  <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!CAPACITY_OPTIONS.includes(w.capacity) && (
                      <SelectItem value={String(w.capacity)}>
                        {t("capacityWindows.countUnit", { count: w.capacity })}
                      </SelectItem>
                    )}
                    {CAPACITY_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {t("capacityWindows.countUnit", { count: n })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-10"
              onClick={() => setWindows((prev) => [...prev, defaultWindow()])}
            >
              <Plus className="w-4 h-4 mr-1" />
              {t("capacityWindows.addWindow")}
            </Button>
            <Button onClick={handleSave} disabled={saving || loading || loadFailed} size="sm" className="h-10">
              <Save className="w-4 h-4 mr-1" />
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t("capacityWindows.overlapNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrainerCapacityWindows;
