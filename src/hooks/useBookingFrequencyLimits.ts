import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import type { BookingFrequencyLimitRow } from "@/lib/bookingLimits";

/**
 * そのジムの予約回数の制限（`booking_frequency_limits`）を読む。
 *
 * お客様として読むと RLS が「全員向けのルール＋自分あてのルール」だけに絞る
 * （他のお客様の個別ルールは見えない）。店側（owner/trainer）は全行見える。
 *
 * 🔴 **読めなかったら空配列**。空配列＝「制限なし」＝従来どおり取れる、と
 * 解釈される。マイグレーション未適用の環境や権限の問題で読めないときに
 * **予約が取れなくなるより、従来どおり取れるほうが安全**。最終判定は
 * DB のトリガー（GB003）が持っているので、ここが緩くても抜け道にはならない。
 */
export function useBookingFrequencyLimits() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [limits, setLimits] = useState<BookingFrequencyLimitRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!tenantId) {
      setLimits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("booking_frequency_limits")
      .select("id, user_id, weekdays, start_time, end_time, period, max_bookings, enabled, exempt")
      .eq("tenant_id", tenantId);
    if (error || !data) {
      // 列・表が無い環境でも画面を止めない（＝制限なしとして扱う）。
      setLimits([]);
    } else {
      setLimits(data as BookingFrequencyLimitRow[]);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { limits, loading, refetch };
}
