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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, Trash2, Image, User, Save, LogOut, Settings, CalendarOff } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import InviteCodeCard from "./InviteCodeCard";
import TrainerStaffManager from "./TrainerStaffManager";
import TrialLinkCard from "./TrialLinkCard";
import TrainerPlanManager from "./TrainerPlanManager";
import TrainerBilling from "./TrainerBilling";
import DeleteAccountButton from "@/components/DeleteAccountButton";
import GymOwnershipActions from "@/components/trainer/GymOwnershipActions";
import OperatorFeedback from "@/components/trainer/OperatorFeedback";
import TrainerHelpGuide from "./TrainerHelpGuide";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeColorSwitcher from "@/components/ThemeColorSwitcher";
import BackgroundImagePicker from "@/components/BackgroundImagePicker";
import { resizeImageToJpeg } from "@/lib/imageResize";
import { useTranslation } from "react-i18next";
import { BILLING_ENABLED, GOOGLE_REVIEW_ENABLED, LANGUAGE_SWITCHER_ENABLED, TRIAL_BOOKING_ENABLED } from "@/lib/featureFlags";
import { envelopeFromDays, minutesToTime, parseTimeToMinutes, type DayHours } from "@/lib/businessHours";
import {
  BOOKING_WINDOW_OPTIONS,
  normalizeBookingWindowDays,
} from "@/lib/bookingWindow";
import { EMAIL_NOTE_MAX_LENGTH, normalizeEmailNote } from "@/lib/emailNotes";
import TrainerStaffSchedule from "./TrainerStaffSchedule";
import TrainerBookingQuestions from "./TrainerBookingQuestions";
import { formatWeekdayShort } from "@/lib/dateFormat";
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
// 🔴 開店・閉店とも**1日の全域**から選べる（30分刻み）。
//
// 2026-08-20 まで開店 07:00〜12:00 / 閉店 17:00〜23:00 に絞っていたが、
// 「選べる時間の範囲が狭い」と実店舗から指摘された。早朝のパーソナル、
// 深夜まで開ける店、24時間営業のジムはどれも珍しくないので、絞る理由が無い。
//
//   開店 … 00:00〜23:30（48個）
//   閉店 … 00:30〜24:00（48個）。**最後の 24:00 は「その日いっぱい」**で、
//          24時間営業（00:00〜24:00）を表せるようにするためにある。
//
// 「終了は開始より後」の検査は残してある（深夜またぎの営業には未対応）。
const BUSINESS_START_HOURS = Array.from({ length: 48 }, (_, i) => hourOption(0, i));
const BUSINESS_END_HOURS = Array.from({ length: 48 }, (_, i) => hourOption(0, i + 1));
const BUSINESS_SLOT_OPTIONS = [30, 45, 60, 90, 120];
// 予約と予約の間に必ず空ける時間（分）。15分刻み。
const BUSINESS_BUFFER_OPTIONS = [0, 15, 30, 45, 60];
// 同じ時間帯に受けられる予約の数（ベッド数・施術者数など）。1＝従来どおり同時1件のみ。
const BUSINESS_CAPACITY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];
// 曜日別も全曜日共通と同じ選択肢を使う（開店 00:00〜23:30 / 閉店 00:30〜24:00）。
// 別々の配列にしていると、片方だけ広げたときに「共通では選べるのに曜日別では選べない」
// というズレが静かに入る。
const DAY_START_OPTIONS = BUSINESS_START_HOURS;
const DAY_END_OPTIONS = BUSINESS_END_HOURS;
// 週の表示順（月曜始まり。日本のビジネス慣習に合わせる）。値は JS の getDay() と同じ。
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

// 表示ON/OFFの項目定義は src/lib/gymDisplaySettings.ts に集約している
// （実際に表示を出し分ける TrainerSidebar / TrainerDashboard と同じ定義を参照し、
//  「設定にはあるが効かない」といったズレを防ぐ）。

