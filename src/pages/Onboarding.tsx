import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Check, Plus, Trash2, Upload, Copy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";

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
const BUSINESS_OPTIONS: { value: BusinessType; label: string }[] = [
  { value: "personal_gym", label: "パーソナルジム" },
  { value: "pilates", label: "ピラティス" },
  { value: "yoga", label: "ヨガ" },
  { value: "seitai", label: "整体・整骨院" },
  { value: "other", label: "その他" },
];
const START_HOURS = Array.from({ length: 6 }, (_, i) => `${String(7 + i).padStart(2, "0")}:00`);
const END_HOURS = Array.from({ length: 7 }, (_, i) => `${String(17 + i).padStart(2, "0")}:00`);
const SLOT_OPTIONS = [30, 45, 60, 90, 120];
const CUTOFF_OPTIONS: { value: string; label: string; type: CutoffType; hours?: number }[] = [
  { value: "prev_day", label: "前日まで", type: "prev_day" },
  { value: "2h", label: "当日2時間前まで", type: "hours_before", hours: 2 },
  { value: "1h", label: "当日1時間前まで", type: "hours_before", hours: 1 },
  { value: "none", label: "制限なし", type: "hours_before", hours: 0 },
];

const Onboarding = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Step 1
  const [gymName, setGymName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("personal_gym");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Step 2
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("21:00");
  const [slotDuration, setSlotDuration] = useState(60);
  const [cutoffValue, setCutoffValue] = useState("prev_day");
  const [primaryColor, setPrimaryColor] = useState("#3FB6AC");

  // Step 3
  const [plans, setPlans] = useState<PlanInput[]>([]);

  // Step 4
  const [createdTenant, setCreatedTenant] = useState<{ id: string; invite_code: string } | null>(null);

  // Redirect guards
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
      toast({ title: "ロゴをアップロードしました" });
    } catch (err: any) {
      toast({ title: "アップロード失敗", description: err.message, variant: "destructive" });
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
      const { data: tenant, error: tErr } = await supabase
        .from("tenants")
        .insert({
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
          booking_cutoff_type: cutoff.type,
          booking_cutoff_hours: cutoff.hours ?? 24,
          owner_user_id: user.id,
          status: "trial",
          trial_ends_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
          gymboard_plan: "free",
          max_customers: 5,
        })
        .select("id, invite_code")
        .single();
      if (tErr || !tenant) throw tErr || new Error("テナント作成失敗");

      const validPlans = plans
        .map((p, idx) => ({
          tenant_id: tenant.id,
          plan_name: p.name.trim(),
          plan_type: p.type,
          max_sessions: p.type === "period" ? null : p.maxSessions ? parseInt(p.maxSessions) : null,
          price: parseInt(p.price) || 0,
          validity_days: p.type === "ticket" || p.type === "period" ? (p.validityDays ? parseInt(p.validityDays) : null) : null,
          sort_order: idx + 1,
        }))
        .filter((p) => p.plan_name.length > 0);
      if (validPlans.length > 0) {
        const { error: pErr } = await supabase.from("tenant_plans").insert(validPlans);
        if (pErr) throw pErr;
      }

      const { error: mErr } = await supabase.from("tenant_members").insert({
        tenant_id: tenant.id,
        user_id: user.id,
        role: "owner",
        status: "active",
        display_name: gymName.trim() + " オーナー",
      });
      if (mErr) throw mErr;

      await supabase
        .from("profiles")
        .update({ display_name: gymName.trim() + " オーナー" })
        .eq("user_id", user.id);

      await supabase
        .from("user_roles")
        .upsert({ user_id: user.id, role: "trainer" }, { onConflict: "user_id,role" });

      setCreatedTenant(tenant);
      setStep(4);
    } catch (err: any) {
      toast({ title: "登録失敗", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-4 py-8" style={{ overflowX: "hidden" }}>
        {/* Stepper */}
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
                <h1 className="text-xl font-bold mb-1">ジムボードへようこそ！</h1>
                <p className="text-sm text-muted-foreground">まずはジムの基本情報を入力してください。</p>
              </div>
              <div>
                <Label>ジム名 <span className="text-destructive">*</span></Label>
                <Input value={gymName} onChange={(e) => setGymName(e.target.value)} placeholder="パーソナルジム○○" maxLength={100} />
              </div>
              <div>
                <Label>業種 <span className="text-destructive">*</span></Label>
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
                <Label>住所</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="東京都渋谷区..." maxLength={200} />
              </div>
              <div>
                <Label>電話番号</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="090-XXXX-XXXX" maxLength={20} />
              </div>
              <div>
                <Label>メールアドレス</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" maxLength={255} />
              </div>
              <div>
                <Label>ホームページURL</Label>
                <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://..." maxLength={500} />
              </div>
              <div>
                <Label>ロゴ画像</Label>
                <div className="flex items-center gap-3 mt-1">
                  {logoUrl && <img src={logoUrl} alt="logo" className="w-12 h-12 rounded-md object-cover border" />}
                  <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-background text-sm cursor-pointer hover:bg-muted">
                    <Upload className="w-4 h-4" />
                    {uploadingLogo ? "アップロード中..." : logoUrl ? "変更" : "アップロード"}
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
                <Button onClick={() => setStep(2)} disabled={!step1Valid}>次へ →</Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-bold mb-1">営業設定</h1>
                <p className="text-sm text-muted-foreground">営業時間と予約の設定を行います。</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>営業開始時間</Label>
                  <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                    {START_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <Label>営業終了時間</Label>
                  <select value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                    {END_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <Label>1セッションの長さ</Label>
                <select value={slotDuration} onChange={(e) => setSlotDuration(parseInt(e.target.value))} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                  {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{m}分</option>)}
                </select>
              </div>
              <div>
                <Label>予約締切</Label>
                <select value={cutoffValue} onChange={(e) => setCutoffValue(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                  {CUTOFF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <Label>アプリのテーマカラー</Label>
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
                <Button variant="outline" onClick={() => setStep(1)}>← 戻る</Button>
                <Button onClick={() => setStep(3)} disabled={!step2Valid}>次へ →</Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-bold mb-1">プラン設定</h1>
                <p className="text-sm text-muted-foreground">お客様向けのプランを設定してください。後からいつでも追加・変更できます。</p>
              </div>
              {plans.map((p, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">プラン {i + 1}</span>
                    <button onClick={() => removePlan(i)} className="text-destructive p-1" aria-label="削除">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <Label>プラン名</Label>
                    <Input value={p.name} onChange={(e) => updatePlan(i, { name: e.target.value })} placeholder="月4回プラン" maxLength={50} />
                  </div>
                  <div>
                    <Label>タイプ</Label>
                    <select
                      value={p.type}
                      onChange={(e) => updatePlan(i, { type: e.target.value as PlanType })}
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                    >
                      <option value="subscription">月額制（月X回）</option>
                      <option value="ticket">チケット制（X回分、有効期限あり）</option>
                      <option value="period">期間制（X日間通い放題）</option>
                    </select>
                  </div>
                  {p.type !== "period" && (
                    <div>
                      <Label>{p.type === "subscription" ? "月の上限回数" : "総回数"}</Label>
                      <Input type="number" inputMode="numeric" value={p.maxSessions} onChange={(e) => updatePlan(i, { maxSessions: e.target.value })} />
                    </div>
                  )}
                  <div>
                    <Label>料金（円）</Label>
                    <Input type="number" inputMode="numeric" value={p.price} onChange={(e) => updatePlan(i, { price: e.target.value })} />
                  </div>
                  {(p.type === "ticket" || p.type === "period") && (
                    <div>
                      <Label>{p.type === "ticket" ? "有効期限（日間）" : "期間（日間）"}</Label>
                      <Input type="number" inputMode="numeric" value={p.validityDays} onChange={(e) => updatePlan(i, { validityDays: e.target.value })} />
                    </div>
                  )}
                </div>
              ))}
              <Button variant="outline" onClick={addPlan} disabled={plans.length >= 10} className="w-full">
                <Plus className="w-4 h-4 mr-1" /> プランを追加
              </Button>
              <div className="pt-4 flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>← 戻る</Button>
                <Button onClick={handleComplete} disabled={submitting}>
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  登録する
                </Button>
              </div>
            </div>
          )}

          {step === 4 && createdTenant && (
            <div className="space-y-5 text-center">
              <div className="text-4xl">🎉</div>
              <h1 className="text-xl font-bold">ジムの登録が完了しました！</h1>
              <div className="text-2xl font-bold text-accent break-all">{gymName}</div>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">招待コード</div>
                <div className="text-3xl font-mono font-bold tracking-wider break-all">{createdTenant.invite_code}</div>
                <p className="text-sm text-muted-foreground">このコードをお客様にお伝えください。<br />お客様はアプリでこのコードを入力するだけで、あなたのジムに参加できます。</p>
              </div>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    navigator.clipboard.writeText(createdTenant.invite_code);
                    toast({ title: "招待コードをコピーしました" });
                  }}
                >
                  <Copy className="w-4 h-4 mr-1" /> 招待コードをコピー
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    const link = `${window.location.origin}/join/${createdTenant.invite_code}`;
                    navigator.clipboard.writeText(link);
                    toast({ title: "招待リンクをコピーしました" });
                  }}
                >
                  <Copy className="w-4 h-4 mr-1" /> 招待リンクをコピー
                </Button>
              </div>
              <Button className="w-full" onClick={() => navigate("/", { replace: true })}>
                管理画面へ進む →
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
