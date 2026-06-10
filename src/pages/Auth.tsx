import { useState } from "react";
import { useNavigate, Navigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Dumbbell, Mail, Lock, User, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import gymboardLogo from "@/assets/gymboard-logo.png";

type AuthMode = "login" | "signup" | "forgot";
type LoginTarget = "customer" | "trainer";

import { getAuthCallbackUrl } from "@/lib/nativeBridge";

const EMAIL_CALLBACK_URL = getAuthCallbackUrl();

const Auth = () => {
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
        const redirectTo = `${window.location.origin}/reset-password`;
        // Always show success to avoid leaking whether the email is registered.
        await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      } catch (err: any) {
        console.warn("resetPasswordForEmail error (suppressed):", err?.message);
      } finally {
        setForgotSent(true);
        setLoading(false);
      }
      return;
    }
    if (mode === "signup") {
      if (password.length < 6) {
        toast.error("パスワードは6文字以上にしてください");
        return;
      }
      if (password !== passwordConfirm) {
        toast.error("パスワードが一致しません");
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

        // Email confirmation is required. Supabase returns a user without a
        // session in this case; the trainer role is assigned post-confirmation
        // by AuthContext (which calls signup-trainer once the user signs in
        // with a confirmed email and `user_metadata.role === "trainer"`).
        if (!authData.session) {
          toast.success(
            "確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。",
            { duration: 8000 },
          );
          // Reset sensitive fields and switch back to login mode so the user
          // can sign in after confirming.
          setPassword("");
          setPasswordConfirm("");
          setMode("login");
          return;
        }

        // Fallback path: email confirmation is disabled and a session already
        // exists. Promote to trainer immediately if requested.
        if (isTrainer) {
          const { data: roleData, error: roleError } = await supabase.functions.invoke(
            "signup-trainer",
            { body: {} },
          );
          if (roleError || (roleData && (roleData as any).error)) {
            const msg = (roleData as any)?.error || roleError?.message || "トレーナー登録に失敗しました。";
            throw new Error(msg);
          }
        }

        toast.success("アカウントを作成しました。");
        navigate(redirectParam || (isTrainer ? "/onboarding" : "/join"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate(redirectParam || "/");
      }
    } catch (err: any) {
      const msg = err.message || "";
      console.error("Auth error:", msg);
      const jaMessage =
        msg.includes("Invalid login credentials")
          ? "メールアドレスまたはパスワードが正しくありません。入力内容をご確認ください。"
        : msg.includes("Email not confirmed")
          ? "メールアドレスが未確認です。受信トレイをご確認ください。"
        : msg.includes("User already registered")
          ? "このメールアドレスは既に登録されています。"
        : msg.includes("Password should be at least")
          ? "パスワードは6文字以上で入力してください。"
        : msg.includes("Unable to validate email")
          ? "有効なメールアドレスを入力してください。"
        : msg.includes("Email rate limit exceeded")
          ? "送信回数の上限に達しました。しばらく時間をおいてお試しください。"
        : (msg.includes("password") && msg.includes("breach"))
          ? "このパスワードは過去に漏洩が確認されています。別のパスワードをお試しください。"
        : (msg.toLowerCase().includes("weak") || msg.toLowerCase().includes("easy to guess"))
          ? "このパスワードは推測されやすいため、より複雑なパスワード（英数字の組み合わせなど）をお試しください。"
        : `エラーが発生しました: ${msg}`;
      toast.error(jaMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-start px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md space-y-6 slide-up mx-auto my-auto">
        {/* Logo & Title */}
        <div className="text-center flex flex-col items-center gap-1">
          <img src={gymboardLogo} alt="ジムボード" className="h-20 w-auto object-contain" />
          <h1 className="text-2xl font-bold tracking-tight mt-1">ジムボード</h1>
          <p className="text-xs text-muted-foreground">パーソナルジム・ピラティス予約管理</p>
          <p className="text-sm text-muted-foreground mt-2">
            {mode === "login" ? "アカウントにログイン" : mode === "signup" ? "新規アカウント作成" : "パスワードの再設定"}
          </p>
        </div>

        {/* Login target tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-xl">
          <button
            type="button"
            onClick={() => { setLoginTarget("customer"); setMode("login"); }}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-all ${
              !isTrainer ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Dumbbell className="w-4 h-4" />
            お客様
          </button>
          <button
            type="button"
            onClick={() => { setLoginTarget("trainer"); setMode("login"); }}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-all ${
              isTrainer ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Shield className="w-4 h-4" />
            ジムオーナー
          </button>
        </div>

        <Card>
          <CardContent className="p-6">
            {mode === "forgot" ? (
              forgotSent ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm leading-relaxed">
                    メールを送信しました。届いたメール内のリンクからパスワードを再設定してください。
                  </p>
                  <p className="text-xs text-muted-foreground">
                    メールが届かない場合は、迷惑メールフォルダをご確認ください。
                  </p>
                  <button
                    type="button"
                    onClick={() => { setMode("login"); setForgotSent(false); }}
                    className="text-sm text-accent hover:underline transition-colors font-medium"
                  >
                    ログインへ戻る
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    ご登録のメールアドレスを入力してください。パスワード再設定用のリンクをお送りします。
                  </p>
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold">メールアドレス</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="mail@example.com"
                        className="w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>
                  <Button type="submit" variant="accent" className="w-full" disabled={loading}>
                    {loading ? "処理中..." : "送信する"}
                  </Button>
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setMode("login")}
                      className="text-sm text-muted-foreground hover:text-foreground underline transition-colors"
                    >
                      ログインへ戻る
                    </button>
                  </div>
                </form>
              )
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">お名前</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="お名前"
                      className="w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-bold">メールアドレス</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="mail@example.com"
                    className="w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold">パスワード</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="6文字以上"
                    minLength={6}
                    className="w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                  />
                </div>
                {mode === "signup" && (
                  <p className="text-xs text-muted-foreground mt-1">※パスワードは6文字以上で、推測されにくいものを設定してください</p>
                )}
                {mode === "login" && (
                  <div className="text-right pt-1">
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                    >
                      パスワードをお忘れの方はこちら
                    </button>
                  </div>
                )}
              </div>

              {mode === "signup" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">パスワード（確認用）</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="password"
                      required
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      placeholder="6文字以上"
                      minLength={6}
                      className={`w-full bg-secondary rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 transition-all placeholder:text-muted-foreground ${
                        passwordMismatch ? "ring-2 ring-destructive/50 focus:ring-destructive/50" : "focus:ring-accent/30"
                      }`}
                    />
                  </div>
                  {passwordMismatch && (
                    <p className="text-xs text-destructive font-medium">パスワードが一致しません</p>
                  )}
                </div>
              )}

              <Button type="submit" variant="accent" className="w-full" disabled={loading || passwordMismatch}>
                {loading ? "処理中..." : mode === "login" ? "ログイン" : "アカウント作成"}
              </Button>
            </form>
            )}

            {mode !== "forgot" && (
            <div className="mt-4 text-center">
              {isTrainer ? (
                <button
                  type="button"
                  onClick={() => setMode(mode === "login" ? "signup" : "login")}
                  className="text-sm text-accent hover:underline transition-colors font-medium"
                >
                  {mode === "login"
                    ? "ジムオーナーの方はこちらから新規登録"
                    : "すでにアカウントをお持ちの方はこちら"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setMode(mode === "login" ? "signup" : "login")}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {mode === "login"
                    ? "アカウントをお持ちでない方はこちら"
                    : "すでにアカウントをお持ちの方はこちら"}
                </button>
              )}
            </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          {mode === "signup" && (
            <p className="mb-2">アカウント作成により、以下に同意したものとみなされます。</p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <Link to="/terms" className="hover:text-accent underline transition-colors">利用規約</Link>
            <span>·</span>
            <Link to="/privacy" className="hover:text-accent underline transition-colors">プライバシーポリシー</Link>
            <span>·</span>
            <Link to="/tokushoho" className="hover:text-accent underline transition-colors">特定商取引法に基づく表記</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
