import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import type { BookingCapacityWindow } from "@/lib/bookingCapacity";

/**
 * そのジムの時間帯別の同時受け入れ数（`booking_capacity_windows`）を読む。
 *
 * 🔴 **読めなかったら空配列**。空配列＝「帯なし」＝ `tenants.booking_capacity` を
 * そのまま使う、という従来どおりの挙動になる。マイグレーション未適用の環境や
 * 権限の問題で読めないときに**予約が取れなくなるより、従来どおり取れるほうが安全**。
 * 最終判定は DB のトリガーが持っているので、ここが緩くても抜け道にならない。
 *
 * 会員向け（ログイン済み）。公開ページ（体験・ドロップイン）は表を直接読めないので
 * RPC `get_tenant_capacity_windows` を使う。
 */
export function useBookingCapacityWindows() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [windows, setWindows] = useState<BookingCapacityWindow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!tenantId) {
      setWindows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("booking_capacity_windows")
      .select("weekdays, start_time, end_time, capacity")
      .eq("tenant_id", tenantId)
      // 無効の帯は最初から渡さない（解決関数に enabled の判断を持たせない）
      .eq("enabled", true);
    if (error || !data) {
      // 列・表が無い環境でも画面を止めない（＝帯なしとして扱う）。
      setWindows([]);
    } else {
      setWindows(data as BookingCapacityWindow[]);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { windows, loading, refetch };
}
