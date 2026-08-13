import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UserCog, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useTenantStaff } from "@/hooks/useTenantStaff";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

interface GymOwnershipActionsProps {
  /** 表示中のジム名。閉じるときの確認入力に使う */
  gymName: string | null;
  /** 引き継ぎ・閉店のあとに呼ぶ（所属が変わるので画面を作り直す） */
  onChanged: () => void;
}

/**
 * オーナー専用の「引き継ぐ」「ジムを閉じる」。
 *
 * ## なぜ要るか（2026-08-13）
 *
 * `delete_my_account()` は active な owner を拒否する。判断としては正しいが、
 * 画面が案内する逃げ道（ジムを削除する／別のオーナーに引き継ぐ）が
 * **どちらも実装されていなかった**ので、**オーナーはアカウントを削除できなかった**。
 *
 * Apple 5.1.1(v) / Google Play の「アプリ内でアカウントを削除できること」にも触れる。
 *
 * ## 2つに分けた理由
 *
 * お客様が在籍しているジムをオーナーの都合だけで消せると、**第三者のデータ**
 * （予約・カルテ・入金記録）を巻き添えにする。
 *
 *   お客様がいる → **引き継ぐ**（ジムは続く）
 *   誰もいない   → **閉じる**
 *
 * 在籍者がいるまま閉じたい場合は、先に退会処理をしてもらう。
 */
const GymOwnershipActions = ({ gymName, onChanged }: GymOwnershipActionsProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { staff } = useTenantStaff();
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");

  // 引き継ぎ先の候補は自分以外のスタッフ。お客様は候補にしない
  // （渡すと、そのアカウントがジム全体を見られる状態になる）。
  const candidates = staff.filter((s) => s.user_id !== user?.id);

  const handleTransfer = async () => {
    if (!pickedId) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("transfer_gym_ownership" as never, {
        _to_user_id: pickedId,
      } as never);
      if (error) throw error;
      toast.success(t("gymOwnership.transferred"));
      setTransferOpen(false);
      onChanged();
    } catch (e) {
      console.error("オーナーの引き継ぎに失敗:", e);
      toast.error(t("gymOwnership.transferFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("delete_my_gym" as never);
      if (error) throw error;
      toast.success(t("gymOwnership.closed"));
      setCloseOpen(false);
      onChanged();
    } catch (e) {
      // 在籍者が残っているときは DB 側が members_remain で弾く。
      // 「なぜ消せないのか」が分からないと詰むので、理由を出し分ける。
      const msg = e instanceof Error ? e.message : String(e);
      console.error("ジムを閉じるのに失敗:", e);
      toast.error(
        msg.includes("members_remain")
          ? t("gymOwnership.closeBlockedMembers")
          : t("gymOwnership.closeFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        className="w-full h-12 font-bold"
        onClick={() => setTransferOpen(true)}
      >
        <UserCog className="w-4 h-4 mr-2" />
        {t("gymOwnership.transferButton")}
      </Button>

      <Button
        variant="outline"
        className="w-full h-12 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive font-bold"
        onClick={() => {
          setTypedName("");
          setCloseOpen(true);
        }}
      >
        <Store className="w-4 h-4 mr-2" />
        {t("gymOwnership.closeButton")}
      </Button>

      {/* ── 引き継ぐ ── */}
      <AlertDialog open={transferOpen} onOpenChange={setTransferOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gymOwnership.transferTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {candidates.length === 0
                ? t("gymOwnership.noCandidates")
                : t("gymOwnership.transferDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {candidates.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {candidates.map((s) => (
                <button
                  key={s.user_id}
                  type="button"
                  onClick={() => setPickedId(s.user_id)}
                  className={`w-full text-left rounded-xl border p-3 text-sm transition-colors ${
                    pickedId === s.user_id
                      ? "border-accent bg-accent/10 font-bold"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {s.display_name || t("common.nameUnset")}
                </button>
              ))}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleTransfer();
              }}
              disabled={busy || !pickedId || candidates.length === 0}
            >
              {busy ? <DumbbellLoader className="w-4 h-4" /> : t("gymOwnership.transferConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── 閉じる ── */}
      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gymOwnership.closeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("gymOwnership.closeDesc", { name: gymName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* 🔴 取り返しがつかないので、ジム名を打たせる。
              「削除する」を押すだけだと、確認ダイアログが素通りする。 */}
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={gymName ?? ""}
            aria-label={t("gymOwnership.closeTypeName")}
          />

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleClose();
              }}
              disabled={busy || !gymName || typedName.trim() !== gymName}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <DumbbellLoader className="w-4 h-4" /> : t("gymOwnership.closeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default GymOwnershipActions;
