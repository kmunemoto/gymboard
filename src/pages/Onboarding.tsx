import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Plus, Trash2, Upload, Copy, PartyPopper } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { GYM_DISPLAY_PRESETS, presetToValues, type GymDisplayPreset } from "@/lib/gymDisplaySettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { getWebOrigin } from "@/lib/nativeBridge";
import { DEFAULT_TENANT_MUSCLE_GROUPS } from "@/lib/tenantMuscleGroups";

type BusinessType = "personal_gym" | "pilates" | "yoga" | "seitai" | "other";
type CutoffType = "prev_day" | "hours_before";
type PlanType = "subscription" | "ticket" | "period";

interface PlanInput {
  name: string;
  type: PlanType;
  maxSessions: string;
  price: string;
  validityDays: string;
}

const PRESET_COLORS = ["#3FB6AC", "#6366F1", "#F59E0B", "#EC4899", "#10B981"];
// 30分刻み（開始7:00〜12:00、終了17:00〜23:00）。ジム設定「営業時間」セクションと揃える。
const hourOption = (baseHour: number, i: number) => {
  const totalMin = baseHour * 60 + i * 30;
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
};
// 開店・閉店とも1日の全域から選べる（30分刻み）。設定画面と同じ範囲にすること。
// 開店 00:00〜23:30 / 閉店 00:30〜24:00（24:00 は「その日いっぱい」＝24時間営業）。
const START_HOURS = Array.from({ length: 48 }, (_, i) => hourOption(0, i));
const END_HOURS = Array.from({ length: 48 }, (_, i) => hourOption(0, i + 1));
const SLOT_OPTIONS = [30, 45, 60, 90, 120];
// 同時に受けられる予約数（tenants.booking_capacity）。
// 既定1のまま放置されると「2人同時に見ているのに満枠と出る」ので、開店時に必ず聞く。
// 設定画面（ジム設定→営業時間）と同じ選択肢に揃えてある。
const CAPACITY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];

