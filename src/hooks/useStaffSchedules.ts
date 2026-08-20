import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import type { StaffScheduleRow } from "@/lib/staffSchedule";

/**
 * そのジムのスタッフのシフト（`staff_schedules`）を全員ぶん読む。
 *
 * 全員ぶんを1回で取るのは、予約画面が「この曜日に出勤しているスタッフだけを出す」
 * ために結局全員のシフトを要るため（1人ずつ引くと担当の数だけ往復する）。
 *
 * 🔴 **読めなかったら空配列**。空配列＝「誰もシフト未設定」＝営業時間どおり、と
 * 解釈される（`src/lib/staffSchedule.ts`）。マイグレーション未適用の環境や
 * 権限の問題で読めないときに**予約が取れなくなるより、従来どおり取れるほうが安全**。
 */
export function useStaffSchedules() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!tenantId) {
      setSchedules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("staff_schedules")
      .select("user_id, weekday, start_time, end_time")
      .eq("tenant_id", tenantId);
    if (error || !data) {
      // 列・表が無い環境でも画面を止めない（＝シフト未設定として扱う）。
      setSchedules([]);
    } else {
      setSchedules(data as StaffScheduleRow[]);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { schedules, loading, refetch };
}
