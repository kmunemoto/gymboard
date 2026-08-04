/**
 * スタッフ（担当できる人）の追加・削除。ジムのオーナーだけが使う。
 *
 * ## 追加のしくみ
 * スタッフ専用の招待コードを発行し、リンク（/join-staff/コード）を本人に渡す。
 * 本人がログインしてリンクを開くと、そのジムのスタッフとして参加する。
 * お客様用の招待コード（InviteCodeCard）とは**別のコード**。同じコードを兼用すると
 * 「お客様として配ったリンクからスタッフになれる」＝顧客データ全件が見える権限が漏れる。
 *
 * ## 権限
 * 招待コードの参照・再発行・スタッフの削除はすべて RPC 側で
 * 「tenants.owner_user_id = auth.uid()」を確認している。オーナー以外がこの画面を
 * 開いてもコードは返らない（null）ので、その場合はカード自体を出さない。
 */
import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Link as LinkIcon, UserPlus, RefreshCw, Trash2, UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getWebOrigin } from "@/lib/nativeBridge";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStaff } from "@/hooks/useTenantStaff";
import type { TenantStaff } from "@/lib/tenantStaff";

const TrainerStaffManager = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { staff, refetch: refetchStaff } = useTenantStaff();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TenantStaff | null>(null);
  const [removing, setRemoving] = useState(false);

  const loadCode = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_staff_invite_code");
    if (error) {
      console.error(error);
      setCode(null);
    } else {
      setCode((data as string) ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadCode(); }, [loadCode]);

  // オーナーでなければ RPC が null を返す＝この画面は出さない。
  if (loading || !code) return null;

  // ネイティブアプリ内では window.location.origin が 'capacitor://localhost' になり、
  // コピーしたリンクを渡しても開けなくなるため getWebOrigin() でフォールバックする。
  const link = `${getWebOrigin()}/join-staff/${code}`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("inviteCode.copiedToast", { label }));
    } catch {
      toast.error(t("inviteCode.copyFailed"));
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    const { data, error } = await supabase.rpc("regenerate_staff_invite_code");
    setRegenerating(false);
    setRegenerateOpen(false);
    if (error) {
      toast.error(t("staff.errorRegenerate"));
      return;
    }
    setCode((data as string) ?? null);
    toast.success(t("staff.regeneratedToast"));
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    const { error } = await supabase.rpc("remove_staff_member", { p_user_id: removeTarget.user_id });
    setRemoving(false);
    if (error) {
      toast.error(t("staff.errorRemove"));
      return;
    }
    toast.success(t("staff.removedToast", { name: removeTarget.display_name }));
    setRemoveTarget(null);
    void refetchStaff();
  };

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <UserPlus className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h3 className="font-bold text-sm">{t("staff.inviteTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("staff.inviteDesc")}</p>
            </div>
          </div>
          <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-center font-mono tracking-wider text-lg font-bold break-all">
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
          <Button size="sm" variant="ghost" className="w-full text-muted-foreground" onClick={() => setRegenerateOpen(true)}>
            <RefreshCw className="w-4 h-4 mr-1" /> {t("staff.regenerate")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <UserRound className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h3 className="font-bold text-sm">{t("staff.listTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("staff.listDesc")}</p>
            </div>
          </div>
          <ul className="space-y-2">
            {staff.map((s) => (
              <li key={s.user_id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                <span className="flex-1 min-w-0 text-sm font-semibold truncate">{s.display_name}</span>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {s.role === "owner" ? t("staff.roleOwner") : t("staff.roleStaff")}
                </span>
                {/* オーナーと自分自身は消せない（RPC 側でも同じ条件で拒否する） */}
                {s.role === "trainer" && s.user_id !== user?.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("staff.removeAria", { name: s.display_name })}
                    onClick={() => setRemoveTarget(s)}
                    className="h-8 w-8 shrink-0 text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={regenerateOpen} onOpenChange={(open) => { if (!regenerating) setRegenerateOpen(open); }}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("staff.regenerate")}</DialogTitle>
            <DialogDescription>{t("staff.regenerateConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setRegenerateOpen(false)} disabled={regenerating} className="w-full sm:w-auto">
              {t("common.cancel")}
            </Button>
            <Button variant="accent" onClick={handleRegenerate} disabled={regenerating} className="w-full sm:w-auto">
              {t("staff.regenerate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removeTarget} onOpenChange={(open) => { if (!open && !removing) setRemoveTarget(null); }}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("staff.removeTitle")}</DialogTitle>
            <DialogDescription>
              {t("staff.removeConfirm", { name: removeTarget?.display_name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setRemoveTarget(null)} disabled={removing} className="w-full sm:w-auto">
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleRemove} disabled={removing} className="w-full sm:w-auto">
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TrainerStaffManager;
