import { useTranslation } from "react-i18next";
import { Copy, ExternalLink, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/hooks/useTenant";
import { toast } from "sonner";

// 無料体験の予約リンク（公開ページ /trial/:tenantId）をトレーナーが取得・共有するためのカード。
// InviteCodeCard と同じ体裁。各ジムは自分のテナントIDが埋め込まれたリンクを配布でき、
// リンク先はそのジムのロゴ・ジム名・空き枠・予約通知が反映される（TrialBooking.tsx）。
const TrialLinkCard = () => {
  const { t } = useTranslation();
  const { tenant } = useTenant();

  if (!tenant?.id) return null;
  const link = `${window.location.origin}/trial/${tenant.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("trialLink.copiedToast"));
    } catch {
      toast.error(t("trialLink.copyFailed"));
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h3 className="font-bold text-sm">{t("trialLink.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("trialLink.desc")}</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-center font-mono text-xs break-all">
          {link}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={copy}>
            <Copy className="w-4 h-4 mr-1" /> {t("trialLink.copyLink")}
          </Button>
          <Button size="sm" variant="outline" className="flex-1" asChild>
            <a href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-1" /> {t("trialLink.openLink")}
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default TrialLinkCard;
