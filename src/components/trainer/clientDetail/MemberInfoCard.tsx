import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IdCard, Save, PauseCircle, PlayCircle, UserRoundX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyTenantId } from "@/lib/tenantHelper";
import { getJSTToday } from "@/lib/timezone";
import {
  MEMBER_STATUS_LABEL, isSuspended, isWithdrawn, suspensionLabel, validateSuspension,
  type MemberStatus,
} from "@/lib/memberLifecycle";

/**
 * 顧客の基本情報（連絡先）と在籍状態（在籍 / 休会 / 退会）。
 *
 * ── なぜ2つを1枚にまとめるか ────────────────────────────────
 * どちらも「事務」で、トレーニングの記録とは触る頻度も担当者も違う。
 * カルテ本体に混ぜると、体重を見に来た画面で退会ボタンを踏む事故が起きる。
 *
 * ⚠️ **退会は行を消さない。** `tenant_members.status` を 'withdrawn' にするだけ。
 *    予約履歴・入金記録・同意記録は残る（消すと会計と揉めたときに何も出せない）。
 *    席は空く（`is_tenant_over_limit` が withdrawn を数えない）。
 */

interface MemberInfoCardProps {
  clientId: string;
  /** profiles の現在値。null は「まだ profiles 行が無い」ではなく「未入力」 */
  phone: string | null;
  nameKana: string | null;
  /** tenant_members の現在値 */
  status: string | null;
  suspendedFrom: string | null;
  suspendedUntil: string | null;
  /** 保存後に呼ぶ。親が再取得する */
  onChanged: () => void;
  /** 退会にしたとき。一覧から消えるのでカルテを閉じる */
  onWithdrawn?: () => void;
}

