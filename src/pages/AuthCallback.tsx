import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

const AuthCallback = () => {
  const { t } = useTranslation();
  const hasHandledRef = useRef(false);

  useEffect(() => {
    if (hasHandledRef.current) return;
    hasHandledRef.current = true;

    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const type = params.get("type");
      const next = params.get("next");

      if (tokenHash && type) {
        try {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as any,
          });
          if (error) {
            console.error("[AuthCallback] verifyOtp error:", error.message);
            window.location.replace(`/auth?error=${encodeURIComponent(error.message)}`);
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
          window.location.replace("/auth");
          return;
        }
      }

      if (code) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error("[AuthCallback] Code exchange error:", error.message);
            window.location.replace("/auth");
            return;
          }
          if (!data.session) {
            for (let i = 0; i < 5; i += 1) {
              const { data: sessionData } = await supabase.auth.getSession();
              if (sessionData.session) break;
              await new Promise((resolve) => window.setTimeout(resolve, 250));
            }
          }
          window.location.replace("/");
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
          window.location.replace("/");
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
        <DumbbellLoader className="w-8 h-8 text-accent mx-auto" />
        <p className="text-sm text-muted-foreground">{t("authCallback.processing")}</p>
      </div>
    </div>
  );
};

export default AuthCallback;
