import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { signInWithOAuthProvider, OAuthProvider } from "@/lib/oauth";

const AppleLogo = () => (
  <svg viewBox="0 0 384 512" className="w-4 h-4" fill="currentColor" aria-hidden="true">
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
  </svg>
);

const GoogleLogo = () => (
  <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

interface SocialAuthButtonsProps {
  redirectParam?: string | null;
  // OAuth 後に付与したいロール。trainer の場合は AuthCallback で signup-trainer を呼ぶ。
  intendedRole?: "customer" | "trainer";
}

const SocialAuthButtons = ({ redirectParam, intendedRole = "customer" }: SocialAuthButtonsProps) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  const handleSignIn = async (provider: OAuthProvider) => {
    if (pending) return;
    setPending(provider);
    try {
      if (redirectParam) {
        sessionStorage.setItem("postAuthRedirect", redirectParam);
      }
      // ロール意図を OAuth ラウンドトリップ間で引き継ぐ（同一オリジンの sessionStorage は往復後も保持される）。
      sessionStorage.setItem("pendingOAuthRole", intendedRole);
      await signInWithOAuthProvider(provider);
      // Web ではこの後フルリダイレクトが発生する。ネイティブはブラウザ復帰まで待機。
    } catch (err) {
      console.error("OAuth sign-in error:", err);
      toast.error(t("auth.socialError"));
      setPending(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">{t("auth.socialDivider")}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={() => handleSignIn("apple")}
        disabled={!!pending}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-black text-white py-2.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <AppleLogo />
        {t("auth.socialApple")}
      </button>

      <button
        type="button"
        onClick={() => handleSignIn("google")}
        disabled={!!pending}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-white text-foreground border border-border py-2.5 text-sm font-bold transition-colors hover:bg-secondary disabled:opacity-60"
      >
        <GoogleLogo />
        {t("auth.socialGoogle")}
      </button>
    </div>
  );
};

export default SocialAuthButtons;
