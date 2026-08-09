import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { sanitizeAuthNext } from "@/lib/nativeBridge";

const AuthCallback = () => {
  const { t } = useTranslation();
  const hasHandledRef = useRef(false);

  useEffect(() => {
    if (hasHandledRef.current) return;
    hasHandledRef.current = true;

    // トレーナータブから OAuth した場合、ここで trainer ロールを付与する。
    // OAuth はメール確認済みのため signup-trainer を呼べる（付与は冪等）。
    // 既存トレーナーの再ログインでも重複は無視されるので安全。
    const finalizePendingRole = async () => {
      const pendingRole = sessionStorage.getItem("pendingOAuthRole");
      sessionStorage.removeItem("pendingOAuthRole");
      if (pendingRole === "trainer") {
        const { error } = await supabase.functions.invoke("signup-trainer", { body: {} });
        if (error) console.warn("[AuthCallback] signup-trainer failed:", error.message);
      }
    };

    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const type = params.get("type");
      // next はメールのリンクにそのまま入っている＝攻撃者が細工できる。
      // 自オリジン/ネイティブアプリのスキーム以外は sanitizeAuthNext が破棄する
      // （オープンリダイレクト対策。詳細は nativeBridge.ts のコメント参照）。
      const next = sanitizeAuthNext(params.get("next"));

      if (tokenHash && type) {
        try {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as any,
          });
          if (error) {
            console.error("[AuthCallback] verifyOtp error:", error.message);
            // message は英文かつgotrueのバージョンで文言が変わりうるので、
            // 遷移先の Auth 画面には安定した code を渡す（無ければ generic）。
            const code = (error as { code?: string }).code || "generic";
            window.location.replace(`/auth?error=${encodeURIComponent(code)}`);
            return;
          }
          if (type === "recovery") {
            window.location.replace("/reset-password");
            return;
          }
          window.location.replace(next || "/");
          return;
        } catch (err) {
          console.error("[AuthCallback] verifyOtp unexpected error:", err);
          window.location.replace("/auth?error=generic");
          return;
        }
      }

      if (code) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            // ⚠️ **交換の失敗＝ログイン失敗、ではない。**
            //
            // flowType を 'pkce' にした（2026-08-09）ことで、supabase-js の
            // detectSessionInUrl（既定 true）が**クライアント初期化時に自分で
            // `?code=` を交換してしまう**経路が生きるようになった。
            // その場合ここは「code が既に使われている」で必ず失敗するが、
            // **セッションは既に確立している。**
            // ここで /auth に飛ばすと、ログインできているのにログイン画面に
            // 戻される（＝直したつもりで別の壊し方をする）。
            //
            // なので、諦める前にセッションの有無を実際に確かめる。
            let recovered = false;
            for (let i = 0; i < 5; i += 1) {
              const { data: sessionData } = await supabase.auth.getSession();
              if (sessionData.session) { recovered = true; break; }
              await new Promise((resolve) => window.setTimeout(resolve, 250));
            }
            if (!recovered) {
              console.error("[AuthCallback] Code exchange error:", error.message);
              window.location.replace("/auth");
              return;
            }
          } else if (!data.session) {
            for (let i = 0; i < 5; i += 1) {
              const { data: sessionData } = await supabase.auth.getSession();
              if (sessionData.session) break;
              await new Promise((resolve) => window.setTimeout(resolve, 250));
            }
          }
          await finalizePendingRole();
          // dest（sessionStorage）はアプリ自身が書いた値なので次のサニタイズ対象外。
          // next はURL由来なので、dest が無いときのフォールバックとしてのみ使う。
          const dest = sessionStorage.getItem("postAuthRedirect");
          sessionStorage.removeItem("postAuthRedirect");
          window.location.replace(dest || next || "/");
          return;
        } catch (err) {
          console.error("[AuthCallback] Unexpected error:", err);
          window.location.replace("/auth");
          return;
        }
      }

      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      if (hash) {
        const hashParams = new URLSearchParams(hash);
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const hashType = hashParams.get("type");
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            console.error("[AuthCallback] setSession error:", error.message);
            window.location.replace("/auth");
            return;
          }
          if (hashType === "recovery") {
            window.location.replace("/reset-password");
            return;
          }
          await finalizePendingRole();
          const dest = sessionStorage.getItem("postAuthRedirect");
          sessionStorage.removeItem("postAuthRedirect");
          window.location.replace(dest || "/");
          return;
        }
      }

      window.location.replace("/auth");
    };

    handleCallback();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <DumbbellLoader className="w-16 h-16 text-accent mx-auto" />
        <p className="text-sm text-muted-foreground">{t("authCallback.processing")}</p>
      </div>
    </div>
  );
};

export default AuthCallback;
