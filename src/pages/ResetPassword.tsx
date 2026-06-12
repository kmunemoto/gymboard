import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import gymboardLogo from "@/assets/gymboard-logo.png";

const VERIFY_TIMEOUT_MS = 10_000;

const ResetPassword = () => {
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

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const expire = (msg?: string) => {
      setLinkExpired(true);
      setError(
        msg ||
          "リンクの有効期限が切れています。お手数ですがもう一度パスワードリセットをやり直してください。",
      );
    };

    // Listen for PASSWORD_RECOVERY in case Supabase parses a hash-based link
    // (legacy/implicit flow) before we get a chance to inspect URL params.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });

    let timer: number | undefined;

    (async () => {
      try {
        // 1) token_hash flow (new): /reset-password?token_hash=...&type=recovery
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

        // 2) PKCE flow (?code=...) — only works in same browser that initiated
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

        // 3) Implicit/hash flow — supabase-js handles it; check existing session
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setReady(true);
          return;
        }

        // 4) Wait a short while for PASSWORD_RECOVERY from a hash, then give up
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
      toast.error("パスワードは6文字以上にしてください");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      await supabase.auth.signOut();
    } catch (err: any) {
      const msg = err.message || "";
      setError(
        msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("invalid")
          ? "リンクの有効期限が切れています。もう一度パスワードリセットを行ってください。"
          : `エラーが発生しました: ${msg}`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-start px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md space-y-6 slide-up mx-auto my-auto">
        <div className="text-center flex flex-col items-center gap-1">
          <img src={gymboardLogo} alt="ジムボード" className="h-20 w-auto object-contain" />
          <h1 className="text-2xl font-bold tracking-tight mt-1">新しいパスワードの設定</h1>
        </div>

        <Card>
          <CardContent className="p-6">
            {done ? (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="w-12 h-12 text-accent mx-auto" />
                <p className="text-sm">
                  パスワードを変更しました。新しいパスワードでログインしてください。
                </p>
                <Button variant="accent" className="w-full" onClick={() => navigate("/auth")}>
                  ログインへ
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
                  パスワードリセットをやり直す
                </Button>
                <Link
                  to="/auth"
                  className="text-sm text-muted-foreground hover:text-foreground underline block"
                >
                  ログインへ戻る
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  新しいパスワードを入力してください（6文字以上）。
                </p>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold">新しいパスワード</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type={show ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="6文字以上"
                      minLength={6}
                      className="w-full bg-secondary rounded-xl pl-10 pr-10 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={show ? "パスワードを隠す" : "パスワードを表示"}
                    >
                      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && <p className="text-xs text-destructive font-medium">{error}</p>}
                {!ready && !error && (
                  <p className="text-xs text-muted-foreground">
                    リンクを確認しています…
                  </p>
                )}

                <Button
                  type="submit"
                  variant="accent"
                  className="w-full"
                  disabled={loading || !ready}
                >
                  {loading ? "処理中..." : "パスワードを変更する"}
                </Button>

                <div className="text-center">
                  <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground underline">
                    ログインへ戻る
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
