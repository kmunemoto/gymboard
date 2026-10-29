import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { parseMenus, type BookingMenu } from "@/lib/bookingMenus";

/**
 * そのジムの予約メニュー（`booking_menus`・2026-10-28）。外したもの（is_active=false）も含めて返す
 * （過去の予約に名前を出すため）。お客様に出すものは `selectableMenus` で絞る。
 *
 * 🔴 **読めなかったら空配列**＝メニューを使っていない店と同じ（今まで通りの予約画面）。
 * メニューが読めないせいで予約自体ができなくなるより、メニュー無しで予約できるほうが安全
 * （メニューを送らなければ DB が担当のいない先頭のメニューとして記録する）。
 */
export function useBookingMenus() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [menus, setMenus] = useState<BookingMenu[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!tenantId) {
      setMenus([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // 開始日の列（starts_on・2026-10-29）が無い環境では、列を外して読み直す（全部「すぐ」＝今まで通り）
    const query = (cols: string) =>
      supabase
        .from("booking_menus")
        .select(cols)
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true });
    let { data, error } = await query("id, name, staff_user_id, is_active, sort_order, starts_on");
    if (error) ({ data, error } = await query("id, name, staff_user_id, is_active, sort_order"));
    setMenus(error ? [] : parseMenus(data));
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { menus, loading, refetch };
}
