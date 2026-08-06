import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { NATIVE_APP_SCHEME } from "@/lib/brand";

/**
 * Stripe Checkout からネイティブアプリへ戻すための中継ページ。
 *
 * ## なぜ中継が要るのか
 *
 * Checkout の `success_url` にカスタムスキーム（`app.gymboard.mobile://`）を
 * 直接指定できない。`gymboard-create-checkout` が戻り先URLを
 * **自分のドメインだけに制限している**ためで、**この制限は緩めてはいけない**
 * （任意のアプリへ飛ばせる穴になる）。
 *
 * そこで https の当ページを挟み、ここからディープリンクでアプリへ戻す。
 *
 * ## ディープリンクが効かない場合がある
 *
 * プライベートブラウズや、アプリを消した直後などでは戻れないことがある。
 * **その場合でも「決済は完了している」ことが読めるようにしてある。**
 * 黙って白い画面を出すと、ジムオーナーは二重に申し込みかねない。
 *
 * ## 決済の反映はこのページではやらない
 *
 * プランの反映は Stripe の webhook（`gymboard-stripe-webhook`）が行う。
 * このページは**表示と復帰だけ**。ここで契約状態を書き換えると、
 * URL を直接開くだけでプランを書き換えられることになる。
 */
const BillingReturn = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [returned, setReturned] = useState(false);
  const status = searchParams.get("status") === "success" ? "success" : "cancel";

  // `NATIVE_APP_SCHEME` は "app.gymboard.mobile:" の形（末尾コロン）
  const deepLink = `${NATIVE_APP_SCHEME}//billing?status=${status}`;

  useEffect(() => {
    // 自動で戻す。戻れたらこのページは破棄されるので、下の手動ボタンは見えない。
    const timer = window.setTimeout(() => {
      try {
        window.location.href = deepLink;
      } catch {
        /* スキームが登録されていない環境では何も起きない。手動ボタンに委ねる */
      }
      setReturned(true);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [deepLink]);

  const ok = status === "success";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-4 text-center">
          {ok ? (
            <CheckCircle2 className="w-12 h-12 text-accent mx-auto" />
          ) : (
            <XCircle className="w-12 h-12 text-muted-foreground mx-auto" />
          )}

          <h1 className="text-lg font-bold">
            {ok ? t("billingReturn.successTitle") : t("billingReturn.cancelTitle")}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {ok ? t("billingReturn.successBody") : t("billingReturn.cancelBody")}
          </p>

          <Button variant="accent" className="w-full" onClick={() => { window.location.href = deepLink; }}>
            <ExternalLink className="w-4 h-4 mr-1" />
            {t("billingReturn.backToApp")}
          </Button>

          {returned && (
            <p className="text-xs text-muted-foreground">{t("billingReturn.manualHint")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BillingReturn;
