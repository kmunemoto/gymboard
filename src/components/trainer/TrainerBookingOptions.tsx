import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  OPTION_DURATION_OPTIONS,
  OPTION_NAME_MAX,
  validateBookingOption,
} from "@/lib/bookingOptions";

/**
 * 予約のオプション（`booking_options`）を編集する。
 *
 * 例:「トレーニングのあとに 30分 3,000円 のストレッチ」。追加した時間は
 * **同じ1回のセッション**として扱う（間の準備時間は挟まない）。詳しくは
 * `src/lib/bookingOptions.ts` と `supabase/migrations/20260902000000_booking_options.sql`。
 *
 * 🔴 保存は「更新 → 追加 → 削除」の順。削除を先にすると、追加だけ失敗したときに
 *    オプションが静かに全部消える（TrainerCapacityWindows と同じ理由）。
 *
 * 🔴 行の id は保存しても変わらない（差し替えではなく更新する）。
 *    予約側がオプションを id で指すようになるため、保存のたびに id が変わると
 *    過去の予約から「何を付けたか」が辿れなくなる。
 */

interface EditableOption {
  key: string;
  /** DB にある行なら id、追加したばかりなら null */
  id: string | null;
  name: string;
  duration: number;
  /** 入力途中を保つため文字列で持つ（"" は「料金を表示しない」= 0） */
  price: string;
  enabled: boolean;
}

const newKey = () => `o-${Math.random().toString(36).slice(2, 10)}`;

/** 追加ボタンの既定値。いちばん多い形（トレーニング後の30分）をそのまま出す。 */
const defaultOption = (): EditableOption => ({
  key: newKey(),
  id: null,
  name: "",
  duration: 30,
  price: "",
  enabled: true,
});

