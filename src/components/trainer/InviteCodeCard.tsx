import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Link as LinkIcon, Ticket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const InviteCodeCard = () => {
  const { t } = useTranslation();
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_my_tenant_invite_code");
      if (cancelled) return;
      if (error) {
        console.error(error);
        return;
      }
      setCode((data as string) ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!code) return null;
  const link = `${window.location.origin}/join/${code}`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("inviteCode.copiedToast", { label }));
    } catch {
      toast.error(t("inviteCode.copyFailed"));
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <Ticket className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h3 className="font-bold text-sm">{t("inviteCode.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("inviteCode.desc")}</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-center font-mono tracking-wider text-xl font-bold break-all">
          {code}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => copy(code, t("inviteCode.codeLabel"))}>
            <Copy className="w-4 h-4 mr-1" /> {t("inviteCode.copyCode")}
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => copy(link, t("inviteCode.linkLabel"))}>
            <LinkIcon className="w-4 h-4 mr-1" /> {t("inviteCode.copyLink")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default InviteCodeCard;