const Onboarding = () => {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const BUSINESS_OPTIONS: { value: BusinessType; label: string }[] = [
    { value: "personal_gym", label: t("onboarding.businessPersonalGym") },
    { value: "pilates", label: t("onboarding.businessPilates") },
    { value: "yoga", label: t("onboarding.businessYoga") },
    { value: "seitai", label: t("onboarding.businessSeitai") },
    { value: "other", label: t("onboarding.businessOther") },
  ];

  const CUTOFF_OPTIONS: { value: string; label: string; type: CutoffType; hours?: number }[] = [
    { value: "prev_day", label: t("onboarding.cutoffPrevDay"), type: "prev_day" },
    { value: "2h", label: t("onboarding.cutoff2h"), type: "hours_before", hours: 2 },
    { value: "1h", label: t("onboarding.cutoff1h"), type: "hours_before", hours: 1 },
    { value: "none", label: t("onboarding.cutoffNone"), type: "hours_before", hours: 0 },
  ];

  const [step, setStep] = useState(1);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [gymName, setGymName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("personal_gym");
  // 画面に出す機能の量。既定は「標準」。ジムボードは機能が多いので、
  // いきなり全部盛りで始めない（後から設定画面でいつでも変えられる）。
  const [displayPreset, setDisplayPreset] = useState<GymDisplayPreset>("standard");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("21:00");
  const [slotDuration, setSlotDuration] = useState(60);
  const [bookingCapacity, setBookingCapacity] = useState(1);
  const [cutoffValue, setCutoffValue] = useState("prev_day");
  const [primaryColor, setPrimaryColor] = useState("#3FB6AC");

  const [plans, setPlans] = useState<PlanInput[]>([]);

  const [createdTenant, setCreatedTenant] = useState<{ id: string; invite_code: string } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    setEmail((prev) => prev || user.email || "");
    (async () => {
      const { data } = await supabase
        .from("tenant_members")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (data) {
        navigate("/", { replace: true });
      } else {
        setChecking(false);
      }
    })();
  }, [user, authLoading, navigate]);

  const handleLogoUpload = async (file: File) => {
    if (!user) return;
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `tenant-logos/${user.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast({ title: t("onboarding.toastLogoUploaded") });
    } catch (err) {
      toast({ title: t("onboarding.toastUploadFailed"), description: err.message, variant: "destructive" });
    } finally {
      setUploadingLogo(false);
    }
  };

  const addPlan = () => {
    if (plans.length >= 10) return;
    setPlans([...plans, { name: "", type: "subscription", maxSessions: "", price: "", validityDays: "" }]);
  };
  const updatePlan = (i: number, patch: Partial<PlanInput>) => {
    setPlans(plans.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };
  const removePlan = (i: number) => setPlans(plans.filter((_, idx) => idx !== i));

  const step1Valid = gymName.trim().length > 0 && businessType;
  const step2Valid = startTime && endTime && slotDuration > 0 && cutoffValue;

  const handleComplete = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      const cutoff = CUTOFF_OPTIONS.find((c) => c.value === cutoffValue)!;
      const ownerName = gymName.trim() + t("onboarding.ownerSuffix");

      // 🔴 開設は RPC 1本＝1トランザクション（create_gym_with_owner）。
      //
      // 以前はここで tenants → tenant_plans → 表示プリセット → 部位 → tenant_members
      // → profiles → user_roles と**8回に分けて書いて**いた。巻き戻しが1行も無いので、
      // 途中で失敗すると:
      //   ・tenants だけ残る「孤児テナント」ができる。しかも再試行は毎回 INSERT から
      //     始まるので押すたびに1件ずつ増える（既存判定は tenant_members を見ており孤児は素通り）
      //   ・tenant_members で失敗すると本人が非メンバーのまま残り、delete_my_gym の
      //     本人確認（owner として在籍）に引っかかって**本人にも消せない**
      //   ・部位のシードは tenant_members より前に居たため RLS に**必ず**弾かれていた
      //     （エラーは console.error で握りつぶし。本番では 2026-07-29 以降の全ジムが部位0件だった）
      // RPC は SECURITY DEFINER なので順序の問題ごと消え、失敗すれば何も残らない。
      // ⚠️ `as never` は types.ts が未再生成のため（Lovable のボットがマージ後に生成する）。
      //    既存の RPC 呼び出し（GymOwnershipActions）と同じ書き方に揃えている。
      const { data, error } = await supabase.rpc("create_gym_with_owner" as never, {
        _tenant: {
          gym_name: gymName.trim(),
          business_type: businessType,
          address: address.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || user.email,
          website_url: websiteUrl.trim() || null,
          logo_url: logoUrl || null,
          primary_color: primaryColor,
          operating_hours: { start: startTime, end: endTime },
          slot_duration_minutes: slotDuration,
          booking_capacity: bookingCapacity,
          booking_cutoff_type: cutoff.type,
          booking_cutoff_hours: cutoff.hours ?? 24,
          // ⚠️ status / trial_ends_at / gymboard_plan / max_customers は**送らない**。
          //    サーバー側（RPC）で trial・60日・free・上限5 に固定している。
          //    以前はクライアントが申告していたので、API を直接叩けば premium で開設できた。
        },
        _plans: plans
          .map((p) => ({
            plan_name: p.name.trim(),
            plan_type: p.type,
            max_sessions: p.type === "period" ? null : p.maxSessions ? parseInt(p.maxSessions) : null,
            price: parseInt(p.price) || 0,
            validity_days:
              p.type === "ticket" || p.type === "period"
                ? p.validityDays ? parseInt(p.validityDays) : null
                : null,
          }))
          .filter((p) => p.plan_name.length > 0),
        _owner_name: ownerName,
        _muscle_groups: [...DEFAULT_TENANT_MUSCLE_GROUPS],
      } as never);
      if (error) throw error;
      // RETURNS TABLE なので配列で返る。念のため単体で返る形にも耐えるようにしておく
      const rows = data as unknown as { tenant_id?: string; invite_code?: string }[] | { tenant_id?: string; invite_code?: string } | null;
      const created = Array.isArray(rows) ? rows[0] : rows;
      if (!created?.tenant_id) throw new Error(t("onboarding.errTenantCreateFailed"));

      // 画面に出す機能の量（表示プリセット）。DBの既定は全17項目 true なので、
      // 何もしないと新しいジムがいきなり全部盛りで始まる。
      // ここは失敗しても開設自体は成立している（後から設定画面で変えられる）ので、
      // RPC の外に置いて、失敗しても止めない。
      const { error: dErr } = await supabase
        .from("tenants")
        .update(presetToValues(displayPreset) as never)
        .eq("id", created.tenant_id);
      if (dErr) console.error("[Onboarding] display preset failed:", dErr.message);

      setCreatedTenant({ id: created.tenant_id, invite_code: created.invite_code ?? "" });
      setStep(4);
    } catch (err) {
      toast({ title: t("onboarding.toastRegisterFailed"), description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <DumbbellLoader className="w-16 h-16 text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-4 py-8" style={{ overflowX: "hidden" }}>
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  step === n
                    ? "bg-accent text-accent-foreground"
                    : step > n
                    ? "bg-accent/20 text-accent"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step > n ? <Check className="w-4 h-4" /> : n}
              </div>
              {n < 4 && <div className={`w-6 h-0.5 ${step > n ? "bg-accent" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        <div className="bg-card border rounded-2xl shadow-sm p-6">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-bold mb-1">{t("onboarding.step1Title")}</h1>
                <p className="text-sm text-muted-foreground">{t("onboarding.step1Sub")}</p>
              </div>
              <div>
                <Label>{t("onboarding.fieldGymName")} <span className="text-destructive">*</span></Label>
                <Input value={gymName} onChange={(e) => setGymName(e.target.value)} placeholder={t("onboarding.gymNamePlaceholder")} maxLength={100} />
              </div>
              <div>
                <Label>{t("onboarding.fieldBusinessType")} <span className="text-destructive">*</span></Label>
                <select
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                >
                  {BUSINESS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                {/* ジムボードは機能が多いので、最初に出す量を選べるようにする。
                    既定は「標準」。後から設定画面でいつでも変えられる。 */}
                <Label>{t("onboarding.fieldDisplayPreset")}</Label>
                <div className="grid grid-cols-3 gap-2 mt-1.5">
                  {GYM_DISPLAY_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setDisplayPreset(preset)}
                      className={`rounded-md border px-2 py-2 text-center transition-colors ${
                        displayPreset === preset
                          ? "border-accent bg-accent/10"
                          : "border-input hover:bg-muted"
                      }`}
                    >
                      <span className="block text-xs font-bold">{t(`settings.trainer.displayPreset.${preset}`)}</span>
                      <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5">
                        {t(`settings.trainer.displayPresetHint.${preset}`)}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">{t("onboarding.displayPresetNote")}</p>
              </div>
              <div>
                <Label>{t("onboarding.fieldAddress")}</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("onboarding.addressPlaceholder")} maxLength={200} />
              </div>
              <div>
                <Label>{t("onboarding.fieldPhone")}</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("onboarding.phonePlaceholder")} maxLength={20} />
              </div>
              <div>
                <Label>{t("onboarding.fieldEmail")}</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" maxLength={255} />
              </div>
              <div>
                <Label>{t("onboarding.fieldWebsite")}</Label>
                <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://..." maxLength={500} />
              </div>
              <div>
                <Label>{t("onboarding.fieldLogo")}</Label>
                <div className="flex items-center gap-3 mt-1">
                  {logoUrl && <img src={logoUrl} alt={t("onboarding.logoAlt")} className="w-12 h-12 rounded-md object-cover border" />}
                  <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-background text-sm cursor-pointer hover:bg-muted">
                    <Upload className="w-4 h-4" />
                    {uploadingLogo ? t("onboarding.uploading") : logoUrl ? t("onboarding.change") : t("onboarding.upload")}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}
                    />
                  </label>
                </div>
              </div>
              <div className="pt-4 flex justify-end">
                <Button onClick={() => setStep(2)} disabled={!step1Valid}>{t("onboarding.next")}</Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-bold mb-1">{t("onboarding.step2Title")}</h1>
                <p className="text-sm text-muted-foreground">{t("onboarding.step2Sub")}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("onboarding.fieldStart")}</Label>
                  <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                    {START_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <Label>{t("onboarding.fieldEnd")}</Label>
                  <select value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                    {END_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <Label>{t("onboarding.fieldSlotDuration")}</Label>
                <select value={slotDuration} onChange={(e) => setSlotDuration(parseInt(e.target.value))} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                  {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{t("onboarding.slotMinutes", { n: m })}</option>)}
                </select>
              </div>
              <div>
                {/* 同時に受けられる予約数。ここで聞かないと既定1のまま放置され、
                    2人同時に見ているジムで「空いているのに満枠」になる。 */}
                <Label>{t("onboarding.fieldCapacity")}</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-1.5">{t("onboarding.fieldCapacityHint")}</p>
                <select value={bookingCapacity} onChange={(e) => setBookingCapacity(parseInt(e.target.value))} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                  {CAPACITY_OPTIONS.map((n) => <option key={n} value={n}>{t("settings.trainer.businessHoursCapacityUnit", { count: n })}</option>)}
                </select>
              </div>
              <div>
                <Label>{t("onboarding.fieldCutoff")}</Label>
                <select value={cutoffValue} onChange={(e) => setCutoffValue(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                  {CUTOFF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <Label>{t("onboarding.fieldThemeColor")}</Label>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPrimaryColor(c)}
                      className={`w-10 h-10 rounded-full border-2 ${primaryColor === c ? "border-foreground" : "border-transparent"}`}
                      style={{ background: c }}
                      aria-label={c}
                    />
                  ))}
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 rounded-full border cursor-pointer"
                  />
                </div>
              </div>
              <div className="pt-4 flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>{t("onboarding.back")}</Button>
                <Button onClick={() => setStep(3)} disabled={!step2Valid}>{t("onboarding.next")}</Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-bold mb-1">{t("onboarding.step3Title")}</h1>
                <p className="text-sm text-muted-foreground">{t("onboarding.step3Sub")}</p>
              </div>
              {plans.map((p, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{t("onboarding.planLabel", { n: i + 1 })}</span>
                    <button onClick={() => removePlan(i)} className="text-destructive p-1" aria-label={t("onboarding.deleteAria")}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <Label>{t("onboarding.fieldPlanName")}</Label>
                    <Input value={p.name} onChange={(e) => updatePlan(i, { name: e.target.value })} placeholder={t("onboarding.planNamePlaceholder")} maxLength={50} />
                  </div>
                  <div>
                    <Label>{t("onboarding.fieldPlanType")}</Label>
                    <select
                      value={p.type}
                      onChange={(e) => updatePlan(i, { type: e.target.value as PlanType })}
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                    >
                      <option value="subscription">{t("onboarding.planTypeSubscription")}</option>
                      <option value="ticket">{t("onboarding.planTypeTicket")}</option>
                      <option value="period">{t("onboarding.planTypePeriod")}</option>
                    </select>
                  </div>
                  {p.type !== "period" && (
                    <div>
                      <Label>{p.type === "subscription" ? t("onboarding.fieldMonthlyLimit") : t("onboarding.fieldTotalSessions")}</Label>
                      <Input type="number" inputMode="numeric" value={p.maxSessions} onChange={(e) => updatePlan(i, { maxSessions: e.target.value })} />
                    </div>
                  )}
                  <div>
                    <Label>{t("onboarding.fieldPrice")}</Label>
                    <Input type="number" inputMode="numeric" value={p.price} onChange={(e) => updatePlan(i, { price: e.target.value })} />
                  </div>
                  {(p.type === "ticket" || p.type === "period") && (
                    <div>
                      <Label>{p.type === "ticket" ? t("onboarding.fieldValidityTicket") : t("onboarding.fieldValidityPeriod")}</Label>
                      <Input type="number" inputMode="numeric" value={p.validityDays} onChange={(e) => updatePlan(i, { validityDays: e.target.value })} />
                    </div>
                  )}
                </div>
              ))}
              <Button variant="outline" onClick={addPlan} disabled={plans.length >= 10} className="w-full">
                <Plus className="w-4 h-4 mr-1" /> {t("onboarding.addPlan")}
              </Button>
              <div className="pt-4 flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>{t("onboarding.back")}</Button>
                <Button onClick={handleComplete} disabled={submitting}>
                  {submitting && <DumbbellLoader className="w-4 h-4 mr-2" />}
                  {t("onboarding.register")}
                </Button>
              </div>
            </div>
          )}

          {step === 4 && createdTenant && (
            <div className="space-y-5 text-center">
              <PartyPopper className="w-10 h-10 mx-auto text-accent" />
              <h1 className="text-xl font-bold">{t("onboarding.step4Title")}</h1>
              <div className="text-2xl font-bold text-accent break-all">{gymName}</div>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">{t("onboarding.inviteCodeLabel")}</div>
                <div className="text-3xl font-mono font-bold tracking-wider break-all">{createdTenant.invite_code}</div>
                <p className="text-sm text-muted-foreground">
                  {t("onboarding.inviteNote")}<br />
                  {t("onboarding.inviteNote2")}
                </p>
              </div>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    navigator.clipboard.writeText(createdTenant.invite_code);
                    toast({ title: t("onboarding.toastCodeCopied") });
                  }}
                >
                  <Copy className="w-4 h-4 mr-1" /> {t("onboarding.copyCode")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    // ネイティブアプリ内では window.location.origin が 'capacitor://localhost'
                    // になり、コピーしたリンクが開けなくなるため getWebOrigin() でフォールバックする。
                    const link = `${getWebOrigin()}/join/${createdTenant.invite_code}`;
                    navigator.clipboard.writeText(link);
                    toast({ title: t("onboarding.toastLinkCopied") });
                  }}
                >
                  <Copy className="w-4 h-4 mr-1" /> {t("onboarding.copyLink")}
                </Button>
              </div>
              <Button className="w-full" onClick={() => navigate("/", { replace: true })}>
                {t("onboarding.goDashboard")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
