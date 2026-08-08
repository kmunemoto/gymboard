import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyTenantId } from "@/lib/tenantHelper";
import type { MemberPayment, PaymentKind, PaymentMethod } from "@/lib/memberPayments";

/**
 * 入金の記録（`member_payments`）の読み書き。
 *
 * ── 🔴 これは「記録」であって「決済」ではない ────────────────
 * アプリはお金を動かさない。現金・振込・カードでジムが受け取った事実を残すだけ。
 *
 * ── 誰が書けるか ────────────────────────────────────────────
 * INSERT / UPDATE / DELETE は RLS でジム側（trainer ロール）のみ。
 * お客様は自分の行を SELECT できるだけで、自分で「払った」ことにはできない。
 * **この非対称はセキュリティの本体なので、`as any` で握り潰したくなっても
 * ポリシーの側を緩めないこと。**
 */

export interface NewMemberPayment {
  userId: string;
  amountYen: number;
  paidOn: string; // YYYY-MM-DD
  method: PaymentMethod;
  kind: PaymentKind;
  planName: string | null;
  note: string | null;
}

/** ひとりの顧客の入金履歴（カルテ用） */
export const useMemberPayments = (userId: string | null) => {
  const [payments, setPayments] = useState<MemberPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayments = useCallback(async () => {
    if (!userId) {
      setPayments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("member_payments")
      .select("*")
      .eq("user_id", userId)
      .order("paid_on", { ascending: false });
    // マイグレーション未適用の環境では取得エラーになる。空扱いにして画面は落とさない
    // （体験フォローの follow_up_status と同じ方針）。
    setPayments(error ? [] : ((data ?? []) as MemberPayment[]));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const addPayment = async (input: NewMemberPayment) => {
    const tenantId = await fetchMyTenantId();
    if (!tenantId) return { error: new Error("ジムの情報が取得できませんでした") };
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from("member_payments").insert({
      tenant_id: tenantId,
      user_id: input.userId,
      amount_yen: input.amountYen,
      paid_on: input.paidOn,
      method: input.method,
      kind: input.kind,
      plan_name: input.planName,
      note: input.note,
      recorded_by: user?.id ?? null,
    });
    if (error) return { error };
    await fetchPayments();
    return { error: null };
  };

  const deletePayment = async (id: string) => {
    const { error } = await supabase.from("member_payments").delete().eq("id", id);
    if (error) return { error };
    await fetchPayments();
    return { error: null };
  };

  return { payments, loading, refetch: fetchPayments, addPayment, deletePayment };
};

/**
 * 自テナントの入金を月範囲で取る（ダッシュボードの売上・未記録用）。
 *
 * ⚠️ 全期間を引かない。行数は年々増えるので、必ず `fromMonth` で下限を切る。
 */
export const useTenantPayments = (fromMonth: string | null) => {
  const [payments, setPayments] = useState<MemberPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayments = useCallback(async () => {
    if (!fromMonth) {
      setPayments([]);
      setLoading(false);
      return;
    }
    const tenantId = await fetchMyTenantId();
    if (!tenantId) {
      setPayments([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("member_payments")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("paid_on", `${fromMonth}-01`)
      .order("paid_on", { ascending: false });
    setPayments(error ? [] : ((data ?? []) as MemberPayment[]));
    setLoading(false);
  }, [fromMonth]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  return { payments, loading, refetch: fetchPayments };
};
