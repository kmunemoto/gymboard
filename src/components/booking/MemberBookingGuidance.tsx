import { Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NATIVE_APP_SCHEME, PRODUCTION_WEB_ORIGIN, STORE_URLS } from "@/lib/brand";

export function MemberBookingGuidance() {
  const { t } = useTranslation();
  return (
    <Card className="border-accent/40 bg-accent/5" role="status" aria-live="polite">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Smartphone className="w-6 h-6 text-accent shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <h2 className="font-bold">{t("trialBooking.memberTitle")}</h2>
            <p className="text-sm leading-relaxed">{t("trialBooking.memberBody")}</p>
          </div>
        </div>
        <Button asChild variant="accent" className="w-full min-h-12 whitespace-normal">
          <a href={`${NATIVE_APP_SCHEME}//`}>{t("trialBooking.memberOpenApp")}</a>
        </Button>
        <p className="text-xs text-muted-foreground">{t("trialBooking.memberHelp")}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-3 text-sm">
          {STORE_URLS.ios && <a className="underline underline-offset-4" href={STORE_URLS.ios}>App Store</a>}
          {STORE_URLS.android && <a className="underline underline-offset-4" href={STORE_URLS.android}>Google Play</a>}
          <a className="underline underline-offset-4" href={PRODUCTION_WEB_ORIGIN}>
            {t("trialBooking.memberWebLogin")}
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
