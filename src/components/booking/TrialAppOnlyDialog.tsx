import { useTranslation } from "react-i18next";
import { Smartphone, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STORE_URLS } from "@/lib/brand";
import { openExternalUrl } from "@/lib/nativeBridge";

/**
 * 体験予約ページ（/trial）で「会員の方はアプリからご予約ください」と案内する。
 *
 * 実店舗の要望（2026-09-19 宗本さん）:
 *
 * > すでに会員でアプリのアカウントもある方が、体験予約サイトから予約してしまう。
 * > 直接は言いにくいので、体験予約サイトからは予約できないようにして、
 * > アプリから予約するよう案内を出したい。
 *
 * ## 🔴 誰に出すかはここでは決めない
 *
 * 判定は本番DBの `trial_name_needs_app` RPC（`tenants.trial_app_only_names`）。
 * **単語リストはこのリポジトリにも、ブラウザに渡る JS にも1文字も置かない**
 * （public リポジトリなので、書けば実名がインターネットに公開される）。
 * 呼び出し側は「該当したか」だけを受け取り、この画面を出す。
 *
 * ## 出しかた
 *
 * - 送信のかわりに出す（予約は作らない）
 * - **必ず閉じられる**。人違い・同姓の可能性があるため、閉じて別の名前で
 *   やり直せる道を残す（`AppUpdateDialog` と同じ考え方）
 * - ストアのボタンは URL が空のフォークでは出さない（押しても何も起きないボタンを作らない）
 */
interface Props {
  gymName: string;
  onClose: () => void;
}

const TrialAppOnlyDialog = ({ gymName, onClose }: Props) => {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-app-only-title"
      data-testid="trial-app-only-dialog"
    >
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-xl animate-in zoom-in-95 duration-200">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Smartphone className="h-6 w-6 text-primary" />
        </div>
        <h2 id="trial-app-only-title" className="text-base font-bold text-foreground">
          {t("trialBooking.appOnlyTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("trialBooking.appOnlyBody", { gym: gymName })}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("trialBooking.appOnlyNote")}
        </p>

        {STORE_URLS.ios && (
          <Button
            className="mt-5 h-12 w-full rounded-full text-base font-bold"
            onClick={() => void openExternalUrl(STORE_URLS.ios)}
            data-testid="trial-app-only-ios"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {t("trialBooking.appOnlyIos")}
          </Button>
        )}
        {STORE_URLS.android && (
          <Button
            variant="outline"
            className="mt-3 h-12 w-full rounded-full text-base font-bold"
            onClick={() => void openExternalUrl(STORE_URLS.android)}
            data-testid="trial-app-only-android"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {t("trialBooking.appOnlyAndroid")}
          </Button>
        )}

        <button
          type="button"
          className="mt-4 w-full text-sm text-muted-foreground underline-offset-2 hover:underline"
          onClick={onClose}
          data-testid="trial-app-only-close"
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  );
};

export default TrialAppOnlyDialog;