const MemberInfoCard = ({
  clientId, phone, nameKana, status, suspendedFrom, suspendedUntil, onChanged, onWithdrawn,
}: MemberInfoCardProps) => {
  const { t } = useTranslation();
  const [phoneDraft, setPhoneDraft] = useState(phone ?? "");
  const [kanaDraft, setKanaDraft] = useState(nameKana ?? "");
  const [saving, setSaving] = useState(false);

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendFrom, setSuspendFrom] = useState(getJSTToday());
  const [suspendUntil, setSuspendUntil] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");

  // 親が別の顧客に切り替えたら下書きを捨てる。残すと A さんの電話番号を
  // B さんのカルテに保存してしまう。
  useEffect(() => {
    setPhoneDraft(phone ?? "");
    setKanaDraft(nameKana ?? "");
  }, [clientId, phone, nameKana]);

  const dirty = phoneDraft !== (phone ?? "") || kanaDraft !== (nameKana ?? "");

  const saveContact = async () => {
    if (phoneDraft.trim().length > 30) { toast.error(t("member.phoneTooLong")); return; }
    if (kanaDraft.trim().length > 100) { toast.error(t("member.kanaTooLong")); return; }
    setSaving(true);
    // profiles 行が無いお客様がいる（招待だけして未ログイン等）。update だと
    // 0行更新で「成功」して黙って消えるので upsert する。
    // 2026-08-08 にオーナー14名の profiles 欠落を踏んだのと同じ穴。
    const { error } = await supabase.from("profiles").upsert(
      {
        user_id: clientId,
        phone: phoneDraft.trim() || null,
        name_kana: kanaDraft.trim() || null,
      },
      { onConflict: "user_id" },
    );
    setSaving(false);
    if (error) { toast.error(t("member.saveFailed")); return; }
    toast.success(t("member.saved"));
    onChanged();
  };

  /**
   * tenant_members の在籍状態を書き換える。自テナントの行だけを対象にする。
   * 型を絞ってあるのは、ここから user_id / tenant_id / role を触れないようにするため
   * （DB 側にも行の同一性を守るトリガーがあるが、画面から書ける形にしない）。
   */
  const updateMembership = async (patch: {
    status?: MemberStatus;
    suspended_from?: string | null;
    suspended_until?: string | null;
    withdrawn_on?: string | null;
    withdrawal_reason?: string | null;
  }) => {
    const tenantId = await fetchMyTenantId();
    if (!tenantId) { toast.error(t("member.saveFailed")); return false; }
    const { error } = await supabase
      .from("tenant_members")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("user_id", clientId);
    if (error) { toast.error(t("member.saveFailed")); return false; }
    return true;
  };

  const doSuspend = async () => {
    const invalid = validateSuspension(suspendFrom, suspendUntil);
    if (invalid) { toast.error(invalid); return; }
    const ok = await updateMembership({
      status: "suspended",
      suspended_from: suspendFrom,
      suspended_until: suspendUntil || null,
    });
    if (!ok) return;
    setSuspendOpen(false);
    toast.success(t("member.suspendedToast"));
    onChanged();
  };

  const doResume = async () => {
    const ok = await updateMembership({
      status: "active",
      suspended_from: null,
      suspended_until: null,
    });
    if (!ok) return;
    toast.success(t("member.resumedToast"));
    onChanged();
  };

  const doWithdraw = async () => {
    const ok = await updateMembership({
      status: "withdrawn",
      withdrawn_on: getJSTToday(),
      withdrawal_reason: withdrawReason.trim() || null,
      // 休会からそのまま退会にすることがある。休会の日付は残さない
      suspended_from: null,
      suspended_until: null,
    });
    if (!ok) return;
    setWithdrawOpen(false);
    toast.success(t("member.withdrawnToast"));
    onChanged();
    onWithdrawn?.();
  };

  const label = MEMBER_STATUS_LABEL[(status ?? "active") as MemberStatus] ?? MEMBER_STATUS_LABEL.active;
  const suspended = isSuspended(status);
  const withdrawn = isWithdrawn(status);
  const period = suspensionLabel(suspendedFrom, suspendedUntil);

  return (
    <section>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <IdCard className="w-3.5 h-3.5" />
        {t("member.sectionTitle")}
      </h2>
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          {/* 在籍状態 */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium">{t("member.statusLabel")}</span>
              <Badge variant={suspended || withdrawn ? "secondary" : "default"}>{label}</Badge>
            </div>
            {!withdrawn && (
              <div className="flex items-center gap-1.5">
                {suspended ? (
                  <Button variant="outline" size="sm" className="h-9 text-xs gap-1" onClick={doResume}>
                    <PlayCircle className="w-3.5 h-3.5" />
                    {t("member.resume")}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="h-9 text-xs gap-1" onClick={() => setSuspendOpen(true)}>
                    <PauseCircle className="w-3.5 h-3.5" />
                    {t("member.suspend")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs gap-1 text-destructive hover:text-destructive"
                  onClick={() => setWithdrawOpen(true)}
                >
                  <UserRoundX className="w-3.5 h-3.5" />
                  {t("member.withdraw")}
                </Button>
              </div>
            )}
          </div>
          {suspended && period && (
            <p className="text-xs text-muted-foreground">{t("member.suspendPeriod", { period })}</p>
          )}

          {/* 連絡先 */}
          <div className="pt-2 border-t border-border space-y-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`kana-${clientId}`}>
                {t("member.kanaLabel")}
              </label>
              <Input
                id={`kana-${clientId}`}
                value={kanaDraft}
                onChange={(e) => setKanaDraft(e.target.value)}
                placeholder={t("member.kanaPlaceholder")}
                className="h-11 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`phone-${clientId}`}>
                {t("member.phoneLabel")}
              </label>
              <Input
                id={`phone-${clientId}`}
                type="tel"
                inputMode="tel"
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                placeholder={t("member.phonePlaceholder")}
                className="h-11 text-sm"
              />
              <p className="text-[11px] text-muted-foreground mt-1">{t("member.phoneHelp")}</p>
            </div>
            <Button onClick={saveContact} disabled={!dirty || saving} className="w-full h-11 gap-1.5">
              <Save className="w-4 h-4" />
              {t("member.saveContact")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 休会 */}
      <AlertDialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("member.suspendTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("member.suspendDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`sf-${clientId}`}>
                {t("member.suspendFrom")}
              </label>
              <Input id={`sf-${clientId}`} type="date" value={suspendFrom} onChange={(e) => setSuspendFrom(e.target.value)} className="h-11 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`su-${clientId}`}>
                {t("member.suspendUntil")}
              </label>
              <Input id={`su-${clientId}`} type="date" value={suspendUntil} onChange={(e) => setSuspendUntil(e.target.value)} className="h-11 text-sm" />
              <p className="text-[11px] text-muted-foreground mt-1">{t("member.suspendUntilHelp")}</p>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            {/* onSelect の既定（閉じる）を止める。入力エラーのときダイアログを開いたままにする */}
            <AlertDialogAction onClick={(e) => { e.preventDefault(); doSuspend(); }}>
              {t("member.suspendConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 退会 */}
      <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("member.withdrawTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("member.withdrawDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`wr-${clientId}`}>
              {t("member.withdrawReason")}
            </label>
            <Textarea
              id={`wr-${clientId}`}
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              placeholder={t("member.withdrawReasonPlaceholder")}
              className="text-sm"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); doWithdraw(); }}
            >
              {t("member.withdrawConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default MemberInfoCard;
