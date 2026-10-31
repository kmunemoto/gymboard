import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, ExternalLink, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { getWebOrigin, openExternalUrl } from "@/lib/nativeBridge";
import { menuTrialPath } from "@/lib/menuTrial";
import type { BookingMenu } from "@/lib/bookingMenus";

/**
 * 担当のいるメニューの体験予約ページ（`/trial/:tenantId/menu/:menuId`・2026-10-31）の設定。
 * 予約メニューの各行（担当のいるメニューだけ）に出す。仕組みは src/lib/menuTrial.ts。
 *
 * 宗本さん「マシンピラティス専用の体験予約受付サイトをつくってほしい。
 *           マシンピラティスの時間の枠だけが表示されるように」
 *
 * - オン/オフは押したそばから保存（予約メニューの他のスイッチと同じ）
 * - 料金・案内文は「保存」で書く。料金の空欄は「表示しない」（0 は「¥0」と明示。体験の料金と同じ）
 * - リンクは getWebOrigin()（ネイティブでは capacitor:// になり、送っても開けないため。TrialLinkCard と同じ）
 * 列が無い環境（マイグレーション未適用）では何も出さない。
 */
const TITLE_MAX = 60;
const BODY_MAX = 2000;
const PRICE_MAX = 1000000;

interface TrialSettings {
  trial_enabled: boolean;
  trial_price_yen: number | null;
  trial_info_title: string | null;
  trial_info_body: string | null;
}

const TrainerMenuTrialSettings = ({ menu, tenantId }: { menu: BookingMenu; tenantId: string }) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<TrialSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("booking_menus")
        .select("trial_enabled, trial_price_yen, trial_info_title, trial_info_body")
        .eq("id", menu.id)
        .maybeSingle();
      setSettings(error || !data ? null : data);
    } catch (e) {
      // 読めなくても予約メニューの設定は使えるようにする（この行を出さないだけ）
      console.error("体験予約ページの設定の読み込みに失敗:", e);
      setSettings(null);
    }
  }, [menu.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings) return null;
  const link = `${getWebOrigin()}${menuTrialPath(tenantId, menu.id)}`;

  const openDialog = () => {
    setPrice(settings.trial_price_yen == null ? "" : String(settings.trial_price_yen));
    setTitle(settings.trial_info_title ?? "");
    setBody(settings.trial_info_body ?? "");
    setOpen(true);
  };

  const write = async (patch: Partial<TrialSettings>, okMessage: string): Promise<boolean> => {
    setBusy(true);
    const { error } = await supabase.from("booking_menus").update(patch).eq("id", menu.id);
    setBusy(false);
    if (error) {
      toast.error(t("bookingMenus.trialSaveFailed"), { description: error.message });
      return false;
    }
    toast.success(okMessage);
    await load();
    return true;
  };

  const setEnabled = (on: boolean) =>
    void write({ trial_enabled: on }, t(on ? "bookingMenus.trialOnToast" : "bookingMenus.trialOffToast", { name: menu.name }));

  const save = async () => {
    const raw = price.trim();
    let yen: number | null = null;
    if (raw !== "") {
      // DB の CHECK（0〜1000000）と同じ範囲。ここで弾いて分かりにくい 23514 を出さない
      yen = /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isSafeInteger(yen) || yen < 0 || yen > PRICE_MAX) {
        toast.error(t("bookingMenus.trialPriceInvalid"));
        return;
      }
    }
    const ok = await write(
      { trial_price_yen: yen, trial_info_title: title.trim() || null, trial_info_body: body.trim() || null },
      t("bookingMenus.trialSaved"),
    );
    if (ok) setOpen(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("bookingMenus.trialCopied"));
    } catch {
      toast.error(t("bookingMenus.trialCopyFailed"));
    }
  };

  return (
    <div className="flex items-center gap-1.5" data-testid="menu-trial-settings">
      <Ticket className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground shrink-0">{t("bookingMenus.trialRowLabel")}</span>
      <span className={`text-[11px] font-bold ${settings.trial_enabled ? "text-accent" : "text-muted-foreground"}`}>
        {t(settings.trial_enabled ? "bookingMenus.trialStateOn" : "bookingMenus.trialStateOff")}
      </span>
      <Button type="button" variant="outline" size="sm" className="h-8 ml-auto shrink-0" onClick={openDialog}>
        {t("bookingMenus.trialOpenSettings")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("bookingMenus.trialDialogTitle", { name: menu.name })}</DialogTitle>
            <DialogDescription>{t("bookingMenus.trialDialogDesc", { name: menu.name })}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold">{t("bookingMenus.trialEnabledLabel")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t(settings.trial_enabled ? "bookingMenus.trialEnabledOnHint" : "bookingMenus.trialEnabledOffHint")}
                </p>
              </div>
              <Switch
                checked={settings.trial_enabled}
                disabled={busy}
                onCheckedChange={setEnabled}
                aria-label={t("bookingMenus.trialEnabledLabel")}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("bookingMenus.trialLinkLabel")}</Label>
              <div className="rounded-xl bg-muted/40 border border-border px-3 py-2 font-mono text-[11px] break-all" data-testid="menu-trial-link">
                {link}
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => void copy()}>
                  <Copy className="w-4 h-4 mr-1" /> {t("bookingMenus.trialCopyLink")}
                </Button>
                <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => void openExternalUrl(link)}>
                  <ExternalLink className="w-4 h-4 mr-1" /> {t("bookingMenus.trialOpenLink")}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`menu-trial-price-${menu.id}`} className="text-xs font-bold">{t("bookingMenus.trialPriceLabel")}</Label>
              <Input
                id={`menu-trial-price-${menu.id}`}
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={t("bookingMenus.trialPricePlaceholder")}
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground">{t("bookingMenus.trialPriceHint")}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`menu-trial-title-${menu.id}`} className="text-xs font-bold">{t("bookingMenus.trialInfoTitleLabel")}</Label>
              <Input
                id={`menu-trial-title-${menu.id}`}
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`menu-trial-body-${menu.id}`} className="text-xs font-bold">{t("bookingMenus.trialInfoBodyLabel")}</Label>
              <Textarea
                id={`menu-trial-body-${menu.id}`}
                value={body}
                maxLength={BODY_MAX}
                rows={6}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground">{t("bookingMenus.trialInfoHint")}</p>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="w-full sm:w-auto">{t("common.cancel")}</Button>
            <Button onClick={() => void save()} disabled={busy} className="w-full sm:w-auto">{t("bookingMenus.trialSave")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TrainerMenuTrialSettings;
