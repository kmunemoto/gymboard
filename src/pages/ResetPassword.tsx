import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import gymboardLogo from "@/assets/gymboard-logo.png";

const VERIFY_TIMEOUT_MS = 10_000;

const ResetPassword = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);
  const ran = useRef(false);
  // 招待メール（CSV で取り込んだ顧客へのアカウント引き渡し）から来た場合。
  // 仕組みはパスワード再設定と同一で、見出しと説明文だけ「はじめて」の文面にする
  const isInvite = searchParams.get("flow") === "invite";

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const expire = (msg?: string) => {
      setLinkExpired(true);
      setError(msg || t("resetPassword.errExpiredDefault"));
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });

    let timer: number | undefined;

    (async () => {
      try {
        const tokenHash = searchParams.get("token_hash");
        const typeParam = searchParams.get("type");
        if (tokenHash) {
          timer = window.setTimeout(() => {
            if (!ready) expire();
          }, VERIFY_TIMEOUT_MS);

          const { error: vErr } = await supabase.auth.verifyOtp({
            type: (typeParam as "recovery") || "recovery",
            token_hash: tokenHash,
          });
          window.clearTimeout(timer);
          if (vErr) {
            expire();
          } else {
            setReady(true);
          }
          return;
        }

        const code = searchParams.get("code");
        if (code) {
          timer = window.setTimeout(() => {
            if (!ready) expire();
          }, VERIFY_TIMEOUT_MS);
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          window.clearTimeout(timer);
          if (exErr) {
            expire();
          } else {
            setReady(true);
          }
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setReady(true);
          return;
        }

        timer = window.setTimeout(() => {
          if (!ready) expire();
        }, VERIFY_TIMEOUT_MS);
      } catch {
        if (timer) window.clearTimeout(timer);
        expire();
      }
    })();

    return () => {
      subscription.unsubscribe();
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error(t("resetPassword.errPasswordTooShort"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      await supabase.auth.signOut();
    } catch (err) {
      const msg = err.message || "";
      setError(
        msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("invalid")
          ? t("resetPassword.errExpiredOnSubmit")
          : t("resetPassword.errGeneric", { message: msg }),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-start px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md space-y-6 slide-up mx-auto my-auto">
        <div className="text-center flex flex-col items-center gap-1">
          <img src={gymboardLogo} alt={t("resetPassword.logoAlt")} className="h-20 w-auto object-contain" />
          <h1 className="text-2xl font-bold tracking-tight mt-1">{t(isInvite ? "resetPassword.inviteTitle" : "resetPassword.title")}</h1>
        </div>

        <Card>
          <CardContent className="p-6">
            {done ? (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="w-12 h-12 text-accent mx-auto" />
                <p className="text-sm">{t("resetPassword.doneMessage")}</p>
                <Button variant="accent" className="w-full" onClick={() => navigate("/auth")}>
                  {t("resetPassword.toLogin")}
                </Button>
              </div>
            ) : linkExpired ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-destructive font-medium">{error}</p>
                <Button
                  variant="accent"
                  className="w-full"
                  onClick={() => navigate("/auth?mode=forgot")}
                >
                  {t("resetPassword.retryReset")}
                </Button>
                <Link
                  to="/auth"
                  className="text-sm text-muted-foreground hover:text-foreground underline block"
                >
                  {t("resetPassword.backToLogin")}
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-muted-foreground">{t(isInvite ? "resetPassword.inviteIntro" : "resetPassword.intro")}</p>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">{t("resetPassword.labelNewPassword")}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type={show ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("resetPassword.placeholder")}
                      minLength={6}
                      className="w-full bg-secondary rounded-xl pl-10 pr-10 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={show ? t("resetPassword.hidePassword") : t("resetPassword.showPassword")}
                    >
                      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && <p className="text-xs text-destructive font-medium">{error}</p>}
                {!ready && !error && (
                  <p className="text-xs text-muted-foreground">{t("resetPassword.verifyingLink")}</p>
                )}

                <Button
                  type="submit"
                  variant="accent"
                  className="w-full"
                  disabled={loading || !ready}
                >
                  {loading ? t("resetPassword.processing") : t("resetPassword.submit")}
                </Button>

                <div className="text-center">
                  <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground underline">
                    {t("resetPassword.backToLogin")}
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ResetPassword;
