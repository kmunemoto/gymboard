import { lazy, useState, useEffect, useMemo, useRef } from "react";
import { Settings, User, Pencil, MessageCircle, CheckCircle2, Unlink, LogOut, History, Clock, Dumbbell, Award, Bone, Smartphone, Calendar, FileText, Shield as ShieldIcon, ChevronRight, Gamepad2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { useMyBookings, BookingWithTime } from "@/hooks/useBookings";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { getCycleWindow, resolveCycleMonths } from "@/lib/courseProgress";
import { ja } from "date-fns/locale";
import { getJSTNow } from "@/lib/timezone";
import { formatDate } from "@/lib/dateFormat";
import LazyBoundary from "@/components/LazyBoundary";
// 骨格診断履歴はグラフ(recharts)を含むため遅延読込（バンドル最適化）
const DiagnosisHistorySection = lazy(() => import("./posture/DiagnosisHistorySection"));
import DeleteAccountButton from "@/components/DeleteAccountButton";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeColorSwitcher from "@/components/ThemeColorSwitcher";
import BackgroundImagePicker from "@/components/BackgroundImagePicker";
import { useTranslation } from "react-i18next";

import { useTenant } from "@/hooks/useTenant";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import PushNotificationSection from "./PushNotificationSection";
import { LINE_INTEGRATION_ENABLED, GOOGLE_CALENDAR_CUSTOMER_ENABLED, APPLE_CONNECTION_ENABLED } from "@/lib/featureFlags";

const CustomerSettings = () => {
  const { t } = useTranslation();
  const { profile, loading, updateDisplayName, updateGameMode, refetch } = useProfile();
  const { user, signOut } = useAuth();
  const { bookings: myBookings, loading: bookingsLoading } = useMyBookings();
  const { plans: tenantPlans } = useTenant();
  const planLabelMap = useMemo(() => {
    const m: Record<string, string> = { "初回無料体験": "初回無料体験", "通常": "通常" };
    tenantPlans?.forEach((p) => { m[p.plan_name] = p.plan_name; });
    return m;
  }, [tenantPlans]);
  const planMaxMap = useMemo(() => {
    const m: Record<string, number> = {};
    tenantPlans?.forEach((p) => { if (p.max_sessions != null) m[p.plan_name] = p.max_sessions; });
    return m;
  }, [tenantPlans]);
  
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const isLineLinked = !!profile?.line_user_id;

  // Google Calendar state
  const [gcalLinked, setGcalLinked] = useState(false);
  const [gcalLoading, setGcalLoading] = useState(true);
  const gcalLinkedRef = useRef(false);

  useEffect(() => {
    setDisplayName(profile?.display_name || "");
  }, [profile?.display_name]);

  // Check Google Calendar link status
  useEffect(() => {
    const checkGcalStatus = async (silent = false) => {
      if (!user) {
        if (!silent) setGcalLoading(false);
        return;
      }
      if (!silent) setGcalLoading(true);
      const { data } = await supabase
        .from("google_calendar_tokens" as any)
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      const nowLinked = !!data;
      // 連携が新たに完了した瞬間（未連携→連携済み）にトースト表示
      if (silent && nowLinked && !gcalLinkedRef.current) {
        toast.success(t("settings.gcal.linkSuccess"));
      }
      gcalLinkedRef.current = nowLinked;
      setGcalLinked(nowLinked);
      if (!silent) setGcalLoading(false);
    };
    checkGcalStatus();
    // 画面復帰時（OAuthタブから戻った時など）に連携状態を静かに再取得する
    const onVisible = () => {
      if (document.visibilityState === "visible") checkGcalStatus(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [user]);

  // Listen for Google Calendar callback
  useEffect(() => {
    const handler = (e: MessageEvent) => {
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
  }, [t]);

  const handleGcalLink = async () => {
    if (!user) return;
    const popup = window.open("about:blank", "gcal-link", "width=500,height=700");
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-auth-url", {
        body: { user_id: user.id },
      });
      if (error || !data?.url) {
        popup?.close();
        toast.error(t("settings.gcal.authUrlFailed"));
        return;
      }
      if (popup) {
        popup.location.href = data.url;
      } else {
        window.location.href = data.url;
      }
    } catch (e) {
      popup?.close();
      console.error(e);
      toast.error(t("common.errorGeneric"));
    }
  };

  const handleGcalUnlink = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("google_calendar_tokens" as any)
      .delete()
      .eq("user_id", user.id);
    if (error) {
      toast.error(t("settings.gcal.unlinkFailed"));
    } else {
      toast.success(t("settings.gcal.unlinked"));
      setGcalLinked(false);
      gcalLinkedRef.current = false;
    }
  };

  // Handle LINE link result from redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkResult = params.get("line_link");
    if (linkResult === "success") {
      toast.success(t("settings.line.linkSuccess"));
      refetch();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (linkResult === "error") {
      toast.error(t("settings.line.linkFailed"));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refetch, t]);

  const handleLineLink = async () => {
    if (!user) return;
    const { data, error } = await supabase.functions.invoke("line-auth-url", { body: {} });
    if (error || !data?.url) {
      toast.error(t("settings.line.startFailed"));
      return;
    }
    window.location.href = data.url;
  };


  const handleLineUnlink = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ line_user_id: null })
      .eq("user_id", user.id);
    if (error) {
      toast.error(t("settings.line.unlinkFailed"));
    } else {
      toast.success(t("settings.line.unlinked"));
      refetch();
    }
  };

  const handleSaveName = async () => {
    if (!user || !displayName.trim()) return;
    setSaving(true);
    const { error } = await updateDisplayName(displayName);
    if (error) {
      toast.error(t("settings.profile_.saveFailed"));
    } else {
      toast.success(t("settings.profile_.updated"));
      setEditing(false);
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <DumbbellLoader className="w-6 h-6 text-accent" />
      </div>
    );
  }

  const currentPlan = profile?.plan || t("common.notSet");

  return (
    <div className="px-4 py-4 space-y-5 slide-up">
      <h1 className="text-lg font-bold flex items-center gap-2">
        <Settings className="w-5 h-5" />
        {t("settings.title")}
      </h1>

      {/* Profile */}
      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <User className="w-3.5 h-3.5" />
          {t("settings.profile")}
        </h2>
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("settings.name")}</span>
              {editing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="h-8 w-40 text-sm"
                    placeholder={t("settings.namePlaceholder")}
                  />
                  <Button size="sm" onClick={handleSaveName} disabled={saving || !displayName.trim()} className="h-8 text-xs">
                    {saving ? <DumbbellLoader className="w-3 h-3" /> : t("common.save")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDisplayName(profile?.display_name || ""); }} className="h-8 text-xs">
                    {t("common.cancelShort")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{profile?.display_name || t("common.guest")}</span>
                  <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-muted transition-colors">
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("settings.plan")}</span>
              <span className="text-sm font-bold">{currentPlan}</span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Training goal is trainer-only management info; not shown to customers. */}


      {/* Language */}
      <LanguageSwitcher variant="customer" />

      {/* Theme color */}
      <ThemeColorSwitcher variant="customer" />

      {/* Background image */}
      <BackgroundImagePicker variant="customer" />

      {/* Push Notifications */}
      <PushNotificationSection />



      {/* LINE連携セクション。表示可否は featureFlags.ts で一元管理。 */}
      {LINE_INTEGRATION_ENABLED && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <MessageCircle className="w-3.5 h-3.5" />
            {t("settings.line.section")}
          </h2>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${isLineLinked ? "bg-[#06C755]/10" : "bg-muted"}`}>
                  <MessageCircle className={`w-4 h-4 ${isLineLinked ? "text-[#06C755]" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold">{t("settings.line.notif")}</p>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    {t("settings.line.description")}
                  </p>
                  {isLineLinked ? (
                    <div className="space-y-2">
                      <div className="bg-[#06C755]/5 rounded-lg p-2 border border-[#06C755]/20">
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#06C755]" />
                          {t("settings.line.linked")}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={handleLineUnlink} className="text-xs h-7">
                        <Unlink className="w-3 h-3 mr-1" />
                        {t("settings.line.unlink")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleLineLink}
                      className="text-xs bg-[#06C755] hover:bg-[#06C755]/90 text-white"
                    >
                      <MessageCircle className="w-3.5 h-3.5 mr-1" />
                      {t("settings.line.link")}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/*
        Googleカレンダー連携セクション（顧客向け）。表示可否は featureFlags.ts で一元管理。
      */}
      {GOOGLE_CALENDAR_CUSTOMER_ENABLED && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {t("settings.gcal.section")}
          </h2>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${gcalLinked ? "bg-blue-500/10" : "bg-muted"}`}>
                  <Calendar className={`w-4 h-4 ${gcalLinked ? "text-blue-500" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold">{t("settings.gcal.section")}</p>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    {t("settings.gcal.description")}
                  </p>
                  {gcalLoading ? (
                    <DumbbellLoader className="w-4 h-4 text-muted-foreground" />
                  ) : gcalLinked ? (
                    <div className="space-y-2">
                      <div className="bg-blue-500/5 rounded-lg p-2 border border-blue-500/20">
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />
                          {t("settings.gcal.linked")}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={handleGcalUnlink} className="text-xs h-7">
                        <Unlink className="w-3 h-3 mr-1" />
                        {t("settings.gcal.unlink")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleGcalLink}
                      className="text-xs bg-blue-500 hover:bg-blue-600 text-white"
                    >
                      <Calendar className="w-3.5 h-3.5 mr-1" />
                      {t("settings.gcal.link")}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Apple連携セクション。表示可否は featureFlags.ts で一元管理。 */}
      {APPLE_CONNECTION_ENABLED && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5" />
            {t("settings.apple.section")}
          </h2>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-muted">
                  <Smartphone className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold">{t("settings.apple.section")}</p>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    {t("settings.apple.description")}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => {
                      try {
                        if (!profile?.calendar_token) {
                          toast.error(t("settings.apple.tokenMissing"));
                          return;
                        }
                        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                        if (!supabaseUrl) {
                          toast.error(t("settings.apple.linkFailed"));
                          return;
                        }
                        const httpsUrl = `${supabaseUrl}/functions/v1/calendar-feed?token=${profile.calendar_token}`;
                        const webcalUrl = httpsUrl.replace(/^https:\/\//, "webcal://");
                        window.location.href = webcalUrl;
                        toast.success(t("settings.apple.subscribing"));
                      } catch (err) {
                        console.error("Calendar link error:", err);
                        toast.error(t("settings.apple.linkFailed"));
                      }
                    }}
                    className="text-xs"
                    variant="outline"
                  >
                    <Smartphone className="w-3.5 h-3.5 mr-1" />
                    {t("settings.apple.link")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" />
          {t("settings.history")}
        </h2>

        {bookingsLoading ? (
          <div className="flex items-center justify-center py-6">
            <DumbbellLoader className="w-5 h-5 text-muted-foreground" />
          </div>
        ) : (() => {
          const now = getJSTNow();
          const pastBookings = myBookings
            .filter((b) => {
              if (b.status === "キャンセル済み") return false;
              const endDt = new Date(`${b.date}T${b.endTime}:00+09:00`);
              return endDt <= now;
            })
            .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));

          // Compute cycle-based count（アニバーサリー日は前サイクル最終日として扱う）
          const cycleWindow = profile?.cycle_start_date ? getCycleWindow(profile.cycle_start_date, now, resolveCycleMonths(profile?.plan, tenantPlans)) : null;
          const cycleCount = cycleWindow
            ? pastBookings.filter((b) => {
                const d = new Date(b.date);
                return d >= cycleWindow.start && d < cycleWindow.end;
              }).length
            : pastBookings.length;

          const maxSessions = profile?.plan ? (planMaxMap[profile.plan] ?? null) : null;
          const isUnlimited = profile?.plan === "通い放題";

          return (
            <>

              {pastBookings.length === 0 ? (
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-sm text-muted-foreground">{t("settings.noHistory")}</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {pastBookings.map((b) => {
                    const dt = new Date(`${b.date}T${b.startTime}:00+09:00`);
                    const dateLabel = formatDate(dt, "monthDayDow");
                    const planLabel = planLabelMap[b.booking_type] || b.booking_type;
                    return (
                      <Card key={b.id} className="opacity-75">
                        <CardContent className="p-3 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            <Dumbbell className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-muted-foreground">{dateLabel}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {b.startTime}〜{b.endTime}
                              </span>
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                {planLabel}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()}
      </section>

      {/* 骨格診断履歴（遅延読込。本体は常にヘッダ＋ローダーを描くため高さを確保） */}
      <LazyBoundary fallback={<div className="h-24" aria-hidden />}>
        <DiagnosisHistorySection userId={user?.id} />
      </LazyBoundary>

      {/* Logout */}
      <section className="pt-2 space-y-3">
        <Button variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/10" onClick={signOut}>
          <LogOut className="w-4 h-4 mr-2" />
          {t("settings.logout")}
        </Button>
        <DeleteAccountButton />
      </section>

      {/* 規約・ポリシー（控えめなフッターリンク） */}
      <div className="pt-2 pb-4 flex flex-wrap items-center justify-center gap-2 text-[12px] text-muted-foreground/70">
        <Link to="/terms" className="px-2 py-1 hover:text-foreground transition-colors">
          {t("settings.terms")}
        </Link>
        <span aria-hidden="true">·</span>
        <Link to="/privacy" className="px-2 py-1 hover:text-foreground transition-colors">
          {t("settings.privacy")}
        </Link>
        <span aria-hidden="true">·</span>
        <Link to="/tokushoho" className="px-2 py-1 hover:text-foreground transition-colors">
          {t("settings.tokushoho")}
        </Link>
      </div>
    </div>
  );
};

export default CustomerSettings;
