import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * 「この日以降の予約には次回分の入金が要る」日付を読む（お客様側）。
 *
 * 🔴 **判定は DB の `member_first_unpaid_cycle_start` 1本**で、ここはその戻りを
 * 運ぶだけ。規則を画面側で組み立てると、予約を止めているトリガー（GB009）とズレて
 * 「取れると見せたのに断られる」になる。
 *
 * 🔴 **読めなければ null＝何も止めない。** 設定OFF・プラン未確定・サブスク以外・
 * 全部払い済み・マイグレーション未適用・通信エラー——全部 null に倒す。
 * 予約が取れなくなるより、従来どおり取れるほうが安全（最終判定は DB が持っている）。
 * ⚠️ 例外も握る。effect の中から投げると、テストは緑のまま vitest が exit 1 する。
 */
export const useNextCyclePaymentGate = (tenantId: string | null) => {
  const [gate, setGate] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!tenantId) { setGate(null); return; }
    try {
      const { data, error } = await supabase.rpc("get_my_next_cycle_payment_gate", {
        p_tenant_id: tenantId,
      });
      setGate(error ? null : (data ?? null));
    } catch {
      setGate(null);
    }
  }, [tenantId]);

  useEffect(() => { void refetch(); }, [refetch]);

  return { gate, refetch };
};
