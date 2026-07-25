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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, Trash2, Image, User, Save, LogOut, Settings } from "lucide-react";
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
import {
  DASHBOARD_STAT_TOGGLES,
  DASHBOARD_SECTION_TOGGLES,
  NAV_TAB_TOGGLES,
  GYM_DISPLAY_PRESETS,
  detectPreset,
  presetToValues,
  type GymDisplayColumn,
  type GymDisplayPreset,
} from "@/lib/gymDisplaySettings";

interface TrainerGymSettingsProps {
  onSignOut: () => void;
}

// 営業時間・予約枠の間隔・予約バッファの選択肢。
// 開始/終了は30分刻み（開始7:00〜12:00、終了17:00〜23:00）。
const hourOption = (baseHour: number, i: number) => {
  const totalMin = baseHour * 60 + i * 30;
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
};
const BUSINESS_START_HOURS = Array.from({ length: 11 }, (_, i) => hourOption(7, i)); // 07:00〜12:00
const BUSINESS_END_HOURS = Array.from({ length: 13 }, (_, i) => hourOption(17, i)); // 17:00〜23:00
const BUSINESS_SLOT_OPTIONS = [30, 45, 60, 90, 120];
// 予約と予約の間に必ず空ける時間（分）。15分刻み。
const BUSINESS_BUFFER_OPTIONS = [0, 15, 30, 45, 60];

