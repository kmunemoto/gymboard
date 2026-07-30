import { useEffect, useRef, useState } from "react";
import { useNavigate, Navigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Dumbbell, Mail, Lock, User, Shield, Eye, EyeOff, MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import SocialAuthButtons from "@/components/SocialAuthButtons";
import { SOCIAL_LOGIN_ENABLED } from "@/lib/featureFlags";
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
  /**
   * 「確認メールを送信した（＝まだログインできない）」ことを画面に残すためのフラグ。
   * 以前はトーストを出して setMode("login") でログイン画面に戻していたが、
   * 画面が「メール入力済み・パスワード空・アカウントにログイン」に化けるため
   * 登録失敗と区別が付かず、下に出る小さなトーストも見落とされていた。
   * パスワード再設定側（forgotSent）と同じく、カードの中身をパネルに差し替える。
   */
  const [signupSent, setSignupSent] = useState<null | { email: string }>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectParam = searchParams.get("redirect");

  // パネルへフォーカスを移す。押した送信ボタンが unmount されるため、
  // 何もしないとフォーカスが body に落ちてスクリーンリーダーのカーソルが行方不明になる。
  // hooks は下の早期 return より前に置くこと（authLoading が切り替わった瞬間に
  // 「Rendered more hooks than expected」で白画面になる）。
  const sentPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (signupSent) sentPanelRef.current?.focus();
  }, [signupSent]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <DumbbellLoader className="w-16 h-16 text-accent" />
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
        // 現在のオリジンの /reset-password に戻す（固定の lovable ドメインだと
        // 独自ドメインやプレビュー環境で誤った場所に遷移してしまうため）。
        const redirectTo = `${window.location.origin}/reset-password`;
        await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      } catch (err) {
        console.warn("resetPasswordForEmail error (suppressed):", err instanceof Error ? err.message : String(err));
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
          // トーストは出さない。画面下部に8秒だけ出る小さな板は見落とされ、
          // しかもログイン画面に戻すと「登録できなかった」ように見えてしまう。
          // カード内をパネルに差し替えて、自分で閉じるまで残す。
          setPassword("");
          setPasswordConfirm("");
          setSignupSent({ email });
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
      const msg = err instanceof Error ? err.message : String(err ?? "");
      console.error("Auth error:", msg);
      // 「メール未確認でログインできない」も同じパネルで返す。
      // ここをトーストにしていると、確認メールの案内を見落とした人が
      // そのままログインを試し、その失敗理由も同じ場所で見落とす、という
      // 同じ壁を2枚続けて踏むことになる。
      if (msg.includes("Email not confirmed")) {
        setPassword("");
        setSignupSent({ email });
        return;
      }
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
          <p className="text-sm text-foreground/70">{t("auth.appTagline")}</p>
          {/* 送信済みパネル中はモード名を出さない。パネルの見出しが
              「確認メールを送信しました」なのに、その上に「新規アカウント作成」や
              「アカウントにログイン」が残ると、まだ入力が必要なように読める。 */}
          {!signupSent && (
            <p className="text-sm text-muted-foreground mt-2">
              {mode === "login" ? t("auth.modeLogin") : mode === "signup" ? t("auth.modeSignup") : t("auth.modeForgot")}
            </p>
          )}
        </div>

        {/* 送信済みパネルの表示中はタブ行を出さない。
            タブは setMode("login") を呼ぶだけなので、残しておくと1タップでパネルが消え、
            まさに直したかった「登録失敗に見えるログイン画面」に戻ってしまう。
            さらにタブを変えて同じメールで登録し直すと user_metadata.role が
            上書きされ、確認後にジムオーナーが顧客として扱われる事故につながる。 */}
        {!signupSent && (
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
        )}

        <Card>
          <CardContent className="p-6">
            {signupSent ? (
              <div
                ref={sentPanelRef}
                tabIndex={-1}
                className="space-y-4 text-center outline-none"
              >
                <MailCheck className="w-10 h-10 text-accent mx-auto" aria-hidden="true" />
                {/* 本文だけをライブリージョンに入れる。ボタンを含めると
                    スクリーンリーダーが操作を読み上げ直してしまう。 */}
                <div role="status" aria-live="polite" className="space-y-2">
                  <h2 className="text-base font-bold">{t("auth.signupSentTitle")}</h2>
                  <div className="space-y-0.5">
                    <p className="text-xs text-foreground/70">{t("auth.labelEmail")}</p>
                    <p className="text-sm font-bold break-all">{signupSent.email}</p>
                  </div>
                  <p className="text-sm leading-relaxed">{t("auth.signupSentNext")}</p>
                  <p className="text-sm text-foreground/80 leading-relaxed">{t("auth.signupSentNative")}</p>
                  <p className="text-sm text-foreground/80 leading-relaxed">{t("auth.forgotSentNote")}</p>
                </div>
                <Button
                  variant="accent"
                  className="w-full"
                  onClick={() => { setSignupSent(null); setMode("login"); }}
                >
                  {t("auth.backToLogin")}
                </Button>
              </div>
            ) : mode === "forgot" ? (
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
                    <label htmlFor="reset-email" className="text-sm font-bold">{t("auth.labelEmail")}</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        id="reset-email"
                        type="email"
                        required
                        autoComplete="email"
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
                  <label htmlFor="displayName" className="text-sm font-bold">{t("auth.labelName")}</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      id="displayName"
                      type="text"
                      autoComplete="name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={t("auth.namePlaceholder")}
                      className="w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-bold">{t("auth.labelEmail")}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("auth.emailPlaceholder")}
                    className="w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-bold">{t("auth.labelPassword")}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("auth.passwordPlaceholder")}
                    minLength={6}
                    className="w-full bg-secondary rounded-xl pl-10 pr-11 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("auth.passwordHide") : t("auth.passwordShow")}
                    aria-pressed={showPassword}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {mode === "signup" && (
                  <p className="text-xs text-muted-foreground mt-1">{t("auth.signupPasswordHint")}</p>
                )}
                {mode === "login" && (
                  <div className="text-right pt-1">
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="text-xs text-foreground/70 hover:text-foreground underline transition-colors"
                    >
                      {t("auth.forgotLink")}
                    </button>
                  </div>
                )}
              </div>

              {mode === "signup" && (
                <div className="space-y-1.5">
                  <label htmlFor="passwordConfirm" className="text-sm font-bold">{t("auth.labelPasswordConfirm")}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      id="passwordConfirm"
                      type={showPasswordConfirm ? "text" : "password"}
                      required
                      autoComplete="new-password"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      placeholder={t("auth.passwordPlaceholder")}
                      minLength={6}
                      className={`w-full bg-secondary rounded-xl pl-10 pr-11 py-2.5 text-sm outline-none focus:ring-2 transition-all placeholder:text-muted-foreground ${
                        passwordMismatch ? "ring-2 ring-destructive/50 focus:ring-destructive/50" : "focus:ring-accent/30"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordConfirm((v) => !v)}
                      aria-label={showPasswordConfirm ? t("auth.passwordHide") : t("auth.passwordShow")}
                      aria-pressed={showPasswordConfirm}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPasswordConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
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

            {/* ソーシャルログインは顧客・トレーナー両タブで表示。
                トレーナータブの場合は OAuth 後に signup-trainer で trainer ロールを付与する。 */}
            {mode !== "forgot" && !signupSent && SOCIAL_LOGIN_ENABLED && (
              <div className="mt-5">
                <SocialAuthButtons
                  redirectParam={redirectParam}
                  intendedRole={isTrainer ? "trainer" : "customer"}
                />
              </div>
            )}

            {/* パネル表示中は出口を「ログインへ戻る」1本に絞る。
                ここを残すと、確認前のユーザーをログインへ誘導する2つ目の出口になり、
                押した先で「メール未確認」の壁に当たる。 */}
            {mode !== "forgot" && !signupSent && (
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
          {mode === "signup" && !signupSent && (
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
