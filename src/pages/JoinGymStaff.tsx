/**
 * スタッフとしてジムに参加するページ（/join-staff/:code）。
 *
 * お客様の加入ページ（JoinGym）とは**別ページ・別コード**にしている。
 * 同じ導線に混ぜると、お客様に配ったリンクからスタッフ権限（顧客データ全件が
 * 見える）に入れてしまう事故が起きうるため。
 *
 * 実際の加入は SECURITY DEFINER の RPC
 * `join_tenant_as_staff_with_invite_code` が行う。クライアントから
 * tenant_members に role='trainer' の行を作ることはできない
 * （20260803120000_tenant_members_write_scope.sql で塞いである）。
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Search, MapPin, CheckCircle2, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
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

const JoinGymStaff = () => {
  const { t } = useTranslation();
  const { code: codeParam } = useParams<{ code?: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState(codeParam || "");
  const [searching, setSearching] = useState(false);
  const [tenant, setTenant] = useState<FoundTenant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"search" | "join" | "done">("search");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const target = codeParam ? `/join-staff/${codeParam}` : "/join-staff";
      navigate(`/auth?redirect=${encodeURIComponent(target)}`, { replace: true });
    }
  }, [user, authLoading, navigate, codeParam]);

  const handleSearch = async (raw: string) => {
    const cleaned = raw.replace(/-/g, "").trim().toLowerCase();
    if (!cleaned) {
      setError(t("joinGym.errEmptyCode"));
      return;
    }
    setSearching(true);
    setError(null);
    setTenant(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("lookup_tenant_by_staff_invite_code", { p_code: cleaned });
      if (rpcErr) throw rpcErr;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) setError(t("joinGym.errCodeNotFound"));
      else setTenant(row as FoundTenant);
    } catch (err) {
      setError((err as Error).message || t("joinGym.errSearchFailed"));
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (user && codeParam && !tenant && !error) void handleSearch(codeParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, codeParam]);

  const handleJoin = async () => {
    if (!user || !tenant) return;
    if (!displayName.trim()) {
      toast({ title: t("joinGym.toastEmptyName"), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { error: rpcErr } = await supabase.rpc("join_tenant_as_staff_with_invite_code", {
        p_code: code.replace(/-/g, "").trim().toLowerCase() || (codeParam ?? ""),
        p_display_name: displayName.trim(),
      });
      if (rpcErr) throw rpcErr;
      setStep("done");
    } catch (err) {
      // RPC が返すメッセージはそのまま出す。「別のジムに参加済み」「お客様として
      // 登録済み」など、原因ごとに次にすべきことが違うため、一律の文言に丸めない。
      toast({
        title: t("staff.joinFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <DumbbellLoader className="w-16 h-16 text-accent" />
      </div>
    );
  }

  const accent = tenant?.primary_color || undefined;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-4 py-8" style={{ overflowX: "hidden" }}>
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">{t("staff.joinPageTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("staff.joinPageSubtitle")}</p>
        </div>

        <div className="bg-card border rounded-2xl shadow-sm p-6 space-y-4">
          {step === "done" ? (
            <div className="text-center space-y-4">
              <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
              <p className="text-base font-semibold break-all">
                {t("staff.joinedTitle", { name: tenant?.gym_name ?? "" })}
              </p>
              <p className="text-sm text-muted-foreground">{t("staff.joinedNote")}</p>
              <Button className="w-full" onClick={() => navigate("/", { replace: true })}>
                {t("joinGym.backHome")}
              </Button>
            </div>
          ) : !tenant ? (
            <>
              <p className="text-sm text-muted-foreground">{t("staff.joinIntro")}</p>
              <div>
                <Label>{t("staff.labelCode")}</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t("staff.codePlaceholder")}
                  className="text-center text-lg tracking-widest font-mono"
                  maxLength={40}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button onClick={() => handleSearch(code)} disabled={searching} className="w-full">
                {searching ? <DumbbellLoader className="w-4 h-4 mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                {t("joinGym.search")}
              </Button>
            </>
          ) : step === "search" ? (
            <div className="space-y-4">
              <div className="text-center space-y-3">
                {tenant.logo_url ? (
                  <img src={tenant.logo_url} alt={tenant.gym_name} className="w-20 h-20 mx-auto rounded-xl object-cover border" />
                ) : (
                  <div className="w-20 h-20 mx-auto rounded-xl flex items-center justify-center" style={{ background: accent ? `${accent}20` : undefined }}>
                    <UserPlus className="w-10 h-10 text-accent" />
                  </div>
                )}
                <h2 className="text-xl font-bold break-all">{tenant.gym_name}</h2>
                {tenant.address && (
                  <p className="text-sm text-muted-foreground flex items-center justify-center gap-1 break-all">
                    <MapPin className="w-4 h-4 shrink-0" /> {tenant.address}
                  </p>
                )}
              </div>
              <p className="text-sm text-center">{t("staff.confirmJoin")}</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setTenant(null); setCode(""); }}>
                  {t("joinGym.otherCode")}
                </Button>
                <Button
                  className="flex-1"
                  style={accent ? { background: accent, color: "#fff" } : undefined}
                  onClick={() => setStep("join")}
                >
                  {t("joinGym.join")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <UserPlus className="w-8 h-8 mx-auto text-accent" />
                <p className="font-bold break-all">{t("staff.joiningTitle", { name: tenant.gym_name })}</p>
                <p className="text-sm text-muted-foreground">{t("staff.joiningHint")}</p>
              </div>
              <div>
                <Label>{t("staff.labelDisplayName")}</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("staff.displayNamePlaceholder")}
                  maxLength={50}
                />
              </div>
              <Button
                className="w-full"
                style={accent ? { background: accent, color: "#fff" } : undefined}
                onClick={handleJoin}
                disabled={submitting}
              >
                {submitting && <DumbbellLoader className="w-4 h-4 mr-2" />}
                {t("staff.joinButton")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default JoinGymStaff;
