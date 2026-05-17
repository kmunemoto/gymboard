import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const AuthCallback = () => {
  const hasHandledRef = useRef(false);

  useEffect(() => {
    if (hasHandledRef.current) return;
    hasHandledRef.current = true;

    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (!code) {
        window.location.replace("/auth");
        return;
      }

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
      } catch (err) {
        console.error("[AuthCallback] Unexpected error:", err);
        window.location.replace("/auth");
      }
    };

    handleCallback();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto" />
        <p className="text-sm text-muted-foreground">認証処理中...</p>
      </div>
    </div>
  );
};

export default AuthCallback;
