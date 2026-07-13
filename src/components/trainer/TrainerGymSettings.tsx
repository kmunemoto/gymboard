import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Upload, Trash2, Image, User, Save, LogOut, Settings } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import InviteCodeCard from "./InviteCodeCard";
import TrialLinkCard from "./TrialLinkCard";
import TrainerPlanManager from "./TrainerPlanManager";
import TrainerBilling from "./TrainerBilling";
import DeleteAccountButton from "@/components/DeleteAccountButton";
import TrainerHelpGuide from "./TrainerHelpGuide";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeColorSwitcher from "@/components/ThemeColorSwitcher";
import BackgroundImagePicker from "@/components/BackgroundImagePicker";
import { resizeImageToJpeg } from "@/lib/imageResize";
import { useTranslation } from "react-i18next";
import { BILLING_ENABLED } from "@/lib/featureFlags";

interface TrainerGymSettingsProps {
  onSignOut: () => void;
}

const TrainerGymSettings = ({ onSignOut }: TrainerGymSettingsProps) => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const { user } = useAuth();
  const { profile } = useProfile();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingSameDayPenalty, setSavingSameDayPenalty] = useState(false);
  // 体験予約ページの案内カード（見出し＋説明文）のジム別カスタム文言。空欄=既定文言。
  const [trialInfoTitle, setTrialInfoTitle] = useState("");
  const [trialInfoBody, setTrialInfoBody] = useState("");
  const [savingTrialInfo, setSavingTrialInfo] = useState(false);

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile]);

  useEffect(() => {
    setTrialInfoTitle(tenant?.trial_info_title ?? "");
    setTrialInfoBody(tenant?.trial_info_body ?? "");
  }, [tenant?.trial_info_title, tenant?.trial_info_body]);

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

  const handleToggleSameDayPenalty = async (checked: boolean) => {
    if (!tenant) return;
    setSavingSameDayPenalty(true);
    const { error } = await supabase
      .from("tenants")
      .update({ same_day_cancel_penalty_enabled: checked })
      .eq("id", tenant.id);
    if (error) toast.error(t("settings.trainer.sameDayPenaltySaveFailed"));
    else {
      toast.success(t("settings.trainer.sameDayPenaltyUpdated"));
      refetchTenant();
    }
    setSavingSameDayPenalty(false);
  };

  const handleSaveTrialInfo = async () => {
    if (!tenant) return;
    setSavingTrialInfo(true);
    // 空欄は NULL として保存（公開ページ側で既定文言にフォールバックする）
    const title = trialInfoTitle.trim();
    const body = trialInfoBody.trim();
    const { error } = await supabase
      .from("tenants")
      .update({ trial_info_title: title || null, trial_info_body: body || null } as any)
      .eq("id", tenant.id);
    if (error) {
      // 失敗理由（例: カラム未追加＝マイグレーション未適用）を画面でも確認できるようにする
      console.error("体験予約ページ案内文の保存に失敗:", error);
      toast.error(t("settings.trainer.trialInfoSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.trialInfoSaved"));
      refetchTenant();
    }
    setSavingTrialInfo(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error(t("settings.trainer.selectImage")); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error(t("settings.trainer.fileTooLarge")); return; }
    if (!tenant) { toast.error(t("settings.trainer.tenantUnavailable")); return; }
    setUploading(true);
    try {
      // 表示は最大でも100px角程度のため、アップロード時に縮小・圧縮してから保存する。
      // (元画像をそのまま保存すると、体験予約サイト等の公開ページで毎回フルサイズを
      //  ダウンロードすることになり表示が遅くなる)
      const resized = await resizeImageToJpeg(file, 512, 0.9);
      const filePath = `${tenant.id}/logo_${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("gym-assets")
        .upload(filePath, resized, { upsert: true, contentType: "image/jpeg" });
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

      {/* === 体験予約リンク === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.trialLinkSection")}</h3>
        <TrialLinkCard />
      </section>

      <Separator />

      {/* === 体験予約ページの案内文 === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.trialPageSection")}</h3>
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground">{t("settings.trainer.trialInfoDesc")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="trial-info-title" className="text-xs font-bold">{t("settings.trainer.trialInfoTitleLabel")}</Label>
              <Input
                id="trial-info-title"
                value={trialInfoTitle}
                onChange={(e) => setTrialInfoTitle(e.target.value)}
                placeholder={t("trialBooking.infoTitle")}
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trial-info-body" className="text-xs font-bold">{t("settings.trainer.trialInfoBodyLabel")}</Label>
              <Textarea
                id="trial-info-body"
                value={trialInfoBody}
                onChange={(e) => setTrialInfoBody(e.target.value)}
                placeholder={t("trialBooking.infoBody")}
                rows={3}
                maxLength={300}
              />
            </div>
            <Button onClick={handleSaveTrialInfo} disabled={savingTrialInfo || !tenant} size="sm" className="h-10">
              <Save className="w-4 h-4 mr-1" />
              {savingTrialInfo ? t("common.saving") : t("common.save")}
            </Button>
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* === プラン管理 === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.planManage")}</h3>
        <TrainerPlanManager />
      </section>

      <Separator />

      {/* === 予約ポリシー === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.bookingPolicySection")}</h3>
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="font-bold text-sm">{t("settings.trainer.sameDayPenaltyTitle")}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.sameDayPenaltyDesc")}</p>
              </div>
              <Switch
                checked={!!tenant?.same_day_cancel_penalty_enabled}
                disabled={savingSameDayPenalty || !tenant}
                onCheckedChange={handleToggleSameDayPenalty}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* === プラン・お支払い（GymBoard SaaS）。課金無効化中は非表示 === */}
      {BILLING_ENABLED && (
        <>
          <section className="space-y-3">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.billingSection")}</h3>
            <TrainerBilling />
          </section>

          <Separator />
        </>
      )}

      {/* === 言語 / Language === */}
      <LanguageSwitcher variant="trainer" />

      {/* === テーマカラー / Theme color === */}
      <ThemeColorSwitcher variant="trainer" />

      {/* === 背景画像 / Background image === */}
      <BackgroundImagePicker variant="trainer" />

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