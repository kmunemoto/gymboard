import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyTenantId } from "@/lib/tenantHelper";
import { getJSTToday } from "@/lib/timezone";
import type { PaymentMethod } from "@/lib/memberPayments";

/**
 * カルテの「次回分 入金済み」（`member_payments.covers_cycle_start`）。
 *
 * 🔴 **素の ON/OFF にしない。** 素のフラグだと次のサイクルが来ても ON のままで、
 * 毎月 全会員ぶん手で戻すことになり、必ず忘れる。忘れた瞬間「誰も止まらない仕組み」に
 * 変わってしまう。**どのサイクル分を受け取ったか**を行として持てば、
 * サイクルが進むだけで自動的に「未入金」に戻る（戻す作業がゼロになる）。
 *
 * 窓の出どころは DB の `get_member_next_cycle_gate`。画面で暦を組み立てない
 * （組み立てると、予約を止めている `member_first_unpaid_cycle_start` とズレる）。
 */
export interface MemberNextCycleGate {
  /** 次のサイクル窓の開始日（yyyy-MM-dd） */
  cycleStart: string;
  /** 次のサイクル窓の終わり。**含まない**（表示は前日にする。formatCycleRange 参照） */
  cycleEnd: string;
  paid: boolean;
  /** 入金済みのときの行 id（取り消し用） */
  paymentId: string | null;
}

interface MarkPaidInput {
  amountYen: number;
  method: PaymentMethod;
  planName: string | null;
}

export const useMemberNextCycleGate = (userId: string | null) => {
  const [gate, setGate] = useState<MemberNextCycleGate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    if (!userId) { setGate(null); setLoading(false); return; }
    setLoading(true);
    // 🔴 **投げさせない。** 読めなければ null＝トグルを出さない＝従来どおりの画面にする。
    //    マイグレーション未適用の環境・RPC が無い環境でも落ちない。
    //    ⚠️ try/catch が要る。ここを素で await にしていたら、テストの supabase モックに
    //    rpc が無い環境で **effect の中から例外が飛び**、it() は緑のまま
    //    「Errors 4」で vitest が exit 1 した（2026-09-22。CLAUDE.md が警告している形）。
    //    プラン未確定・回数券・期間制のお客様は DB が 0 行を返すので、同じ経路になる。
    let row: MemberNextCycleGate | null = null;
    try {
      const { data, error } = await supabase.rpc("get_member_next_cycle_gate", { p_user_id: userId });
      const r = (error ? null : data?.[0]) ?? null;
      if (r) row = { cycleStart: r.cycle_start, cycleEnd: r.cycle_end, paid: r.paid, paymentId: r.payment_id };
    } catch {
      row = null;
    }
    setGate(row);
    setLoading(false);
  }, [userId]);

  useEffect(() => { void refetch(); }, [refetch]);

  /** 次回分を「入金済み」にする＝入金を1行足す。 */
  const markPaid = async (input: MarkPaidInput) => {
    if (!userId || !gate) return { error: new Error("対象のサイクルが取得できませんでした") };
    const tenantId = await fetchMyTenantId();
    if (!tenantId) return { error: new Error("ジムの情報が取得できませんでした") };
    const { data: { user } } = await supabase.auth.getUser();
    setSaving(true);
    const { error } = await supabase.from("member_payments").insert({
      tenant_id: tenantId,
      user_id: userId,
      amount_yen: input.amountYen,
      // 受け取った日は押した日（対面でその場、振込なら確認できた日）。
      // 🔴 充当先は covers_cycle_start が持つので、paid_on とサイクルは別物でよい。
      paid_on: getJSTToday(),
      method: input.method,
      kind: "月謝",
      plan_name: input.planName,
      covers_cycle_start: gate.cycleStart,
      recorded_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) return { error };
    await refetch();
    return { error: null };
  };

  /** 押し間違いの取り消し。行を消すので、次回分はまた「未入金」に戻る。 */
  const undoPaid = async () => {
    if (!gate?.paymentId) return { error: new Error("取り消す記録がありません") };
    setSaving(true);
    const { error } = await supabase.from("member_payments").delete().eq("id", gate.paymentId);
    setSaving(false);
    if (error) return { error };
    await refetch();
    return { error: null };
  };

  return { gate, loading, saving, refetch, markPaid, undoPaid };
};
