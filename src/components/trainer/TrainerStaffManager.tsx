/**
 * 担当できる人（オーナー・インストラクター）の追加・削除。ジムのオーナーだけが使う。
 *
 * ## 追加のしくみ
 * インストラクター用の招待コードを発行し、リンク（/join-staff/コード）を本人に渡す。
 * 本人がログインしてリンクを開くと、そのジムのインストラクター（制限付き。src/lib/staffAccess.ts）として参加する。
 * お客様用の招待コード（InviteCodeCard）とは**別のコード**。同じコードを兼用すると
 * 「お客様として配ったリンクから店側に入れる」＝顧客データ全件が見える権限が漏れる。
 *
 * ## 「スタッフ」はなくした（2026-10-28）
 * 宗本さん「スタッフいらない」（全部のジムで）。ジム側の人はオーナーとインストラクターだけ。
 * スタッフ用の招待カード・「スタッフ ⇄ インストラクター」の切り替えは出さない。
 * DB でも、スタッフ用のコードでは参加できず、trainer は必ず limited
 * （`supabase/migrations/20261028050000_retire_full_staff.sql`）。
 *
 * ## 権限
 * 招待コードの参照・再発行・削除はすべて RPC 側で「tenants.owner_user_id = auth.uid()」を確認している。
 * オーナー以外がこの画面を開いてもコードは返らない（null）ので、その場合は何も出さない。
 */
import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Link as LinkIcon, RefreshCw, Trash2, UserRound, GraduationCap } from "lucide-react";
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
import { useBookingMenus } from "@/hooks/useBookingMenus";
import type { TenantStaff } from "@/lib/tenantStaff";

const TrainerStaffManager = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { staff, refetch: refetchStaff } = useTenantStaff();
  // 担当している予約メニュー（同じ先生がヨガとマシンピラティスの両方を持つ、などの組み合わせが一目で分かるように）
  const { menus } = useBookingMenus();
  const menusOf = (userId: string) => menus.filter((m) => m.is_active && m.staff_user_id === userId).map((m) => m.name).join("・");
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TenantStaff | null>(null);
  const [removing, setRemoving] = useState(false);

  const loadCode = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_instructor_invite_code");
    if (error) console.error(error);
    setCode(error ? null : ((data as string | null) ?? null));
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
    const { data, error } = await supabase.rpc("regenerate_instructor_invite_code");
    setRegenerating(false);
    setConfirmRegenerate(false);
    if (error) {
      toast.error(t("staff.errorRegenerate"));
      return;
    }
    setCode((data as string | null) ?? null);
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
      <Card data-testid="staff-invite-instructor">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <GraduationCap className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h3 className="font-bold text-sm">{t("staff.instructorInviteTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("staff.instructorInviteDesc")}</p>
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
          <Button size="sm" variant="ghost" className="w-full text-muted-foreground" onClick={() => setConfirmRegenerate(true)}>
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
              <li key={s.user_id} className="rounded-lg border border-border px-3 py-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-sm font-semibold truncate">{s.display_name}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {t(s.role === "owner" ? "staff.roleOwner" : "staff.roleInstructor")}
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
                </div>
                {menusOf(s.user_id) && (
                  <p className="text-[11px] text-muted-foreground" data-testid="staff-menus">{t("staff.menusLabel", { names: menusOf(s.user_id) })}</p>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={confirmRegenerate} onOpenChange={(open) => { if (!open && !regenerating) setConfirmRegenerate(false); }}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("staff.regenerate")}</DialogTitle>
            <DialogDescription>{t("staff.regenerateConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setConfirmRegenerate(false)} disabled={regenerating} className="w-full sm:w-auto">
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
