import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
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
 * 受付しない時間帯（`booking_blocked_windows`）を編集する。
 *
 * 「平日は 18:15 の回と 19:30 の回だけを残し、その間に始まる予約を受け付けない」
 * のように、**開始時刻を揃えて夜の枠数を確保する**ための設定（実店舗の要望）。
 *
 * 🔴 帯は**両端を含まない**。start / end ちょうどに始まる予約は受け付ける
 * （両端こそが残したい2枠そのもの）。説明文（blockedWindows.desc / rowHint）で明示する。
 *
 * 🔴 効くのはお客様の自己予約だけ。店側の代理予約（TrainerSchedule）は帯の中でも
 * 入れられる（事情のある方の例外は店の裁量）。免除（予約回数の制限の「免除」行）も
 * この帯より強い。DB トリガー（guard_booking_blocked_window / GB006）が最終判定。
 *
 * 保存は挿入 → 差分削除の順（削除→挿入だと、挿入だけ失敗したときに帯が全部
 * 静かに消える。TrainerBookingLimits / TrainerCapacityWindows と同じ理由）。
 */

// 🔴 15分刻み。予約枠のグリッドが15分刻みなので、30分刻みだと
// 「18:15 と 19:30 を残す」のような実際の使い方が設定できない。
const windowTime = (i: number) => {
  const total = i * 15;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const WINDOW_START_OPTIONS = Array.from({ length: 96 }, (_, i) => windowTime(i));
const WINDOW_END_OPTIONS = Array.from({ length: 96 }, (_, i) => windowTime(i + 1));

interface EditableWindow {
  key: string;
  weekdays: number[];
  start: string;
  end: string;
  enabled: boolean;
}

const newWindowKey = () => `b-${Math.random().toString(36).slice(2, 10)}`;

/** 追加ボタンの既定値。実店舗の典型例（平日夜を 18:15 と 19:30 の2枠に揃える）。 */
const defaultWindow = (): EditableWindow => ({
  key: newWindowKey(),
  weekdays: [1, 2, 3, 4, 5],
  start: "18:15",
  end: "19:30",
  enabled: true,
});

const TrainerBlockedWindows = () => {
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
      .from("booking_blocked_windows")
      .select("id, weekdays, start_time, end_time, enabled")
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
      toast.error(t("blockedWindows.invalidWeekdays"));
      return;
    }
    if (windows.some((w) => w.end <= w.start)) {
      toast.error(t("blockedWindows.invalidRange"));
      return;
    }
    setSaving(true);
    if (windows.length > 0) {
      const rows = windows.map((w) => ({
        tenant_id: tenant.id,
        weekdays: [...w.weekdays].sort((a, b) => a - b),
        start_time: w.start,
        end_time: w.end,
        enabled: w.enabled,
      }));
      const { data: inserted, error } = await supabase
        .from("booking_blocked_windows")
        .insert(rows as never)
        .select("id");
      if (error) {
        console.error("受付しない時間帯の保存に失敗:", error);
        toast.error(t("blockedWindows.saveFailed"));
        setSaving(false);
        return;
      }
      const keepIds = (inserted ?? []).map((r: { id: string }) => r.id);
      const { error: delErr } = await supabase
        .from("booking_blocked_windows")
        .delete()
        .eq("tenant_id", tenant.id)
        .not("id", "in", `(${keepIds.join(",")})`);
      if (delErr) {
        console.error("受付しない時間帯の旧行削除に失敗:", delErr);
        toast.error(t("blockedWindows.saveFailed"));
        setSaving(false);
        void load();
        return;
      }
    } else {
      const { error: delErr } = await supabase
        .from("booking_blocked_windows")
        .delete()
        .eq("tenant_id", tenant.id);
      if (delErr) {
        console.error("受付しない時間帯の削除に失敗:", delErr);
        toast.error(t("blockedWindows.saveFailed"));
        setSaving(false);
        return;
      }
    }
    toast.success(windows.length === 0 ? t("blockedWindows.cleared") : t("blockedWindows.saved"));
    setSaving(false);
    void load();
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        {t("blockedWindows.section")}
      </h3>
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("blockedWindows.desc")}</p>

          {loadFailed && !loading && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-destructive">{t("blockedWindows.loadFailed")}</p>
              <Button variant="outline" size="sm" className="h-8" onClick={() => void load()}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                {t("blockedWindows.reload")}
              </Button>
            </div>
          )}
          {windows.length === 0 && !loading && !loadFailed && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Ban className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("blockedWindows.empty")}
            </p>
          )}

          {windows.map((w) => (
            <div key={w.key} className="rounded-lg border border-border p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={w.enabled}
                    aria-label={t("blockedWindows.enabledLabel")}
                    onCheckedChange={(on) => patchWindow(w.key, { enabled: on })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {w.enabled ? t("blockedWindows.enabledLabel") : t("blockedWindows.disabledLabel")}
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
                    {/* SQL直挿入等で15分刻み外の値が入っていても表示を保つ（黙って丸めない） */}
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
              </div>

              {/* 🔴 両端は受け付ける、を行ごとに具体的な時刻で示す（誤解がいちばん起きる場所） */}
              <p className="text-xs text-muted-foreground">
                {t("blockedWindows.rowHint", { start: w.start, end: w.end })}
              </p>
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
              {t("blockedWindows.addWindow")}
            </Button>
            <Button onClick={handleSave} disabled={saving || loading || loadFailed} size="sm" className="h-10">
              <Save className="w-4 h-4 mr-1" />
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t("blockedWindows.proxyNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrainerBlockedWindows;
