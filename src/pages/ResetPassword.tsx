import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import gymboardLogo from "@/assets/gymboard-logo.png";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Supabase parses the recovery token from the URL hash and emits
    // PASSWORD_RECOVERY. Also check existing session for direct navigations.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
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
