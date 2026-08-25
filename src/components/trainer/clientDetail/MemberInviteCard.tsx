// 取り込んだ顧客への招待（カルテの概要タブ・オーナー限定）。
//
// CSV 一括登録で作った顧客は、ログイン手段の無いアカウントとして店の中にだけ存在する。
// ここで本人のメールアドレスを設定して招待を送ると、パスワード設定リンクが届き、
// 設定した瞬間にそのアカウントが本人の物になる（アカウントの引き渡し）。
//
// ⚠️ **宛先のアドレスがそのまま鍵になる。** 打ち間違えると別人にリンクが届く。
//    送る前の確認文と、メール本文の「心当たりが無い場合は破棄」が防波堤。
//
// 状態は3段階（supabase/migrations/20260825020000 のコメント参照）:
//   未招待 → 招待済み（invited_at）→ 本人ログイン済み（claimed_at。このカードごと消える）

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MailPlus, Send, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { formatJST } from "@/lib/timezone";

interface Props {
  clientId: string;
  invitedAt: string | null;
  onChanged: () => void;
}

const MemberInviteCard = ({ clientId, invitedAt, onChanged }: Props) => {
  const { t } = useTranslation();
  const { tenant, role } = useTenant();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  // 招待はオーナーだけ（Edge Function 側も同じ判定。ここは 403 を見せないための出し分け）
  if (role !== "owner") return null;

  const send = async () => {
    if (!tenant?.id) return;
    const addr = email.trim();
    if (!addr || !addr.includes("@")) {
      toast.error(t("dataImport.invite.errInvalidEmail"));
      return;
    }
    // 打ち間違い＝別人にアカウントが渡る。送る前に宛先を読み上げて確認する
    if (!window.confirm(t("dataImport.invite.confirm", { email: addr }))) return;

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-customer", {
        body: { tenant_id: tenant.id, user_id: clientId, email: addr },
      });
      const payload = data as { ok?: boolean; error?: string } | null;
      if (error || !payload?.ok) {
        const code = payload?.error ?? "";
        const key =
          code === "email_taken" ? "dataImport.invite.errEmailTaken"
          : code === "email_suppressed" ? "dataImport.invite.errSuppressed"
          : code === "invalid_email" ? "dataImport.invite.errInvalidEmail"
          : "dataImport.invite.errFailed";
        toast.error(t(key));
        return;
      }
      toast.success(t("dataImport.invite.sent", { email: addr }));
      setEmail("");
      onChanged();
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <MailPlus className="w-4 h-4 text-accent" />
            {t("dataImport.invite.section")}
          </h3>
          {invitedAt ? (
            <Badge variant="outline" className="text-[10px] gap-1 text-primary border-primary/30">
              <CheckCircle2 className="w-3 h-3" />
              {t("dataImport.invite.statusInvited", { date: formatJST(invitedAt, "M/d") })}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {t("dataImport.unclaimedBadge")}
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {invitedAt ? t("dataImport.invite.descInvited") : t("dataImport.invite.desc")}
        </p>

        <div className="flex items-center gap-2">
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder={t("dataImport.invite.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={sending}
            className="text-sm"
          />
          <Button
            type="button"
            size="sm"
            className="gap-1.5 shrink-0"
            disabled={sending || email.trim() === ""}
            onClick={send}
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {invitedAt ? t("dataImport.invite.resend") : t("dataImport.invite.send")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default MemberInviteCard;
