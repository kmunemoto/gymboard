import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarX, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

/** 「上限なし」を表す Select の値。空文字は Radix の Select が受け付けないため文字列を使う。 */
const NO_LIMIT = "__none__";

const LIMIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];

/**
 * 1日に受ける予約の上限件数（`tenants.daily_booking_limit`）。
 *
 * 実店舗の要望（2026-09-01 宗本さん）:「1日に見られる人数に限りがある。
 * 上限に達したら、枠が空いていてもその日の受付を止めたい」。
 *
 * 🔴 上限は毎日おなじ1つの数字。曜日別には持たない（2026-09-01 にそう決めた）。
 *    曜日で変えたい日は、予定表からその日を手で止めれば同じことができる。
 *    設定を増やすより、1つの数字＋ワンタップのほうが運用が軽い。
 *
 * 🔴 店側の代理予約には効かない。上限に達した日でも、予定表から手で入れる分は通る。
 *    最終判定は DB（`tenant_day_closed` / GB007）。
 */
const TrainerDailyBookingLimit = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const [value, setValue] = useState<string>(NO_LIMIT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const current = tenant?.daily_booking_limit;
    setValue(typeof current === "number" && current >= 1 ? String(current) : NO_LIMIT);
  }, [tenant?.daily_booking_limit]);

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    const next = value === NO_LIMIT ? null : parseInt(value, 10);
    const { error } = await supabase
      .from("tenants")
      .update({ daily_booking_limit: next } as never)
      .eq("id", tenant.id);
    if (error) {
      console.error("1日の上限人数の保存に失敗:", error);
      toast.error(t("closedDays.limitSaveFailed"), { description: error.message });
    } else {
      toast.success(t("closedDays.limitSaved"));
      refetchTenant();
    }
    setSaving(false);
  };

  return (
    <>
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <CalendarX className="w-3.5 h-3.5" />
        {t("closedDays.limitSection")}
      </h3>
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("closedDays.limitDesc")}</p>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t("closedDays.limitLabel")}</Label>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LIMIT}>{t("closedDays.limitNone")}</SelectItem>
                {LIMIT_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t("closedDays.limitUnit", { count: n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{t("closedDays.limitProxyNote")}</p>
          <Button onClick={handleSave} disabled={saving || !tenant} size="sm" className="h-10">
            <Save className="w-4 h-4 mr-1" />
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </CardContent>
      </Card>
    </>
  );
};

export default TrainerDailyBookingLimit;
