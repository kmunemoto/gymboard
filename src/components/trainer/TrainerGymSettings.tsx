import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, Trash2, Image, User, Save, LogOut, MessageCircle, CheckCircle2, Unlink, Calendar, RefreshCw, Settings } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import InviteCodeCard from "./InviteCodeCard";
import TrainerPlanManager from "./TrainerPlanManager";
import TrainerBilling from "./TrainerBilling";
import DeleteAccountButton from "@/components/DeleteAccountButton";
import TrainerHelpGuide from "./TrainerHelpGuide";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeColorSwitcher from "@/components/ThemeColorSwitcher";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { useTranslation } from "react-i18next";
import { GOOGLE_CALENDAR_ENABLED } from "@/lib/featureFlags";

interface TrainerGymSettingsProps {
  onSignOut: () => void;
}

const TrainerGymSettings = ({ onSignOut }: TrainerGymSettingsProps) => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const { user } = useAuth();
  const { profile, loading: profileLoading, refetch: refetchProfile } = useProfile();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);




  const isLineLinked = !!profile?.line_user_id;

  // Google Calendar state
  const [gcalLinked, setGcalLinked] = useState(false);
  const [gcalLoading, setGcalLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile]);

  const checkGcalStatus = async () => {
    if (!user) return;
    setGcalLoading(true);
    const { data } = await supabase
      .from("google_calendar_tokens" as any)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    setGcalLinked(!!data);
    setGcalLoading(false);
  };

  useEffect(() => {
    checkGcalStatus();
  }, [user]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "line-link-result") {
        if (e.data.success) {
          toast.success(t("settings.line.linkSuccess"));
          refetchProfile();
        } else {
          toast.error(t("settings.line.linkFailed"));
        }
      }
      if (e.data?.type === "google-calendar-result") {
        if (e.data.success) {
          toast.success(t("settings.gcal.linkSuccess"));
          setGcalLinked(true);
        } else {
          toast.error(t("settings.gcal.linkFailed"));
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [refetchProfile, t]);

  // --- Handlers ---
  const handleSaveName = async () => {
    if (!user || !displayName.trim()) return;
    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() })
      .eq("user_id", user.id);
    if (error) toast.error(t("settings.trainer.saveFailed"));
    else toast.success(t("settings.trainer.displayNameUpdated"));
    setSavingName(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error(t("settings.trainer.selectImage")); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error(t("settings.trainer.fileTooLarge")); return; }
    if (!tenant) { toast.error(t("settings.trainer.tenantUnavailable")); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const filePath = `${tenant.id}/logo_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("gym-assets").upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("gym-assets").getPublicUrl(filePath);
      const url = `${urlData.publicUrl}?t=${Date.now()}`;
      const { error: updateError } = await supabase.from("tenants").update({ logo_url: url }).eq("id", tenant.id);
      if (updateError) throw updateError;
      toast.success(t("settings.trainer.logoUpdated"));
      refetchTenant();
    } catch (err) {
      toast.error(err.message || t("settings.trainer.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    if (!tenant) { toast.error(t("settings.trainer.tenantUnavailable")); return; }
    setUploading(true);
    try {
      const folder = tenant.id;
      const { data: files } = await supabase.storage.from("gym-assets").list(folder);
      if (files && files.length > 0) {
        const logoFiles = files.filter((f) => f.name.startsWith("logo"));
        if (logoFiles.length > 0) await supabase.storage.from("gym-assets").remove(logoFiles.map((f) => `${folder}/${f.name}`));
      }
      const { error: updateError } = await supabase.from("tenants").update({ logo_url: null }).eq("id", tenant.id);
      if (updateError) throw updateError;
      toast.success(t("settings.trainer.logoDeleted"));
      refetchTenant();
    } catch (err) {
      toast.error(err.message || t("settings.trainer.deleteFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleLineLink = async () => {
    if (!user) return;
    const { data, error } = await supabase.functions.invoke("line-auth-url", { body: {} });
    if (error || !data?.url) {
      toast.error(t("settings.line.startFailed"));
      return;
    }
    window.open(data.url, "line-link", "width=500,height=700");
  };


  const handleLineUnlink = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ line_user_id: null }).eq("user_id", user.id);
    if (error) toast.error(t("settings.line.unlinkFailed"));
    else { toast.success(t("settings.line.unlinked")); refetchProfile(); }
  };

  const handleGcalLink = async () => {
    if (!user) return;
    const popup = window.open("about:blank", "gcal-link", "width=500,height=700");
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-auth-url", { body: { user_id: user.id } });
      if (error || !data?.url) { popup?.close(); toast.error(t("settings.gcal.authUrlFailed")); return; }
      if (popup) popup.location.href = data.url;
      else window.location.href = data.url;
    } catch (e) { popup?.close(); toast.error(t("common.errorGeneric")); }
  };

  const handleGcalUnlink = async () => {
    if (!user) return;
    const { error } = await supabase.from("google_calendar_tokens" as any).delete().eq("user_id", user.id);
    if (error) toast.error(t("settings.gcal.unlinkFailed"));
    else { toast.success(t("settings.gcal.unlinked")); setGcalLinked(false); }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-sync", { body: { action: "sync_all" } });
      if (error) throw error;
      toast.success(t("settings.gcal.syncDone", { count: data?.synced || 0 }));
    } catch (e) { toast.error(t("settings.gcal.syncFailed")); }
    setSyncing(false);
  };




  return (
    <div className="space-y-6 pb-24 md:pb-0 max-w-lg">
      <h2 className="text-lg sm:text-xl font-black flex items-center gap-2">
        <Settings className="w-5 h-5 text-accent" />
        {t("settings.trainer.title")}
      </h2>

      {/* === 招待コード === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.invite")}</h3>
        <InviteCodeCard />
      </section>

      <Separator />

      {/* === プラン管理 === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.planManage")}</h3>
        <TrainerPlanManager />
      </section>

      <Separator />

      {/* === プラン・お支払い（GymBoard SaaS） === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.billingSection")}</h3>
        <TrainerBilling />
      </section>

      <Separator />

      {/* === 言語 / Language === */}
      <LanguageSwitcher variant="trainer" />

      {/* === テーマカラー / Theme color === */}
      <ThemeColorSwitcher variant="trainer" />

      <Separator />

      {/* === プロフィール === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.profileSection")}</h3>

        {/* トレーナー表示名 */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h3 className="font-bold text-sm">{t("settings.trainer.displayName")}</h3>
                <p className="text-xs text-muted-foreground">{t("settings.trainer.displayNameDesc")}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("settings.trainer.displayNamePlaceholder")} className="flex-1" />
              <Button onClick={handleSaveName} disabled={savingName || !displayName.trim()} size="sm" className="h-10">
                <Save className="w-4 h-4 mr-1" />
                {savingName ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ロゴ画像 */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                <Image className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h3 className="font-bold text-sm">{t("settings.trainer.logo")}</h3>
                <p className="text-xs text-muted-foreground">{t("settings.trainer.logoDesc")}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/30 shrink-0">
                {tenant?.logo_url ? (
                  <img src={tenant.logo_url} alt={t("settings.trainer.logoAlt")} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">{t("common.notSet")}</span>
                )}
              </div>
              <div className="flex gap-2 flex-1">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} size="sm" className="flex-1">
                  <Upload className="w-4 h-4 mr-1" />
                  {uploading ? t("common.processing") : tenant?.logo_url ? t("settings.trainer.change") : t("settings.trainer.upload")}
                </Button>
                {tenant?.logo_url && (
                  <Button variant="destructive" onClick={handleDelete} disabled={uploading} size="sm">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* Googleカレンダー連携セクション。表示可否は featureFlags.ts で一元管理。 */}
      {GOOGLE_CALENDAR_ENABLED && (
        <section className="space-y-3">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.external")}</h3>

          {/* Googleカレンダー */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Calendar className="w-4 h-4 text-blue-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm mb-0.5">{t("settings.gcal.section")}</h3>
                  <p className="text-xs text-muted-foreground mb-2">{t("settings.gcal.trainerDescription")}</p>
                  {gcalLoading ? (
                    <DumbbellLoader className="w-4 h-4 text-muted-foreground" />
                  ) : gcalLinked ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-blue-500">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {t("settings.gcal.linkedShort")}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={handleSyncAll} disabled={syncing}>
                          {syncing ? <DumbbellLoader className="w-3.5 h-3.5 mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                          {t("settings.gcal.syncAllShort")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleGcalUnlink}>
                          <Unlink className="w-3.5 h-3.5 mr-1" /> {t("settings.gcal.unlinkShort")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" onClick={handleGcalLink} className="bg-blue-500 hover:bg-blue-600 text-white">
                      <Calendar className="w-4 h-4 mr-1" /> {t("settings.gcal.linkShort")}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* LINE */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#06C755]/10 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-4 h-4 text-[#06C755]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm mb-0.5">{t("settings.line.section")}</h3>
                  <p className="text-xs text-muted-foreground mb-2">{t("settings.line.trainerShortDescription")}</p>
                  {isLineLinked ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#06C755]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {t("settings.gcal.linkedShort")}
                      </div>
                      <Button size="sm" variant="outline" onClick={handleLineUnlink}>
                        <Unlink className="w-3.5 h-3.5 mr-1" /> {t("settings.gcal.unlinkShort")}
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" onClick={handleLineLink} className="bg-[#06C755] hover:bg-[#05b34c] text-white">
                      <MessageCircle className="w-4 h-4 mr-1" /> {t("settings.gcal.linkShort")}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* === 使い方ガイド === */}
      <section className="space-y-3">
        <TrainerHelpGuide />
      </section>

      {/* === ログアウト === */}
      <section className="space-y-3">
        <Button
          variant="outline"
          className="w-full h-12 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive font-bold"
          onClick={onSignOut}
        >
          <LogOut className="w-4 h-4 mr-2" />
          {t("settings.logout")}
        </Button>
        <DeleteAccountButton />
      </section>
    </div>
  );
};

export default TrainerGymSettings;