const TrainerGymSettings = ({ onSignOut }: TrainerGymSettingsProps) => {
  const { t } = useTranslation();
  const { tenant, role, refetch: refetchTenant } = useTenant();
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
  // 体験の料金。入力は文字列で持つ。**空欄("")と "0" を区別する**ため
  // （空欄=料金を表示しない / 0="¥0" と明示）、number にはしない。
  const [trialPrice, setTrialPrice] = useState("");
  const [savingTrialPrice, setSavingTrialPrice] = useState(false);
  const [cancelPolicy, setCancelPolicy] = useState("");
  const [savingCancelPolicy, setSavingCancelPolicy] = useState(false);

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
  const [businessCapacity, setBusinessCapacity] = useState(1);
  const [savingBusinessHours, setSavingBusinessHours] = useState(false);
  // 曜日別の営業時間・定休日。
  // `perDayEnabled = false` なら全曜日共通（従来どおり）で、保存時に `days` を書かない。
  const [perDayEnabled, setPerDayEnabled] = useState(false);
  // 曜日 → { start, end } または null（定休日）。
  const [dayHours, setDayHours] = useState<Record<number, DayHours | null>>({});
  // 何日先まで受け付けるか。"" は未設定（画面ごとの従来の上限に従う）。
  const [bookingWindow, setBookingWindow] = useState("");
  // 予約確認メール／リマインドメールに足す、店からの案内。
  const [bookingEmailNote, setBookingEmailNote] = useState("");
  const [reminderEmailNote, setReminderEmailNote] = useState("");
  const [savingEmailNotes, setSavingEmailNotes] = useState(false);

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile]);

  useEffect(() => {
    setTrialInfoTitle(tenant?.trial_info_title ?? "");
    setTrialInfoBody(tenant?.trial_info_body ?? "");
  }, [tenant?.trial_info_title, tenant?.trial_info_body]);

  useEffect(() => {
    // null/undefined → 空欄。0 は "0" になる（"" にしないこと）。
    setTrialPrice(tenant?.trial_price_yen == null ? "" : String(tenant.trial_price_yen));
  }, [tenant?.trial_price_yen]);

  useEffect(() => {
    setCancelPolicy(tenant?.cancel_policy_body ?? "");
  }, [tenant?.cancel_policy_body]);

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
    // 曜日別を「今まで通り」から始めるときの初期値。全曜日共通の値を敷く。
    const fallbackDay: DayHours = {
      start: tenant?.operating_hours?.start ?? "10:00",
      end: tenant?.operating_hours?.end ?? "21:00",
    };
    if (tenant?.operating_hours?.start) setBusinessStart(tenant.operating_hours.start);
    if (tenant?.operating_hours?.end) setBusinessEnd(tenant.operating_hours.end);
    // 曜日別。キーが1つでもあれば「曜日別を使っている」とみなす。
    const days = tenant?.operating_hours?.days;
    if (days && typeof days === "object" && Object.keys(days).length > 0) {
      const next: Record<number, DayHours | null> = {};
      for (const d of WEEKDAY_ORDER) {
        const entry = days[String(d)];
        next[d] = entry === null || entry === undefined
          ? (Object.prototype.hasOwnProperty.call(days, String(d)) ? null : { ...fallbackDay })
          : { start: entry.start ?? fallbackDay.start, end: entry.end ?? fallbackDay.end };
      }
      setDayHours(next);
      setPerDayEnabled(true);
    } else {
      setPerDayEnabled(false);
      setDayHours({});
    }
    if (tenant?.slot_duration_minutes) setBusinessSlotMinutes(tenant.slot_duration_minutes);
    if (tenant?.booking_buffer_minutes != null) setBusinessBufferMinutes(tenant.booking_buffer_minutes);
    if (tenant?.booking_capacity != null) setBusinessCapacity(tenant.booking_capacity);
  }, [tenant?.operating_hours, tenant?.slot_duration_minutes, tenant?.booking_buffer_minutes, tenant?.booking_capacity]);

  useEffect(() => {
    setBookingWindow(tenant?.booking_window_days == null ? "" : String(tenant.booking_window_days));
  }, [tenant?.booking_window_days]);

  useEffect(() => {
    setBookingEmailNote(tenant?.booking_email_note ?? "");
    setReminderEmailNote(tenant?.reminder_email_note ?? "");
  }, [tenant?.booking_email_note, tenant?.reminder_email_note]);

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

  const handleSaveTrialPrice = async () => {
    if (!tenant) return;
    const raw = trialPrice.trim();
    // 空欄 = 料金を表示しない（NULL）。"0" は「¥0 と明示する」なので NULL に倒さない。
    let value: number | null = null;
    if (raw !== "") {
      if (!/^\d+$/.test(raw)) {
        toast.error(t("settings.trainer.trialPriceInvalid"));
        return;
      }
      value = Number(raw);
      // DB 側の CHECK (0〜1000000) と同じ範囲。ここで弾いて分かりにくい 23514 を出さない。
      if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) {
        toast.error(t("settings.trainer.trialPriceInvalid"));
        return;
      }
    }
    setSavingTrialPrice(true);
    const { error } = await supabase
      .from("tenants")
      .update({ trial_price_yen: value } as any)
      .eq("id", tenant.id);
    if (error) {
      // 失敗理由（例: カラム未追加＝マイグレーション未適用）を画面でも確認できるようにする
      console.error("体験料金の保存に失敗:", error);
      toast.error(t("settings.trainer.trialPriceSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.trialPriceSaved"));
      refetchTenant();
    }
    setSavingTrialPrice(false);
  };

  const handleSaveCancelPolicy = async () => {
    if (!tenant) return;
    setSavingCancelPolicy(true);
    // 空欄は NULL。**既定文にフォールバックしない**（何も表示しない）。
    const body = cancelPolicy.trim();
    const { error } = await supabase
      .from("tenants")
      .update({ cancel_policy_body: body || null } as any)
      .eq("id", tenant.id);
    if (error) {
      console.error("キャンセルポリシーの保存に失敗:", error);
      toast.error(t("settings.trainer.cancelPolicySaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.cancelPolicySaved"));
      refetchTenant();
    }
    setSavingCancelPolicy(false);
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

  const handleSaveEmailNotes = async () => {
    if (!tenant) return;
    setSavingEmailNotes(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        // 空欄は NULL で保存する（ブロックごと出さない）。既定文は持たせない。
        booking_email_note: normalizeEmailNote(bookingEmailNote),
        reminder_email_note: normalizeEmailNote(reminderEmailNote),
      } as never)
      .eq("id", tenant.id);
    if (error) {
      console.error("メール文言の保存に失敗:", error);
      toast.error(t("settings.trainer.emailNoteSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.emailNoteUpdated"));
      refetchTenant();
    }
    setSavingEmailNotes(false);
  };

  const handleSaveBusinessHours = async () => {
    if (!tenant) return;

    // 曜日別を使わない店（従来どおり）は、今までと1バイトも変わらない形で保存する。
    let operatingHours: { start: string; end: string; days?: Record<string, DayHours | null> };
    if (!perDayEnabled) {
      if (businessStart >= businessEnd) {
        toast.error(t("settings.trainer.businessHoursInvalidRange"));
        return;
      }
      operatingHours = { start: businessStart, end: businessEnd };
    } else {
      const days: Record<string, DayHours | null> = {};
      let openDays = 0;
      for (const d of WEEKDAY_ORDER) {
        const entry = dayHours[d];
        if (entry === null || entry === undefined) {
          days[String(d)] = null; // 定休日
          continue;
        }
        const open = parseTimeToMinutes(entry.start);
        const close = parseTimeToMinutes(entry.end);
        if (open === null || close === null || close <= open) {
          toast.error(t("settings.trainer.businessDaysInvalidRange", { day: formatWeekdayShort(d) }));
          return;
        }
        days[String(d)] = { start: entry.start, end: entry.end };
        openDays++;
      }
      if (openDays === 0) {
        // 全曜日が定休日だと、その店は永久に予約を受けられない。設定ミスとして止める。
        toast.error(t("settings.trainer.businessDaysAllClosed"));
        return;
      }
      // 🔴 start/end には包絡線を入れる。`days` を知らない古いアプリ版が端末に残るため、
      //    ここを狭めると、その版から取れるはずの枠が消える（businessHours.ts の設計メモ）。
      const envelope = envelopeFromDays(days);
      operatingHours = { ...envelope, days };
      setBusinessStart(envelope.start);
      setBusinessEnd(envelope.end);
    }

    setSavingBusinessHours(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        operating_hours: operatingHours,
        slot_duration_minutes: businessSlotMinutes,
        booking_buffer_minutes: businessBufferMinutes,
        booking_capacity: businessCapacity,
        // "" は未設定＝NULL。normalize が範囲外を弾く。
        booking_window_days: normalizeBookingWindowDays(Number(bookingWindow)),
      } as never)
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

      {/* === 招待コード === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.invite")}</h3>
        <InviteCodeCard />
      </section>

      <Separator />

      {/* === スタッフ管理（オーナーのみ。オーナー以外には何も描画されない） === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("staff.sectionTitle")}</h3>
        <TrainerStaffManager />
      </section>

      {TRIAL_BOOKING_ENABLED && (
        <>
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

          {/* === 体験の料金 ===
              ジムごとの設定。**コードに金額を書かない**（本番には14テナントいて、
              無料体験で集客しているジムもある）。空欄なら料金を出さない＝従来の見た目。 */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.trialPriceSection")}</h3>
            <Card>
              <CardContent className="p-4 space-y-3">
                <p className="text-xs text-muted-foreground">{t("settings.trainer.trialPriceDesc")}</p>
                <div className="space-y-1.5">
                  <Label htmlFor="trial-price" className="text-xs font-bold">{t("settings.trainer.trialPriceLabel")}</Label>
                  <Input
                    id="trial-price"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={1000000}
                    step={100}
                    value={trialPrice}
                    onChange={(e) => setTrialPrice(e.target.value)}
                    placeholder={t("settings.trainer.trialPricePlaceholder")}
                  />
                  {trialPrice.trim() === "" && (
                    <p className="text-[11px] text-muted-foreground">{t("settings.trainer.trialPriceUnset")}</p>
                  )}
                </div>
                <Button onClick={handleSaveTrialPrice} disabled={savingTrialPrice || !tenant} size="sm" className="h-10">
                  <Save className="w-4 h-4 mr-1" />
                  {savingTrialPrice ? t("common.saving") : t("common.save")}
                </Button>
              </CardContent>
            </Card>
          </section>
        </>
      )}

      <Separator />

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

      <Separator />

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

      <Separator />

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

      {/* 柔道整復師法24条など、業種によっては口コミ依頼が広告規制に触れうるため
          フラグで無効化できるようにしてある（src/lib/featureFlags.ts）。 */}
      {GOOGLE_REVIEW_ENABLED && (
        <>
          <Separator />

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
        </>
      )}

      <Separator />

      {/* === プラン管理 === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.planManage")}</h3>
        <TrainerPlanManager />
      </section>

      <Separator />

      {/* === 営業時間 === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("settings.trainer.businessHoursSection")}</h3>
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground">{t("settings.trainer.businessHoursDesc")}</p>
            {/* 曜日別の営業時間を使うか。OFF なら従来どおり全曜日共通（保存内容も従来と同じ）。 */}
            <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/30 p-3">
              <div className="flex-1">
                <Label className="text-sm font-bold flex items-center gap-1.5">
                  <CalendarOff className="w-3.5 h-3.5" />
                  {t("settings.trainer.businessDaysTitle")}
                </Label>
                <p className="text-xs text-muted-foreground mt-1">{t("settings.trainer.businessDaysDesc")}</p>
              </div>
              <Switch
                checked={perDayEnabled}
                onCheckedChange={(on) => {
                  setPerDayEnabled(on);
                  if (on && Object.keys(dayHours).length === 0) {
                    // 全曜日を「今の共通の時間」で埋めてから編集させる。
                    const seeded: Record<number, DayHours | null> = {};
                    for (const d of WEEKDAY_ORDER) seeded[d] = { start: businessStart, end: businessEnd };
                    setDayHours(seeded);
                  }
                }}
              />
            </div>

            {perDayEnabled ? (
              <div className="space-y-2">
                {WEEKDAY_ORDER.map((d) => {
                  const entry = dayHours[d] ?? null;
                  const closed = entry === null;
                  return (
                    <div key={d} className="flex items-center gap-2">
                      <span className="w-6 text-xs font-bold text-muted-foreground shrink-0">
                        {formatWeekdayShort(d)}
                      </span>
                      <Switch
                        checked={!closed}
                        aria-label={formatWeekdayShort(d)}
                        onCheckedChange={(open) =>
                          setDayHours((prev) => ({
                            ...prev,
                            [d]: open ? { start: businessStart, end: businessEnd } : null,
                          }))
                        }
                      />
                      {closed ? (
                        <span className="text-xs text-muted-foreground">{t("settings.trainer.businessDaysClosed")}</span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <Select
                            value={entry.start ?? ""}
                            onValueChange={(v) => setDayHours((prev) => ({ ...prev, [d]: { ...entry, start: v } }))}
                          >
                            <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DAY_START_OPTIONS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <span className="text-xs text-muted-foreground shrink-0">–</span>
                          <Select
                            value={entry.end ?? ""}
                            onValueChange={(v) => setDayHours((prev) => ({ ...prev, [d]: { ...entry, end: v } }))}
                          >
                            <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DAY_END_OPTIONS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
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
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("settings.trainer.bookingWindowLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.trainer.bookingWindowDesc")}</p>
              <Select value={bookingWindow || "unset"} onValueChange={(v) => setBookingWindow(v === "unset" ? "" : v)}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">{t("settings.trainer.bookingWindowUnset")}</SelectItem>
                  {BOOKING_WINDOW_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>{t("settings.trainer.bookingWindowDays", { count: d })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("settings.trainer.businessHoursCapacity")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.trainer.businessHoursCapacityDesc")}</p>
              <Select value={String(businessCapacity)} onValueChange={(v) => setBusinessCapacity(parseInt(v, 10))}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_CAPACITY_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{t("settings.trainer.businessHoursCapacityUnit", { count: n })}</SelectItem>
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

      <Separator />

      {/* === スタッフ別のシフト === 担当を指名する店だけに関係する。2人以上のジムでのみ描画される */}
      <section className="space-y-3">
        <TrainerStaffSchedule />
      </section>

      <Separator />

      {/* === 予約時のカスタム質問（事前アンケート） === */}
      <section className="space-y-3">
        <TrainerBookingQuestions />
      </section>

      <Separator />

      {/* === 予約確認メール・リマインドメールに足す、店からの案内 === */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          {t("settings.trainer.emailNoteSection")}
        </h3>
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground">{t("settings.trainer.emailNoteDesc")}</p>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("settings.trainer.bookingEmailNoteLabel")}</Label>
              <Textarea
                value={bookingEmailNote}
                onChange={(e) => setBookingEmailNote(e.target.value)}
                maxLength={EMAIL_NOTE_MAX_LENGTH}
                rows={3}
                placeholder={t("settings.trainer.bookingEmailNotePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("settings.trainer.reminderEmailNoteLabel")}</Label>
              <Textarea
                value={reminderEmailNote}
                onChange={(e) => setReminderEmailNote(e.target.value)}
                maxLength={EMAIL_NOTE_MAX_LENGTH}
                rows={3}
                placeholder={t("settings.trainer.reminderEmailNotePlaceholder")}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.trainer.emailNoteUnset")}</p>
            <Button onClick={handleSaveEmailNotes} disabled={savingEmailNotes || !tenant} size="sm" className="h-10">
              <Save className="w-4 h-4 mr-1" />
              {savingEmailNotes ? t("common.saving") : t("common.save")}
            </Button>
          </CardContent>
        </Card>
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

        {/* お客様に見せるキャンセルについての案内。
            ⚠️ **既定文を持たせない。** ペナルティの有無は店ごとに違うので、
               上流が代弁すると事実と食い違う。空欄なら何も出さない。 */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <h4 className="font-bold text-sm">{t("settings.trainer.cancelPolicyTitle")}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.cancelPolicyDesc")}</p>
            </div>
            <Textarea
              id="cancel-policy"
              value={cancelPolicy}
              onChange={(e) => setCancelPolicy(e.target.value)}
              placeholder={t("settings.trainer.cancelPolicyPlaceholder")}
              rows={4}
              maxLength={500}
            />
            {cancelPolicy.trim() === "" && (
              <p className="text-[11px] text-muted-foreground">{t("settings.trainer.cancelPolicyUnset")}</p>
            )}
            <Button onClick={handleSaveCancelPolicy} disabled={savingCancelPolicy || !tenant} size="sm" className="h-10">
              <Save className="w-4 h-4 mr-1" />
              {savingCancelPolicy ? t("common.saving") : t("common.save")}
            </Button>
          </CardContent>
        </Card>
      </section>

      <Separator />

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
            {DASHBOARD_SECTION_TOGGLES.filter(({ column }) => TRIAL_BOOKING_ENABLED || column !== "show_trial_followup_alert").map(({ column, labelKey }) => (
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
            {NAV_TAB_TOGGLES.filter(({ column }) => TRIAL_BOOKING_ENABLED || column !== "show_nav_trial_followups").map(({ column, labelKey }) => (
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

      <Separator />

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
      {LANGUAGE_SWITCHER_ENABLED && <LanguageSwitcher variant="trainer" />}

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

      {/* === 運営への要望 ===
          店側の声を開発元に直接届けてもらう欄（2026-08-14）。
          メール通知は DB トリガー側の仕事。ここは INSERT するだけ。 */}
      <section className="space-y-3">
        <OperatorFeedback tenantId={tenant?.id ?? null} />
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
        {/* オーナーは、引き継ぐか閉じるかしないとアカウントを削除できない。
            2026-08-13 まで**その手段が無く行き止まり**だった（GymOwnershipActions の冒頭）。 */}
        {role === "owner" && (
          <GymOwnershipActions
            gymName={tenant?.gym_name ?? null}
            onChanged={() => {
              void refetchTenant();
            }}
          />
        )}
        <DeleteAccountButton />
      </section>
    </div>
  );
};

export default TrainerGymSettings;