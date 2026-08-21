import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import type { BookingBlockedWindow } from "@/lib/bookingBlockedWindows";

/**
 * そのジムの受付しない時間帯（`booking_blocked_windows`）を読む。
 *
 * 🔴 **読めなかったら空配列**。空配列＝「帯なし」＝従来どおり全枠を受け付ける。
 * マイグレーション未適用の環境や権限の問題で読めないときに**予約が取れなくなるより、
 * 従来どおり取れるほうが安全**。最終判定は DB のトリガー（GB006）が持っているので、
 * ここが緩くても抜け道にならない。
 *
 * 会員向け（ログイン済み）。公開ページ（体験・ドロップイン）には効かせないので
 * anon 向けの読み口は用意していない。
 */
export function useBookingBlockedWindows() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [windows, setWindows] = useState<BookingBlockedWindow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!tenantId) {
      setWindows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("booking_blocked_windows")
      .select("weekdays, start_time, end_time")
      .eq("tenant_id", tenantId)
      // 無効の帯は最初から渡さない（判定関数に enabled の判断を持たせない）
      .eq("enabled", true);
    if (error || !data) {
      // 列・表が無い環境でも画面を止めない（＝帯なしとして扱う）。
      setWindows([]);
    } else {
      setWindows(data as BookingBlockedWindow[]);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { windows, loading, refetch };
}
