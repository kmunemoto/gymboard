import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { formatDate } from "@/lib/dateFormat";
import { parseISO } from "date-fns";

/**
 * 「次回分のお支払いの確認後にご予約いただけます」の案内（お客様の予約画面）。
 *
 * 🔴 **押す前に分かる形にする。** カレンダーで日付を薄くするだけだと、
 * お客様には「なぜ押せないのか」が分からず、店へ問い合わせることになる。
 * 2026-09-03 に GB007（1日の上限）で実際に起きた
 * （「予約に失敗しました」としか出ず、気づいて連絡をくれた人だけが救われた）。
 *
 * 🔴 **払い方を決めつけない。** 対面で受け取る店も、振込の店もある。
 * システムが知るのは「店が確認した」という一点だけなので、文言もそこに寄せる
 * （対面なら「次回来店時に」、振込なら「振り込んで確認されたら」と読める）。
 *
 * gate が null（＝止めるものが無い）のときは何も出さない。
 */
interface Props {
  /** 「この日以降は入金が要る」日付（yyyy-MM-dd）。null なら何も出さない。 */
  gate: string | null;
}

const NextCyclePaymentNotice = ({ gate }: Props) => {
  const { t } = useTranslation();
  if (!gate) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 mt-3" data-testid="next-cycle-payment-notice">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">
        {t("nextCyclePayment.customerNotice", { date: formatDate(parseISO(gate), "monthDayDow") })}
      </p>
    </div>
  );
};

export default NextCyclePaymentNotice;
