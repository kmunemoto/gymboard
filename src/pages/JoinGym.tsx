import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Search, MapPin, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

interface FoundTenant {
  id: string;
  gym_name: string;
  address: string | null;
  logo_url: string | null;
  primary_color: string | null;
}

const JoinGym = () => {
  const { code: codeParam } = useParams<{ code?: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState(codeParam || "");
  const [searching, setSearching] = useState(false);
  const [tenant, setTenant] = useState<FoundTenant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingMembership, setExistingMembership] = useState<{ gym_name: string } | null>(null);
  const [step, setStep] = useState<"search" | "join" | "done">("search");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auth + membership check
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const target = codeParam ? `/join/${codeParam}` : "/join";
      navigate(`/auth?redirect=${encodeURIComponent(target)}`, { replace: true });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("tenant_members")
        .select("tenant_id, tenants:tenant_id(gym_name)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (data) {
        const gymName = (data.tenants as any)?.gym_name ?? "あるジム";
        setExistingMembership({ gym_name: gymName });
      }
      setChecking(false);
    })();
  }, [user, authLoading, navigate, codeParam]);

  // Auto-search if code in URL
  useEffect(() => {
    if (!checking && codeParam && !tenant && !error && !existingMembership) {
      handleSearch(codeParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, codeParam, existingMembership]);

  const handleSearch = async (raw: string) => {
    const cleaned = raw.replace(/-/g, "").trim().toLowerCase();
    if (!cleaned) {
      setError("招待コードを入力してください");
      return;
    }
    setSearching(true);
    setError(null);
    setTenant(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("lookup_tenant_by_invite_code", { p_code: cleaned });
      if (rpcErr) throw rpcErr;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        setError("招待コードが見つかりません。トレーナーに確認してください。");
      } else {
        setTenant(row as FoundTenant);
      }
    } catch (err: any) {
      setError(err.message || "検索に失敗しました");
    } finally {
      setSearching(false);
    }
  };

  const handleJoin = async () => {
    if (!user || !tenant) return;
    if (!displayName.trim()) {
      toast({ title: "表示名を入力してください", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const name = displayName.trim();

      // 1. プロフィールの表示名を先に保存（upsert: 行が無くても作成）
      const { error: pErr } = await supabase
        .from("profiles")
        .upsert(
          { user_id: user.id, display_name: name },
          { onConflict: "user_id" }
        );
      if (pErr) throw pErr;

      // 2. テナントメンバー登録（upsert: 再参加でも重複エラーにならない）
      const { error: mErr } = await supabase
        .from("tenant_members")
        .upsert(
          {
            tenant_id: tenant.id,
            user_id: user.id,
            role: "customer",
            display_name: name,
            status: "active",
          },
          { onConflict: "tenant_id,user_id" }
        );
      if (mErr) throw mErr;

      toast({ title: `${tenant.gym_name}に参加しました！` });
      navigate("/", { replace: true });
    } catch (err: any) {
      toast({ title: "参加に失敗しました", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <DumbbellLoader className="w-8 h-8 text-accent" />
      </div>
    );
  }

  const accent = tenant?.primary_color || undefined;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-4 py-8" style={{ overflowX: "hidden" }}>
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">ジムボード</h1>
          <p className="text-sm text-muted-foreground mt-1">ジムに参加する</p>
        </div>

        <div className="bg-card border rounded-2xl shadow-sm p-6 space-y-4">
          {existingMembership ? (
            <div className="text-center space-y-4">
              <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
              <p className="text-base font-semibold break-all">
                既に「{existingMembership.gym_name}」に参加しています
              </p>
              <p className="text-sm text-muted-foreground">
                ※ Phase 1では1ユーザー1ジムまでです。
              </p>
              <Button className="w-full" onClick={() => navigate("/", { replace: true })}>
                ホームに戻る
              </Button>
            </div>
          ) : step === "search" && !tenant ? (
            <>
              <p className="text-sm text-muted-foreground">
                トレーナーから受け取った招待コードを入力してください。
              </p>
              <div>
                <Label>招待コード</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="XXXX-XXXX"
                  className="text-center text-lg tracking-widest font-mono"
                  maxLength={20}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button onClick={() => handleSearch(code)} disabled={searching} className="w-full">
                {searching ? <DumbbellLoader className="w-4 h-4 mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                検索
              </Button>
            </>
          ) : tenant && step === "search" ? (
            <div className="space-y-4">
              <div className="text-center space-y-3">
                {tenant.logo_url ? (
                  <img src={tenant.logo_url} alt={tenant.gym_name} className="w-20 h-20 mx-auto rounded-xl object-cover border" />
                ) : (
                  <div className="w-20 h-20 mx-auto rounded-xl flex items-center justify-center text-3xl" style={{ background: accent ? `${accent}20` : undefined }}>
                    🏋️
                  </div>
                )}
                <h2 className="text-xl font-bold break-all">{tenant.gym_name}</h2>
                {tenant.address && (
                  <p className="text-sm text-muted-foreground flex items-center justify-center gap-1 break-all">
                    <MapPin className="w-4 h-4 shrink-0" /> {tenant.address}
                  </p>
                )}
              </div>
              <p className="text-sm text-center">このジムに参加しますか？</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setTenant(null); setCode(""); }}>
                  別のコード
                </Button>
                <Button
                  className="flex-1"
                  style={accent ? { background: accent, color: "#fff" } : undefined}
                  onClick={() => setStep("join")}
                >
                  参加する
                </Button>
              </div>
            </div>
          ) : step === "join" && tenant ? (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <div className="text-3xl">🎉</div>
                <p className="font-bold break-all">「{tenant.gym_name}」に参加します</p>
                <p className="text-sm text-muted-foreground">
                  あなたの表示名を設定してください。<br />
                  （トレーナーに表示される名前です）
                </p>
              </div>
              <div>
                <Label>表示名</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="山田 太郎"
                  maxLength={50}
                />
              </div>
              <Button
                className="w-full"
                style={accent ? { background: accent, color: "#fff" } : undefined}
                disabled={submitting || !displayName.trim()}
                onClick={handleJoin}
              >
                {submitting && <DumbbellLoader className="w-4 h-4 mr-2" />}
                アプリを始める →
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setStep("search")}>
                戻る
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default JoinGym;
