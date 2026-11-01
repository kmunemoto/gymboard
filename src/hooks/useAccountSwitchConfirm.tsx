import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * メールのログイン用リンク（token_hash）を開いたとき、すでに誰かがログインしていたら、
 * 切り替える前に確かめる（2026-11-01 点検 auth-callback-session-1）。
 *
 * 他人が「自分のアカウントのリンク」を送りつけて開かせると、今まではそのアカウントに黙って切り替わった。
 * そっくりのジムを作っておけば、本人は気づかずに体重・写真・相談を入力し、それが相手のジムに入る。
 * リンクの持ち主は確かめる前（verifyOtp の前）には分からないので、「今のアカウント」を見せて選んでもらう。
 *
 * - ログインしていなければ、何も出さずに true（今まで通り）
 * - 「今のアカウントのまま」・Esc・外側のクリックは false（リンクを使わない）
 */
export function useAccountSwitchConfirm() {
  const { t } = useTranslation();
  // null: 閉じている / "": メールアドレスの無いアカウント / それ以外: 今のアカウントのメールアドレス
  const [current, setCurrent] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirmSwitch = useCallback(async (): Promise<boolean> => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return true;
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setCurrent(user.email ?? "");
    });
  }, []);

  const answer = (ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setCurrent(null);
    resolve?.(ok);
  };

  const dialog = (
    <AlertDialog open={current !== null} onOpenChange={(open) => { if (!open) answer(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("authCallback.switchTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {current ? t("authCallback.switchBody", { email: current }) : t("authCallback.switchBodyNoEmail")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>{t("authCallback.switchStay")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => answer(true)}>{t("authCallback.switchContinue")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmSwitch, dialog };
}
