import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppUpdatePrompt } from "@/hooks/useAppUpdatePrompt";
import { openExternalUrl } from "@/lib/nativeBridge";

/**
 * 「新しい版が出ています。更新してください」のお願い。
 *
 * 実店舗の要望（2026-09-07 宗本さん）:
 *
 * > 新しいバージョンをアップロードして、まだアップデートしていないお客様に
 * > アップデートしてもらえるように、こういう画面をアプリに出すようにしてほしい。
 * > それぞれボタンを押したら iOS / Android のアプリに各飛ぶように。
 *
 * ## 🔴 必ず閉じられる
 *
 * 見本の画面には「あとで」が無かったが、閉じられないダイアログは**作らない**。
 * 設計を反証したとき、潰しきれないブリック経路が出たため:
 *
 *   - Play の段階公開・機種非対応・国別公開 … 更新したくてもできない層が必ず残る
 *   - OS の最低要件を満たさない端末 … **二度と更新できない**
 *   - 版数の入力ミス1つで全端末が同時に止まり、復旧は本番DBの書き換え待ち
 *
 * 出す相手はお客様だけでなく**店側（トレーナー）も同じアプリ**なので、
 * 閉じられないと営業中の受付業務まで止まる。
 *
 * ## 出す画面を絞っている
 *
 * `/` と `/auth` だけ。除いているのは:
 *   - `/auth/callback` `/billing/return` … 戻ってくる途中の中継。被せると処理が止まる
 *   - `/trial` `/drop-in` `/join` … リンクで来た見込み客の申込み導線
 *   - `/privacy` `/terms` `/tokushoho` `/delete-account` … 法務・削除の導線
 *
 * ⚠️ 許可制（allowlist）にしてある。新しいルートが増えたときに
 *    黙って被さるより、黙って出ないほうが安全なため。
 */

/** ここでだけ出す。前方一致ではなく完全一致で見る */
const ALLOWED_PATHS = ["/", "/auth"] as const;

const AppUpdateDialog = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { show, latestVersion, storeUrl, dismiss } = useAppUpdatePrompt();

  if (!show) return null;
  if (!ALLOWED_PATHS.includes(pathname as (typeof ALLOWED_PATHS)[number])) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-update-title"
      data-testid="app-update-dialog"
    >
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-xl animate-in zoom-in-95 duration-200">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <ArrowUpCircle className="h-6 w-6 text-primary" />
        </div>
        <h2 id="app-update-title" className="text-base font-bold text-foreground">{t("appUpdate.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("appUpdate.body")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("appUpdate.version", { version: latestVersion })}
        </p>
        <Button
          className="mt-5 h-12 w-full rounded-full text-base font-bold"
          onClick={() => void openExternalUrl(storeUrl)}
          data-testid="app-update-open-store"
        >
          {t("appUpdate.update")}
        </Button>
        <button
          type="button"
          className="mt-3 w-full text-sm text-muted-foreground underline-offset-2 hover:underline"
          onClick={dismiss}
          data-testid="app-update-later"
        >
          {t("appUpdate.later")}
        </button>
      </div>
    </div>
  );
};

export default AppUpdateDialog;
