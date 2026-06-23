import { useState } from "react";
import { useNavigate, Navigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Dumbbell, Mail, Lock, User, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import SocialAuthButtons from "@/components/SocialAuthButtons";
import gymboardLogo from "@/assets/gymboard-logo.png";

type AuthMode = "login" | "signup" | "forgot";
type LoginTarget = "customer" | "trainer";

import { getAuthCallbackUrl } from "@/lib/nativeBridge";

const EMAIL_CALLBACK_URL = getAuthCallbackUrl();

const Auth = () => {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [loginTarget, setLoginTarget] = useState<LoginTarget>("customer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectParam = searchParams.get("redirect");

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <DumbbellLoader className="w-8 h-8 text-accent" />
      </div>
    );
  }
  if (user && !loading) {
    return <Navigate to={redirectParam || "/"} replace />;
  }

  const isTrainer = loginTarget === "trainer";
  const passwordMismatch = mode === "signup" && passwordConfirm.length > 0 && password !== passwordConfirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "forgot") {
      setLoading(true);
      try {
        const redirectTo = "https://gymboard.lovable.app/reset-password";
        await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      } catch (err) {
        console.warn("resetPasswordForEmail error (suppressed):", err?.message);
      } finally {
        setForgotSent(true);
        setLoading(false);
      }
      return;
    }
    if (mode === "signup") {
      if (password.length < 6) {
        toast.error(t("auth.errPasswordTooShort"));
        return;
      }
      if (password !== passwordConfirm) {
        toast.error(t("auth.errPasswordMismatchToast"));
        return;
      }
    }
    setLoading(true);

    try {
      if (mode === "signup") {
        const role = isTrainer ? "trainer" : "customer";
        const { data: authData, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName || email,
              role,
            },
            emailRedirectTo: EMAIL_CALLBACK_URL,
          },
        });
        if (error) throw error;

        if (!authData.session) {
          toast.success(t("auth.signupEmailSent"), { duration: 8000 });
          setPassword("");
          setPasswordConfirm("");
          setMode("login");
          return;
        }

        if (isTrainer) {
          const { data: roleData, error: roleError } = await supabase.functions.invoke(
            "signup-trainer",
            { body: {} },
          );
          if (roleError || (roleData && (roleData as any).error)) {
            const msg = (roleData as any)?.error || roleError?.message || t("auth.errTrainerSignupFailed");
            throw new Error(msg);
          }
        }

        toast.success(t("auth.signupCompleted"));
        navigate(redirectParam || (isTrainer ? "/onboarding" : "/join"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate(redirectParam || "/");
      }
    } catch (err) {
      const msg = err.message || "";
      console.error("Auth error:", msg);
      const localized =
        msg.includes("Invalid login credentials")
          ? t("auth.errInvalidCredentials")
        : msg.includes("Email not confirmed")
          ? t("auth.errEmailNotConfirmed")
        : msg.includes("User already registered")
          ? t("auth.errUserAlreadyRegistered")
        : msg.includes("Password should be at least")
          ? t("auth.errPasswordPolicy")
        : msg.includes("Unable to validate email")
          ? t("auth.errInvalidEmail")
        : msg.includes("Email rate limit exceeded")
          ? t("auth.errRateLimit")
        : (msg.includes("password") && msg.includes("breach"))
          ? t("auth.errPasswordBreached")
        : (msg.toLowerCase().includes("weak") || msg.toLowerCase().includes("easy to guess"))
          ? t("auth.errPasswordWeak")
        : t("auth.errGeneric", { message: msg });
      toast.error(localized);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-start px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md space-y-6 slide-up mx-auto my-auto">
        <div className="text-center flex flex-col items-center gap-1">
          <img src={gymboardLogo} alt={t("auth.logoAlt")} className="h-20 w-auto object-contain" />
          <h1 className="text-2xl font-bold tracking-tight mt-1">{t("auth.appTitle")}</h1>
          <p className="text-xs text-muted-foreground">{t("auth.appTagline")}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {mode === "login" ? t("auth.modeLogin") : mode === "signup" ? t("auth.modeSignup") : t("auth.modeForgot")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-xl">
          <button
            type="button"
            onClick={() => { setLoginTarget("customer"); setMode("login"); }}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-all ${
              !isTrainer ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Dumbbell className="w-4 h-4" />
            {t("auth.tabCustomer")}
          </button>
          <button
            type="button"
            onClick={() => { setLoginTarget("trainer"); setMode("login"); }}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-all ${
              isTrainer ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Shield className="w-4 h-4" />
            {t("auth.tabTrainer")}
          </button>
        </div>

        <Card>
          <CardContent className="p-6">
            {mode === "forgot" ? (
              forgotSent ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm leading-relaxed">{t("auth.forgotSentTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("auth.forgotSentNote")}</p>
                  <button
                    type="button"
                    onClick={() => { setMode("login"); setForgotSent(false); }}
                    className="text-sm text-accent hover:underline transition-colors font-medium"
                  >
                    {t("auth.backToLogin")}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <p className="text-sm text-muted-foreground leading-relaxed">{t("auth.forgotIntro")}</p>
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold">{t("auth.labelEmail")}</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t("auth.emailPlaceholder")}
                        className="w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>
                  <Button type="submit" variant="accent" className="w-full" disabled={loading}>
                    {loading ? t("common.processing") : t("auth.submitSend")}
                  </Button>
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setMode("login")}
                      className="text-sm text-muted-foreground hover:text-foreground underline transition-colors"
                    >
                      {t("auth.backToLogin")}
                    </button>
                  </div>
                </form>
              )
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">{t("auth.labelName")}</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={t("auth.namePlaceholder")}
                      className="w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-bold">{t("auth.labelEmail")}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("auth.emailPlaceholder")}
                    className="w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold">{t("auth.labelPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("auth.passwordPlaceholder")}
                    minLength={6}
                    className="w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                  />
                </div>
                {mode === "signup" && (
                  <p className="text-xs text-muted-foreground mt-1">{t("auth.signupPasswordHint")}</p>
                )}
                {mode === "login" && (
                  <div className="text-right pt-1">
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                    >
                      {t("auth.forgotLink")}
                    </button>
                  </div>
                )}
              </div>

              {mode === "signup" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">{t("auth.labelPasswordConfirm")}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="password"
                      required
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      placeholder={t("auth.passwordPlaceholder")}
                      minLength={6}
                      className={`w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 transition-all placeholder:text-muted-foreground ${
                        passwordMismatch ? "ring-2 ring-destructive/50 focus:ring-destructive/50" : "focus:ring-accent/30"
                      }`}
                    />
                  </div>
                  {passwordMismatch && (
                    <p className="text-xs text-destructive font-medium">{t("auth.passwordMismatch")}</p>
                  )}
                </div>
              )}

              <Button type="submit" variant="accent" className="w-full" disabled={loading || passwordMismatch}>
                {loading ? t("common.processing") : mode === "login" ? t("auth.submitLogin") : t("auth.submitSignup")}
              </Button>
            </form>
            )}

            {/* ソーシャルログインは顧客タブのみ表示。トレーナーはロール付与のためメール登録を使う。 */}
            {!isTrainer && mode !== "forgot" && (
              <div className="mt-5">
                <SocialAuthButtons redirectParam={redirectParam} />
              </div>
            )}

            {mode !== "forgot" && (
            <div className="mt-4 text-center">
              {isTrainer ? (
                <button
                  type="button"
                  onClick={() => setMode(mode === "login" ? "signup" : "login")}
                  className="text-sm text-accent hover:underline transition-colors font-medium"
                >
                  {mode === "login" ? t("auth.switchToTrainerSignup") : t("auth.switchToLoginExisting")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setMode(mode === "login" ? "signup" : "login")}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {mode === "login" ? t("auth.switchToSignupCustomer") : t("auth.switchToLoginExisting")}
                </button>
              )}
            </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          {mode === "signup" && (
            <p className="mb-2">{t("auth.signupAgreement")}</p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <Link to="/terms" className="hover:text-accent underline transition-colors">{t("auth.linkTerms")}</Link>
            <span>·</span>
            <Link to="/privacy" className="hover:text-accent underline transition-colors">{t("auth.linkPrivacy")}</Link>
            <span>·</span>
            <Link to="/tokushoho" className="hover:text-accent underline transition-colors">{t("auth.linkTokushoho")}</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
