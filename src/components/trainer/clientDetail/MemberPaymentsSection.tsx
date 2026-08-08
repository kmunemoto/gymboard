import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { getJSTToday } from "@/lib/timezone";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { useMemberPayments } from "@/hooks/useMemberPayments";
import {
  PAYMENT_KINDS, PAYMENT_METHODS, formatYen, totalPaid, validateAmount,
  type PaymentKind, type PaymentMethod,
} from "@/lib/memberPayments";

/**
 * 入金の記録（`member_payments`）。カルテの中に置く。
 *
 * ── 🔴 これは「記録」であって「決済」ではない ────────────────
 * アプリはお金を動かさない。現金・振込・カードでジムが受け取った事実を残すだけ。
 * それまでの入金の実体は `profiles.paid_this_month`（boolean）だけで、
 * **しかも書き込む UI が1つも無かった**（2026-08-08 の棚卸しで判明）。
 *
 * 履歴は直近12件だけ出す。全部見たい要望が出たらページングを足す
 * （最初から作らないのは、1人あたり年12件程度で当面足りるため）。
 */

const RECENT_LIMIT = 12;

interface MemberPaymentsSectionProps {
  clientId: string;
  /** 現在のプラン名。記録時の既定値に使う（履歴には文字列として焼き付く） */
  currentPlanName: string | null;
  /** 現在のプランの月額。金額欄の既定値に使う。0/未設定なら空のまま */
  suggestedAmountYen: number | null;
}

const MemberPaymentsSection = ({ clientId, currentPlanName, suggestedAmountYen }: MemberPaymentsSectionProps) => {
  const { t } = useTranslation();
  const { payments, loading, addPayment, deletePayment } = useMemberPayments(clientId);

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(getJSTToday());
  const [method, setMethod] = useState<PaymentMethod>("現金");
  const [kind, setKind] = useState<PaymentKind>("月謝");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const openDialog = () => {
    setAmount(suggestedAmountYen && suggestedAmountYen > 0 ? String(suggestedAmountYen) : "");
    setPaidOn(getJSTToday());
    setMethod("現金");
    setKind("月謝");
    setNote("");
    setOpen(true);
  };

  const save = async () => {
    const invalid = validateAmount(amount);
    if (invalid) { toast.error(invalid); return; }
    if (!paidOn) { toast.error(t("member.payDateRequired")); return; }
    if (note.trim().length > 500) { toast.error(t("member.noteTooLong")); return; }
    setSaving(true);
    const { error } = await addPayment({
      userId: clientId,
      amountYen: Number(amount.trim()),
      paidOn,
      method,
      kind,
      // プラン名は「受け取った時点の名前」を控える。あとでプランをリネームしても
      // 過去の記録が書き換わらないようにするため、参照ではなく文字列で持つ。
      planName: kind === "月謝" ? currentPlanName : null,
      note: note.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error(t("member.saveFailed")); return; }
    setOpen(false);
    toast.success(t("member.paySaved"));
  };

  const total = totalPaid(payments);

  return (
    <section>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <Banknote className="w-3.5 h-3.5" />
        {t("member.paymentsTitle")}
      </h2>
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <Button onClick={openDialog} className="w-full h-11 gap-1.5">
            <Plus className="w-4 h-4" />
            {t("member.addPayment")}
          </Button>

          {loading ? (
            <div className="flex justify-center py-6"><DumbbellLoader className="w-5 h-5 text-accent" /></div>
          ) : payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("member.noPayments")}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {t("member.paidTotal", { total: formatYen(total), count: payments.length })}
              </p>
              <div className="space-y-2">
                {payments.slice(0, RECENT_LIMIT).map((p) => (
                  <div key={p.id} className="flex items-start justify-between gap-2 bg-muted/50 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold tabular-nums">{formatYen(p.amount_yen)}</p>
                      <p className="text-xs text-muted-foreground break-all">
                        {p.paid_on} ・ {p.kind} ・ {p.method}
                        {p.plan_name ? ` ・ ${p.plan_name}` : ""}
                      </p>
                      {p.note && <p className="text-xs text-muted-foreground/80 break-all mt-0.5">{p.note}</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => setDeleteTarget(p.id)}
                      aria-label={t("common.deleteAction")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              {payments.length > RECENT_LIMIT && (
                <p className="text-[11px] text-muted-foreground text-center">
                  {t("member.showingRecent", { count: RECENT_LIMIT })}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 記録ダイアログ */}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("member.addPaymentTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("member.addPaymentDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`amt-${clientId}`}>
                {t("member.amountLabel")}
              </label>
              <Input
                id={`amt-${clientId}`}
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="12000"
                className="h-11 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`pdate-${clientId}`}>
                {t("member.payDateLabel")}
              </label>
              <Input id={`pdate-${clientId}`} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="h-11 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`kind-${clientId}`}>
                {t("member.kindLabel")}
              </label>
              <select
                id={`kind-${clientId}`}
                value={kind}
                onChange={(e) => setKind(e.target.value as PaymentKind)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {PAYMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`method-${clientId}`}>
                {t("member.methodLabel")}
              </label>
              <select
                id={`method-${clientId}`}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`pnote-${clientId}`}>
                {t("member.noteLabel")}
              </label>
              <Textarea
                id={`pnote-${clientId}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("member.payNotePlaceholder")}
                className="text-sm"
                rows={2}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            {/* 既定の「押したら閉じる」を止める。入力エラーで閉じると打ち直しになる */}
            <AlertDialogAction disabled={saving} onClick={(e) => { e.preventDefault(); save(); }}>
              {t("member.saveAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 削除確認 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("member.deletePaymentTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("member.deletePaymentDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteTarget) return;
                const { error } = await deletePayment(deleteTarget);
                setDeleteTarget(null);
                if (error) toast.error(t("member.saveFailed"));
              }}
            >
              {t("common.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default MemberPaymentsSection;