// 表示ON/OFFの項目定義は src/lib/gymDisplaySettings.ts に集約している
// （実際に表示を出し分ける TrainerSidebar / TrainerDashboard と同じ定義を参照し、
//  「設定にはあるが効かない」といったズレを防ぐ）。

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
  const [savingDailySummary, setSavingDailySummary] = useState(false);
  // 表示ON/OFFの各トグル。どれも同じ形の更新なので、保存中フラグは
  // 「どのカラムを保存中か」で共有する（トグルごとにstateを持たない）。
  const [savingStatKey, setSavingStatKey] = useState<string | null>(null);
  const [savingPreset, setSavingPreset] = useState<GymDisplayPreset | null>(null);
  // 体験予約ページの案内カード（見出し＋説明文）のジム別カスタム文言。空欄=既定文言。
  const [trialInfoTitle, setTrialInfoTitle] = useState("");
  const [trialInfoBody, setTrialInfoBody] = useState("");
  const [savingTrialInfo, setSavingTrialInfo] = useState(false);

  // 連絡先メールアドレス（tenants.email）。体験予約の確認メールでお客様への連絡先として案内される。
  const [contactEmail, setContactEmail] = useState("");
  const [savingContactEmail, setSavingContactEmail] = useState(false);

  // 電話番号（tenants.phone）。入力するとお客様側に「電話する」ボタン（tel: 発信）が表示される。
  const [contactPhone, setContactPhone] = useState("");
  const [savingContactPhone, setSavingContactPhone] = useState(false);

  // LINE連絡先URL（tenants.line_url）。入力するとお客様側に「LINEで連絡」ボタンが表示される。
  const [lineUrl, setLineUrl] = useState("");
  const [savingLineUrl, setSavingLineUrl] = useState(false);

  // Google口コミ投稿URL（tenants.google_review_url）。入力すると、来店が節目に達したお客様へ
  // 口コミ依頼バナーが表示されるようになる。
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [savingGoogleReviewUrl, setSavingGoogleReviewUrl] = useState(false);

  // 営業時間（tenants.operating_hours）・予約枠の間隔（tenants.slot_duration_minutes）・
  // 予約バッファ（tenants.booking_buffer_minutes）。
  // お客様の予約画面（CustomerBooking.tsx）・体験予約ページ・予約の重複判定に使われる。
  const [businessStart, setBusinessStart] = useState("10:00");
  const [businessEnd, setBusinessEnd] = useState("21:00");
  const [businessSlotMinutes, setBusinessSlotMinutes] = useState(60);
  const [businessBufferMinutes, setBusinessBufferMinutes] = useState(15);
  const [savingBusinessHours, setSavingBusinessHours] = useState(false);

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile]);

  useEffect(() => {
    setTrialInfoTitle(tenant?.trial_info_title ?? "");
    setTrialInfoBody(tenant?.trial_info_body ?? "");
  }, [tenant?.trial_info_title, tenant?.trial_info_body]);

  useEffect(() => {
    setContactEmail(tenant?.email ?? "");
  }, [tenant?.email]);

  useEffect(() => {
    setContactPhone(tenant?.phone ?? "");
  }, [tenant?.phone]);

  useEffect(() => {
    setLineUrl(tenant?.line_url ?? "");
  }, [tenant?.line_url]);

  useEffect(() => {
    setGoogleReviewUrl(tenant?.google_review_url ?? "");
  }, [tenant?.google_review_url]);

  useEffect(() => {
    if (tenant?.operating_hours?.start) setBusinessStart(tenant.operating_hours.start);
    if (tenant?.operating_hours?.end) setBusinessEnd(tenant.operating_hours.end);
    if (tenant?.slot_duration_minutes) setBusinessSlotMinutes(tenant.slot_duration_minutes);
    if (tenant?.booking_buffer_minutes != null) setBusinessBufferMinutes(tenant.booking_buffer_minutes);
  }, [tenant?.operating_hours?.start, tenant?.operating_hours?.end, tenant?.slot_duration_minutes, tenant?.booking_buffer_minutes]);

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

  // 表示ON/OFFはどの項目も「tenants の boolean 列を1つ更新して再取得」で同じ形なので、
  // 統計カード・ホームの各セクション・メニューの各タブを1つのハンドラで扱う。
  const handleToggleDisplay = async (column: GymDisplayColumn, checked: boolean) => {
    if (!tenant) return;
    setSavingStatKey(column);
    const { error } = await supabase
      .from("tenants")
      .update({ [column]: checked } as any)
      .eq("id", tenant.id);
    if (error) toast.error(t("settings.trainer.statVisibilitySaveFailed"));
    else {
      toast.success(t("settings.trainer.statVisibilityUpdated"));
      refetchTenant();
    }
    setSavingStatKey(null);
  };

  // 17項目を1つずつ切るのは現実的でないため、表示量をまとめて切り替えられるようにする。
  // 押したときだけ効く（既存ジムの表示が勝手に変わることはない）。
  const handleApplyPreset = async (preset: GymDisplayPreset) => {
    if (!tenant) return;
    setSavingPreset(preset);
    const { error } = await supabase
      .from("tenants")
      .update(presetToValues(preset) as any)
      .eq("id", tenant.id);
    if (error) toast.error(t("settings.trainer.statVisibilitySaveFailed"));
    else {
      toast.success(t("settings.trainer.statVisibilityUpdated"));
      refetchTenant();
    }
    setSavingPreset(null);
  };

  const handleToggleDailySummary = async (checked: boolean) => {
    if (!tenant) return;
    setSavingDailySummary(true);
    const { error } = await supabase
      .from("tenants")
      .update({ daily_summary_enabled: checked } as any)
      .eq("id", tenant.id);
    if (error) toast.error(t("settings.trainer.dailySummarySaveFailed"));
    else {
      toast.success(t("settings.trainer.dailySummaryUpdated"));
      refetchTenant();
    }
    setSavingDailySummary(false);
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

  const handleSaveContactEmail = async () => {
    if (!tenant) return;
    const email = contactEmail.trim();
    // 非空なら形式チェック。空欄は NULL で保存（確認メールは連絡先無しの案内にフォールバック）。
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t("settings.trainer.contactEmailInvalid"));
      return;
    }
    setSavingContactEmail(true);
    const { error } = await supabase
      .from("tenants")
      .update({ email: email || null })
      .eq("id", tenant.id);
    if (error) {
      console.error("連絡先メールの保存に失敗:", error);
      toast.error(t("settings.trainer.contactEmailSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.contactEmailUpdated"));
      refetchTenant();
    }
    setSavingContactEmail(false);
  };

  const handleSaveContactPhone = async () => {
    if (!tenant) return;
    const phone = contactPhone.trim();
    // 電話番号は国・表記のゆれが大きいので厳密チェックはせず、数字が全く無い場合だけ弾く。
    // 空欄は NULL で保存（「電話する」ボタンは非表示になる）。
    if (phone && !/[0-9０-９]/.test(phone)) {
      toast.error(t("settings.trainer.contactPhoneInvalid"));
      return;
    }
    setSavingContactPhone(true);
    const { error } = await supabase
      .from("tenants")
      .update({ phone: phone || null })
      .eq("id", tenant.id);
    if (error) {
      console.error("電話番号の保存に失敗:", error);
      toast.error(t("settings.trainer.contactPhoneSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.contactPhoneUpdated"));
      refetchTenant();
    }
    setSavingContactPhone(false);
  };

  const handleSaveLineUrl = async () => {
    if (!tenant) return;
    const url = lineUrl.trim();
    // 非空なら http(s) で始まる URL 形式だけ簡易チェック。空欄は NULL で保存（ボタン非表示）。
    if (url && !/^https?:\/\/.+/i.test(url)) {
      toast.error(t("settings.trainer.lineUrlInvalid"));
      return;
    }
    setSavingLineUrl(true);
    const { error } = await supabase
      .from("tenants")
      .update({ line_url: url || null })
      .eq("id", tenant.id);
    if (error) {
      console.error("LINE連絡先の保存に失敗:", error);
      toast.error(t("settings.trainer.lineUrlSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.lineUrlUpdated"));
      refetchTenant();
    }
    setSavingLineUrl(false);
  };

  const handleSaveGoogleReviewUrl = async () => {
    if (!tenant) return;
    const url = googleReviewUrl.trim();
    // 非空なら http(s) で始まる URL 形式だけ簡易チェック。空欄は NULL で保存（バナー非表示）。
    if (url && !/^https?:\/\/.+/i.test(url)) {
      toast.error(t("settings.trainer.googleReviewUrlInvalid"));
      return;
    }
    setSavingGoogleReviewUrl(true);
    const { error } = await supabase
      .from("tenants")
      .update({ google_review_url: url || null } as any)
      .eq("id", tenant.id);
    if (error) {
      console.error("Google口コミURLの保存に失敗:", error);
      toast.error(t("settings.trainer.googleReviewUrlSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.googleReviewUrlUpdated"));
      refetchTenant();
    }
    setSavingGoogleReviewUrl(false);
  };

  const handleSaveBusinessHours = async () => {
    if (!tenant) return;
    if (businessStart >= businessEnd) {
      toast.error(t("settings.trainer.businessHoursInvalidRange"));
      return;
    }
    setSavingBusinessHours(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        operating_hours: { start: businessStart, end: businessEnd },
        slot_duration_minutes: businessSlotMinutes,
        booking_buffer_minutes: businessBufferMinutes,
      })
      .eq("id", tenant.id);
    if (error) {
      console.error("営業時間の保存に失敗:", error);
      toast.error(t("settings.trainer.businessHoursSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.businessHoursUpdated"));
      refetchTenant();
    }
    setSavingBusinessHours(false);
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

      {/* === 招待コード（お客様の招待に日常的に使うため、カテゴリーにしまわず最上部に常時表示） === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.invite")}</h3>
        <InviteCodeCard />
      </section>

      {/* 設定項目が増えたため、カテゴリー別のアコーディオンに整理している。
          既定は全て閉じた状態で、探している分類だけ開いて使う。 */}
      <Accordion type="multiple" className="w-full">
        <AccordionItem value="gym-info">
          <AccordionTrigger className="text-sm font-bold">
            {t("settings.trainer.catGymInfo")}
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-1">
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

            {/* === 連絡先メールアドレス === */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.contactEmailSection")}</h3>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">{t("settings.trainer.contactEmailDesc")}</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-email" className="text-xs font-bold">{t("settings.trainer.contactEmailLabel")}</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder={t("settings.trainer.contactEmailPlaceholder")}
                      maxLength={255}
                    />
                  </div>
                  <Button onClick={handleSaveContactEmail} disabled={savingContactEmail || !tenant} size="sm" className="h-10">
                    <Save className="w-4 h-4 mr-1" />
                    {savingContactEmail ? t("common.saving") : t("common.save")}
                  </Button>
                </CardContent>
              </Card>
            </section>

            {/* === 電話番号 === */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.contactPhoneSection")}</h3>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">{t("settings.trainer.contactPhoneDesc")}</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-phone" className="text-xs font-bold">{t("settings.trainer.contactPhoneLabel")}</Label>
                    <Input
                      id="contact-phone"
                      type="tel"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder={t("settings.trainer.contactPhonePlaceholder")}
                      maxLength={30}
                    />
                  </div>
                  <Button onClick={handleSaveContactPhone} disabled={savingContactPhone || !tenant} size="sm" className="h-10">
                    <Save className="w-4 h-4 mr-1" />
                    {savingContactPhone ? t("common.saving") : t("common.save")}
                  </Button>
                </CardContent>
              </Card>
            </section>

            {/* === LINE連絡先 === */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.lineUrlSection")}</h3>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">{t("settings.trainer.lineUrlDesc")}</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="line-url" className="text-xs font-bold">{t("settings.trainer.lineUrlLabel")}</Label>
                    <Input
                      id="line-url"
                      type="url"
                      inputMode="url"
                      value={lineUrl}
                      onChange={(e) => setLineUrl(e.target.value)}
                      placeholder={t("settings.trainer.lineUrlPlaceholder")}
                      maxLength={255}
                    />
                  </div>
                  <Button onClick={handleSaveLineUrl} disabled={savingLineUrl || !tenant} size="sm" className="h-10">
                    <Save className="w-4 h-4 mr-1" />
                    {savingLineUrl ? t("common.saving") : t("common.save")}
                  </Button>
                </CardContent>
              </Card>
            </section>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="booking">
          <AccordionTrigger className="text-sm font-bold">
            {t("settings.trainer.catBooking")}
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-1">
            {/* === 営業時間 === */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.businessHoursSection")}</h3>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">{t("settings.trainer.businessHoursDesc")}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold">{t("settings.trainer.businessHoursStart")}</Label>
                      <Select value={businessStart} onValueChange={setBusinessStart}>
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BUSINESS_START_HOURS.map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold">{t("settings.trainer.businessHoursEnd")}</Label>
                      <Select value={businessEnd} onValueChange={setBusinessEnd}>
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BUSINESS_END_HOURS.map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">{t("settings.trainer.businessHoursSlotDuration")}</Label>
                    <Select value={String(businessSlotMinutes)} onValueChange={(v) => setBusinessSlotMinutes(parseInt(v, 10))}>
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BUSINESS_SLOT_OPTIONS.map((m) => (
                          <SelectItem key={m} value={String(m)}>{t("onboarding.slotMinutes", { n: m })}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">{t("settings.trainer.businessHoursBuffer")}</Label>
                    <p className="text-xs text-muted-foreground">{t("settings.trainer.businessHoursBufferDesc")}</p>
                    <Select value={String(businessBufferMinutes)} onValueChange={(v) => setBusinessBufferMinutes(parseInt(v, 10))}>
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BUSINESS_BUFFER_OPTIONS.map((m) => (
                          <SelectItem key={m} value={String(m)}>{t("onboarding.slotMinutes", { n: m })}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleSaveBusinessHours} disabled={savingBusinessHours || !tenant} size="sm" className="h-10">
                    <Save className="w-4 h-4 mr-1" />
                    {savingBusinessHours ? t("common.saving") : t("common.save")}
                  </Button>
                </CardContent>
              </Card>
            </section>

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

            {/* === プラン管理 === */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.planManage")}</h3>
              <TrainerPlanManager />
            </section>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="growth">
          <AccordionTrigger className="text-sm font-bold">
            {t("settings.trainer.catGrowth")}
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-1">
            {/* === 体験予約リンク === */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.trialLinkSection")}</h3>
              <TrialLinkCard />
            </section>

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

            {/* === Google口コミ依頼 === */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.googleReviewSection")}</h3>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">{t("settings.trainer.googleReviewDesc")}</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="google-review-url" className="text-xs font-bold">{t("settings.trainer.googleReviewUrlLabel")}</Label>
                    <Input
                      id="google-review-url"
                      type="url"
                      inputMode="url"
                      value={googleReviewUrl}
                      onChange={(e) => setGoogleReviewUrl(e.target.value)}
                      placeholder={t("settings.trainer.googleReviewUrlPlaceholder")}
                      maxLength={500}
                    />
                  </div>
                  <Button onClick={handleSaveGoogleReviewUrl} disabled={savingGoogleReviewUrl || !tenant} size="sm" className="h-10">
                    <Save className="w-4 h-4 mr-1" />
                    {savingGoogleReviewUrl ? t("common.saving") : t("common.save")}
                  </Button>
                </CardContent>
              </Card>
            </section>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="appearance">
          <AccordionTrigger className="text-sm font-bold">
            {t("settings.trainer.catAppearance")}
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-1">
            {/* === 表示設定（ホーム画面の各パーツ・メニューの各タブをジムごとにON/OFF） === */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.displaySection")}</h3>

              {/* 表示量のプリセット。17項目を1つずつ切るのは現実的でないため、
                  まとめて切り替える手段を上に置く。押したときだけ反映される。 */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <h4 className="font-bold text-sm">{t("settings.trainer.displayPresetGroup")}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.displayPresetDesc")}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {GYM_DISPLAY_PRESETS.map((preset) => {
                      const active = detectPreset(tenant) === preset;
                      return (
                        <Button
                          key={preset}
                          type="button"
                          variant={active ? "default" : "outline"}
                          size="sm"
                          disabled={!tenant || savingPreset !== null}
                          onClick={() => handleApplyPreset(preset)}
                          className="h-auto py-2 flex flex-col gap-0.5"
                        >
                          <span className="text-xs font-bold">{t(`settings.trainer.displayPreset.${preset}`)}</span>
                          <span className="text-[10px] font-normal opacity-70 leading-tight">
                            {t(`settings.trainer.displayPresetHint.${preset}`)}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                  {detectPreset(tenant) === null && (
                    <p className="text-[11px] text-muted-foreground">{t("settings.trainer.displayPresetCustom")}</p>
                  )}
                </CardContent>
              </Card>

              {/* ホーム画面：上部の統計カード */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <h4 className="font-bold text-sm">{t("settings.trainer.displayStatsGroup")}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.statVisibilityDesc")}</p>
                  </div>
                  {DASHBOARD_STAT_TOGGLES.map(({ column, labelKey }) => (
                    <div key={column} className="flex items-center justify-between gap-3">
                      <span className="text-sm">{t(labelKey)}</span>
                      <Switch
                        checked={tenant?.[column] !== false}
                        disabled={savingStatKey === column || !tenant}
                        onCheckedChange={(checked) => handleToggleDisplay(column, checked)}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* ホーム画面：各セクション */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <h4 className="font-bold text-sm">{t("settings.trainer.displaySectionsGroup")}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.displaySectionsDesc")}</p>
                  </div>
                  {DASHBOARD_SECTION_TOGGLES.map(({ column, labelKey }) => (
                    <div key={column} className="flex items-center justify-between gap-3">
                      <span className="text-sm">{t(labelKey)}</span>
                      <Switch
                        checked={tenant?.[column] !== false}
                        disabled={savingStatKey === column || !tenant}
                        onCheckedChange={(checked) => handleToggleDisplay(column, checked)}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* メニュー（サイドバー / 下部ナビ）の各タブ */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <h4 className="font-bold text-sm">{t("settings.trainer.displayNavGroup")}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.displayNavDesc")}</p>
                  </div>
                  {NAV_TAB_TOGGLES.map(({ column, labelKey }) => (
                    <div key={column} className="flex items-center justify-between gap-3">
                      <span className="text-sm">{t(labelKey)}</span>
                      <Switch
                        checked={tenant?.[column] !== false}
                        disabled={savingStatKey === column || !tenant}
                        onCheckedChange={(checked) => handleToggleDisplay(column, checked)}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            {/* === テーマカラー / Theme color === */}
            <ThemeColorSwitcher variant="trainer" />

            {/* === 背景画像 / Background image === */}
            <BackgroundImagePicker variant="trainer" />

            {/* === 言語 / Language === */}
            <LanguageSwitcher variant="trainer" />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="notifications">
          <AccordionTrigger className="text-sm font-bold">
            {t("settings.trainer.catNotifications")}
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-1">
            {/* === 朝のサマリー通知 === */}
            <section className="space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.dailySummarySection")}</h3>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-sm">{t("settings.trainer.dailySummaryTitle")}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.dailySummaryDesc")}</p>
                    </div>
                    <Switch
                      checked={tenant?.daily_summary_enabled !== false}
                      disabled={savingDailySummary || !tenant}
                      onCheckedChange={handleToggleDailySummary}
                    />
                  </div>
                </CardContent>
              </Card>
            </section>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="account">
          <AccordionTrigger className="text-sm font-bold">
            {t("settings.trainer.catAccount")}
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-1">
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

            {/* === プラン・お支払い（GymBoard SaaS）。課金無効化中は非表示 === */}
            {BILLING_ENABLED && (
              <>
                <section className="space-y-3">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.billingSection")}</h3>
                  <TrainerBilling />
                </section>

              </>
            )}

            {/* === 使い方ガイド === */}
            <section className="space-y-3">
              <TrainerHelpGuide />
            </section>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* === ログアウト・アカウント削除（いつでも押せるようアコーディオンの外に出す） === */}
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