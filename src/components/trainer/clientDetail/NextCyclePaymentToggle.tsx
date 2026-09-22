import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { useMemberNextCycleGate } from "@/hooks/useMemberNextCycleGate";
import { formatCycleRange } from "@/lib/nextCyclePayment";
import { PAYMENT_METHODS, validateAmount, type PaymentMethod } from "@/lib/memberPayments";

/**
 * 次回分の入金を、お客様ごとに1タップで記録する（カルテ）。
 *
 * ## 🔴 素の ON/OFF ではない
 *
 * 見た目はスイッチだが、中身は**「どのサイクル分を受け取ったか」を1行足すこと**。
 * 素のフラグだと次のサイクルが来ても ON のままで、毎月 全会員ぶん手で戻すことになり、
 * 必ず忘れる。忘れた瞬間、**誰も止まらない仕組み**に変わる。
 * 行として持てば、サイクルが進むだけで自動的に「未入金」へ戻る（戻す作業がゼロ）。
 *
 * だからラベルに**期間を出す**（「次回分（10/18〜11/18）」）。
 * 何を確認して押したのかが、押す前に分かる形にする。
 *
 * ## 出す条件
 *
 * 店の設定（`tenants.next_cycle_payment_required`）が ON のときだけ出す。
 * OFF の店には関係のない欄なので置かない。プラン未確定・回数券・期間制のお客様は
 * DB が 0 行を返すので、やはり出ない（サイクルの概念が無い）。
 */
interface Props {
  clientId: string;
  currentPlanName: string | null;
  suggestedAmountYen: number | null;
}

const NextCyclePaymentToggle = ({ clientId, currentPlanName, suggestedAmountYen }: Props) => {
  const { t } = useTranslation();
  const { tenant } = useTenant();
  const { gate, loading, saving, markPaid, undoPaid } = useMemberNextCycleGate(clientId);

  const [payOpen, setPayOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("現金");

  // 🔴 `=== true` で見る。列が未適用の環境では undefined になり、欄が出ない＝従来どおり。
  const required = tenant?.next_cycle_payment_required === true;
  if (!required || loading || !gate) return null;

  const range = formatCycleRange(gate.cycleStart, gate.cycleEnd);

  const openPay = () => {
    setAmount(suggestedAmountYen && suggestedAmountYen > 0 ? String(suggestedAmountYen) : "");
    setMethod("現金");
    setPayOpen(true);
  };

  const confirmPay = async () => {
    const invalid = validateAmount(amount);
    if (invalid) { toast.error(invalid); return; }
    const { error } = await markPaid({
      amountYen: Number(amount.trim()), method, planName: currentPlanName,
    });
    if (error) { toast.error(t("member.saveFailed"), { description: error.message }); return; }
    setPayOpen(false);
    toast.success(t("nextCyclePayment.marked", { range }));
  };

  const confirmUndo = async () => {
    const { error } = await undoPaid();
    if (error) { toast.error(t("member.saveFailed"), { description: error.message }); return; }
    setUndoOpen(false);
    toast.success(t("nextCyclePayment.undone", { range }));
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3 rounded-lg border p-3 mb-2.5">
        <div className="space-y-0.5">
          <p className="text-sm font-bold flex items-center gap-1.5">
            <CalendarCheck className="w-3.5 h-3.5 shrink-0" />
            {t("nextCyclePayment.memberToggleLabel", { range })}
          </p>
          <p className="text-xs text-muted-foreground">
            {gate.paid ? t("nextCyclePayment.memberPaidHelp") : t("nextCyclePayment.memberUnpaidHelp")}
          </p>
        </div>
        <Switch
          checked={gate.paid}
          disabled={saving}
          onCheckedChange={(next) => (next ? openPay() : setUndoOpen(true))}
          aria-label={t("nextCyclePayment.memberToggleLabel", { range })}
        />
      </div>

      <AlertDialog open={payOpen} onOpenChange={setPayOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("nextCyclePayment.payTitle", { range })}</AlertDialogTitle>
            <AlertDialogDescription>{t("nextCyclePayment.payDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`ncp-amt-${clientId}`}>
                {t("member.amountLabel")}
              </label>
              <Input
                id={`ncp-amt-${clientId}`} inputMode="numeric" value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="20000"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block" htmlFor={`ncp-mtd-${clientId}`}>
                {t("member.methodLabel")}
              </label>
              <select
                id={`ncp-mtd-${clientId}`} value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirmPay(); }} disabled={saving}>
              {t("nextCyclePayment.payConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={undoOpen} onOpenChange={setUndoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("nextCyclePayment.undoTitle", { range })}</AlertDialogTitle>
            <AlertDialogDescription>{t("nextCyclePayment.undoDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirmUndo(); }} disabled={saving}>
              {t("nextCyclePayment.undoConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default NextCyclePaymentToggle;
