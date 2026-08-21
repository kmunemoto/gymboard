import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Gauge, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useAllCustomerProfiles } from "@/hooks/useProfile";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatWeekdayShort } from "@/lib/dateFormat";
import { SHIFT_WEEKDAY_ORDER } from "@/lib/staffSchedule";

/**
 * 予約回数の制限（`booking_frequency_limits`）を編集する。
 *
 * 「平日の 18:00〜19:00 は1週間に1回まで」のように、混み合う時間帯に
 * お一人が取れる予約の回数をルールとして持つ。対象は「全員」か「特定のお客様」。
 *
 * 🔴 制限が効くのは**お客様が自分で取る予約だけ**。店側の代理予約
 * （TrainerSchedule）は制限を受けない（お客様に説明の上で例外を作るのは店の裁量）。
 * この非対称は DB トリガー（guard_booking_frequency_limit）が担保している。
 *
 * 保存は「このジムのルールを丸ごと消して入れ直す」。スタッフのシフトと同じで、
 * 行ごとの差分を取るより状態がずれない。ルール0件で保存＝制限なしに戻る。
 */

// 30分刻みの時刻。営業時間・シフトの設定と同じ範囲（開始 00:00〜23:30 / 終了 00:30〜24:00）。
const limitTime = (i: number) => {
  const total = i * 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const LIMIT_START_OPTIONS = Array.from({ length: 48 }, (_, i) => limitTime(i));
const LIMIT_END_OPTIONS = Array.from({ length: 48 }, (_, i) => limitTime(i + 1));
const MAX_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

// Radix の Select は空文字を値にできないので「全員」は番兵値で持つ
const TARGET_ALL = "__all__";

interface EditableRule {
  key: string;               // ローカルの識別子（DBのidとは別。新規行にも振る）
  userId: string;            // TARGET_ALL か お客様の user_id
  weekdays: number[];
  start: string;
  end: string;
  period: "week" | "day";
  max: number;
  enabled: boolean;
}

const newRuleKey = () => `r-${Math.random().toString(36).slice(2, 10)}`;

/** 追加ボタンの既定値。実店舗の典型例（平日夜のピーク帯は週1回まで）をそのまま出す。 */
const defaultRule = (): EditableRule => ({
  key: newRuleKey(),
  userId: TARGET_ALL,
  weekdays: [1, 2, 3, 4, 5],
  start: "18:00",
  end: "19:00",
  period: "week",
  max: 1,
  enabled: true,
});

const TrainerBookingLimits = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const { profiles } = useAllCustomerProfiles();
  const [rules, setRules] = useState<EditableRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("booking_frequency_limits")
      .select("id, user_id, weekdays, start_time, end_time, period, max_bookings, enabled")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: true });
    if (error || !data) {
      // 表が無い環境でも設定画面ごと落とさない（保存しようとした時点で分かる）
      setRules([]);
    } else {
      setRules(
        data.map((r) => ({
          key: r.id,
          userId: r.user_id ?? TARGET_ALL,
          weekdays: (r.weekdays as number[]) ?? [],
          start: r.start_time,
          end: r.end_time,
          period: r.period === "day" ? "day" : "week",
          max: r.max_bookings,
          enabled: r.enabled,
        })),
      );
    }
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { void load(); }, [load]);

  const patchRule = (key: string, patch: Partial<EditableRule>) =>
    setRules((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const toggleWeekday = (key: string, d: number) =>
    setRules((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const has = r.weekdays.includes(d);
        return { ...r, weekdays: has ? r.weekdays.filter((w) => w !== d) : [...r.weekdays, d] };
      }),
    );

  const handleSave = async () => {
    if (!tenant?.id) return;
    // DB の CHECK に当たる前に文言で返す
    if (rules.some((r) => r.weekdays.length === 0)) {
      toast.error(t("bookingLimits.invalidWeekdays"));
      return;
    }
    if (rules.some((r) => r.end <= r.start)) {
      toast.error(t("bookingLimits.invalidRange"));
      return;
    }
    setSaving(true);
    // 丸ごと消して入れ直す（スタッフのシフトと同じ。差分より状態がずれない）
    const { error: delErr } = await supabase
      .from("booking_frequency_limits")
      .delete()
      .eq("tenant_id", tenant.id);
    if (delErr) {
      console.error("予約回数の制限の削除に失敗:", delErr);
      toast.error(t("bookingLimits.saveFailed"), { description: delErr.message });
      setSaving(false);
      return;
    }
    if (rules.length > 0) {
      const rows = rules.map((r) => ({
        tenant_id: tenant.id,
        user_id: r.userId === TARGET_ALL ? null : r.userId,
        weekdays: [...r.weekdays].sort((a, b) => a - b),
        start_time: r.start,
        end_time: r.end,
        period: r.period,
        max_bookings: r.max,
        enabled: r.enabled,
      }));
      const { error } = await supabase.from("booking_frequency_limits").insert(rows as never);
      if (error) {
        console.error("予約回数の制限の保存に失敗:", error);
        toast.error(t("bookingLimits.saveFailed"), { description: error.message });
        setSaving(false);
        return;
      }
    }
    toast.success(rules.length === 0 ? t("bookingLimits.cleared") : t("bookingLimits.saved"));
    setSaving(false);
    void load();
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        {t("bookingLimits.section")}
      </h3>
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("bookingLimits.desc")}</p>

          {rules.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Gauge className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("bookingLimits.empty")}
            </p>
          )}

          {rules.map((rule) => {
            // 退会済みなど、いまの顧客一覧に居ない user_id のルールも表示は保つ
            const knownTarget =
              rule.userId === TARGET_ALL || profiles.some((p) => p.user_id === rule.userId);
            return (
              <div key={rule.key} className="rounded-lg border border-border p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={rule.enabled}
                      aria-label={t("bookingLimits.enabledLabel")}
                      onCheckedChange={(on) => patchRule(rule.key, { enabled: on })}
                    />
                    <span className="text-xs text-muted-foreground">
                      {rule.enabled ? t("bookingLimits.enabledLabel") : t("bookingLimits.disabledLabel")}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-destructive"
                    aria-label={t("common.delete")}
                    onClick={() => setRules((prev) => prev.filter((r) => r.key !== rule.key))}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("bookingLimits.targetLabel")}</Label>
                  <Select value={rule.userId} onValueChange={(v) => patchRule(rule.key, { userId: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TARGET_ALL}>{t("bookingLimits.targetAll")}</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.user_id} value={p.user_id}>{p.display_name}</SelectItem>
                      ))}
                      {!knownTarget && (
                        <SelectItem value={rule.userId}>{t("bookingLimits.targetGone")}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {SHIFT_WEEKDAY_ORDER.map((d) => {
                    const on = rule.weekdays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleWeekday(rule.key, d)}
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
                  <Select value={rule.start} onValueChange={(v) => patchRule(rule.key, { start: v })}>
                    <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LIMIT_START_OPTIONS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground shrink-0">–</span>
                  <Select value={rule.end} onValueChange={(v) => patchRule(rule.key, { end: v })}>
                    <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LIMIT_END_OPTIONS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-1.5">
                  <Select
                    value={rule.period}
                    onValueChange={(v) => patchRule(rule.key, { period: v === "day" ? "day" : "week" })}
                  >
                    <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="week">{t("bookingLimits.periodWeek")}</SelectItem>
                      <SelectItem value="day">{t("bookingLimits.periodDay")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(rule.max)}
                    onValueChange={(v) => patchRule(rule.key, { max: Number(v) })}
                  >
                    <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MAX_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {t("bookingLimits.countUnit")}
                  </span>
                </div>
              </div>
            );
          })}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-10"
              onClick={() => setRules((prev) => [...prev, defaultRule()])}
            >
              <Plus className="w-4 h-4 mr-1" />
              {t("bookingLimits.addRule")}
            </Button>
            <Button onClick={handleSave} disabled={saving || loading} size="sm" className="h-10">
              <Save className="w-4 h-4 mr-1" />
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t("bookingLimits.proxyNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrainerBookingLimits;
