import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

// 型定義（supabase.auth.oauth はベータのため明示的にラップする）
type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{
    data: {
      client?: { name?: string; logo_uri?: string } | null;
      redirect_url?: string | null;
      redirect_to?: string | null;
    } | null;
    error: { message: string } | null;
  }>;
  approveAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string | null; redirect_to?: string | null } | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string | null; redirect_to?: string | null } | null;
    error: { message: string } | null;
  }>;
};

const oauth = (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;

interface AuthDetails {
  client?: { name?: string; logo_uri?: string } | null;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("認可IDが指定されていません。");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?redirect=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("認可サーバーからのリダイレクト先がありませんでした。");
      return;
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 space-y-3">
            <h1 className="text-lg font-semibold">連携リクエストを読み込めませんでした</h1>
            <p className="text-sm text-muted-foreground break-all">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <DumbbellLoader className="w-8 h-8 text-accent" />
      </div>
    );
  }

  const clientName = details.client?.name ?? "外部アプリ";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-5">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold break-all">
              「{clientName}」をアカウントに連携しますか？
            </h1>
            <p className="text-sm text-muted-foreground">
              このアプリがあなたとしてSalute御所南のデータ（予約・プロフィール・測定履歴）を読み取れるようになります。
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button disabled={busy} onClick={() => decide(true)}>
              許可する
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
              拒否する
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
