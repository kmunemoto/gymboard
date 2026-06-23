import { supabase } from "@/integrations/supabase/client";
import { isNative, getAuthCallbackUrl } from "@/lib/nativeBridge";

export type OAuthProvider = "apple" | "google";

// Apple / Google などのソーシャルログインを開始する。
// Web: プロバイダへフルリダイレクトし、完了後 /auth/callback に戻る。
// ネイティブ: アプリ内ブラウザで開き、ディープリンク（app.gymboard.mobile://auth/callback）
//   経由でアプリに戻る。戻り処理は main.tsx の appUrlOpen リスナーが担う。
// 新規ユーザーには DB トリガ（handle_new_user_role）により customer ロールが付与される。
export async function signInWithOAuthProvider(provider: OAuthProvider) {
  const redirectTo = getAuthCallbackUrl();

  if (isNative()) {
    const { Browser } = await import("@capacitor/browser");
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (data?.url) {
      await Browser.open({ url: data.url });
    }
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });
  if (error) throw error;
}
