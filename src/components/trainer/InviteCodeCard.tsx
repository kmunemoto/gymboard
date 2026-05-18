import { Copy, Link as LinkIcon, Ticket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/hooks/useTenant";
import { toast } from "sonner";

const InviteCodeCard = () => {
  const { tenant } = useTenant();
  if (!tenant?.invite_code) return null;

  const code = tenant.invite_code;
  const link = `${window.location.origin}/join/${code}`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}をコピーしました`);
    } catch {
      toast.error("コピーに失敗しました");
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
            <h3 className="font-bold text-sm">招待コード</h3>
            <p className="text-xs text-muted-foreground">お客様にこのコードまたはリンクを共有してください</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-center font-mono tracking-wider text-xl font-bold break-all">
          {code}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => copy(code, "招待コード")}>
            <Copy className="w-4 h-4 mr-1" /> コードをコピー
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => copy(link, "招待リンク")}>
            <LinkIcon className="w-4 h-4 mr-1" /> リンクをコピー
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default InviteCodeCard;