const toPriceYen = (price: string): number => {
  const n = parseInt(price.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

const TrainerBookingOptions = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const [options, setOptions] = useState<EditableOption[]>([]);
  const [loading, setLoading] = useState(true);
  // 読み込み失敗を「0件」と区別する。区別しないと、通信が一瞬切れたあとに
  // 保存を押しただけで既存のオプションを全削除できてしまう。
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setLoadFailed(false);
    const { data, error } = await supabase
      .from("booking_options")
      .select("id, name, duration_minutes, price_yen, enabled, sort_order")
      .eq("tenant_id", tenant.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) {
      setOptions([]);
      setLoadFailed(true);
    } else {
      setOptions(
        data.map((o) => ({
          key: o.id,
          id: o.id,
          name: o.name,
          duration: o.duration_minutes,
          price: o.price_yen > 0 ? String(o.price_yen) : "",
          enabled: o.enabled,
        })),
      );
    }
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { void load(); }, [load]);

  const patch = (key: string, next: Partial<EditableOption>) =>
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...next } : o)));

  const handleSave = async () => {
    if (!tenant?.id) return;

    for (const o of options) {
      const reason = validateBookingOption({
        name: o.name,
        duration_minutes: o.duration,
        price_yen: toPriceYen(o.price),
      });
      if (reason) {
        toast.error(t(`bookingOptions.invalid.${reason}`));
        return;
      }
    }

    setSaving(true);
    const rows = options.map((o, i) => ({
      id: o.id,
      tenant_id: tenant.id,
      name: o.name.trim(),
      duration_minutes: o.duration,
      price_yen: toPriceYen(o.price),
      enabled: o.enabled,
      sort_order: i,
    }));

    // 1) 既にある行を更新する（id を変えない）
    for (const row of rows.filter((r) => r.id)) {
      const { id, ...values } = row;
      const { error } = await supabase
        .from("booking_options")
        .update(values as never)
        .eq("id", id as string);
      if (error) {
        console.error("予約オプションの更新に失敗:", error);
        toast.error(t("bookingOptions.saveFailed"));
        setSaving(false);
        return;
      }
    }

    // 2) 追加ぶんを入れる
    const added = rows.filter((r) => !r.id).map(({ id: _id, ...values }) => values);
    if (added.length > 0) {
      const { error } = await supabase.from("booking_options").insert(added as never);
      if (error) {
        console.error("予約オプションの追加に失敗:", error);
        toast.error(t("bookingOptions.saveFailed"));
        setSaving(false);
        void load();
        return;
      }
    }

    // 3) 画面から消したぶんを消す（最後にやる）
    const keepIds = rows.map((r) => r.id).filter((v): v is string => Boolean(v));
    const del = supabase.from("booking_options").delete().eq("tenant_id", tenant.id);
    const { error: delErr } = keepIds.length > 0
      ? await del.not("id", "in", `(${keepIds.join(",")})`)
      : await del;
    if (delErr) {
      console.error("予約オプションの削除に失敗:", delErr);
      toast.error(t("bookingOptions.saveFailed"));
      setSaving(false);
      void load();
      return;
    }

    toast.success(options.length === 0 ? t("bookingOptions.cleared") : t("bookingOptions.saved"));
    setSaving(false);
    void load();
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" />
        {t("bookingOptions.section")}
      </h3>
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("bookingOptions.desc")}</p>

          {loadFailed && !loading && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-destructive">{t("bookingOptions.loadFailed")}</p>
              <Button variant="outline" size="sm" className="h-8" onClick={() => void load()}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                {t("bookingOptions.reload")}
              </Button>
            </div>
          )}
          {options.length === 0 && !loading && !loadFailed && (
            <p className="text-xs text-muted-foreground">{t("bookingOptions.empty")}</p>
          )}

          {options.map((o) => (
            <div key={o.key} className="rounded-lg border border-border p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={o.enabled}
                    aria-label={t("bookingOptions.enabledLabel")}
                    onCheckedChange={(on) => patch(o.key, { enabled: on })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {o.enabled ? t("bookingOptions.enabledLabel") : t("bookingOptions.disabledLabel")}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-destructive"
                  aria-label={t("common.delete")}
                  onClick={() => setOptions((prev) => prev.filter((x) => x.key !== o.key))}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("bookingOptions.nameLabel")}</Label>
                <Input
                  className="h-10"
                  maxLength={OPTION_NAME_MAX}
                  value={o.name}
                  placeholder={t("bookingOptions.namePlaceholder")}
                  onChange={(e) => patch(o.key, { name: e.target.value })}
                />
              </div>

              <div className="flex gap-2">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs font-bold">{t("bookingOptions.durationLabel")}</Label>
                  <Select
                    value={String(o.duration)}
                    onValueChange={(v) => patch(o.key, { duration: Number(v) })}
                  >
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {/* SQL直挿入等で一覧に無い値が入っていても表示を保つ（黙って丸めない） */}
                      {!OPTION_DURATION_OPTIONS.includes(o.duration) && (
                        <SelectItem value={String(o.duration)}>
                          {t("bookingOptions.durationUnit", { count: o.duration })}
                        </SelectItem>
                      )}
                      {OPTION_DURATION_OPTIONS.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {m === 0
                            ? t("bookingOptions.durationNone")
                            : t("bookingOptions.durationUnit", { count: m })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs font-bold">{t("bookingOptions.priceLabel")}</Label>
                  <Input
                    className="h-10"
                    inputMode="numeric"
                    value={o.price}
                    placeholder={t("bookingOptions.pricePlaceholder")}
                    onChange={(e) => patch(o.key, { price: e.target.value.replace(/[^\d]/g, "") })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t("bookingOptions.priceHint")}</p>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-10"
              onClick={() => setOptions((prev) => [...prev, defaultOption()])}
            >
              <Plus className="w-4 h-4 mr-1" />
              {t("bookingOptions.addOption")}
            </Button>
            <Button onClick={handleSave} disabled={saving || loading || loadFailed} size="sm" className="h-10">
              <Save className="w-4 h-4 mr-1" />
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t("bookingOptions.footprintNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrainerBookingOptions;
