import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import type { ClosedDay } from "@/lib/bookingClosedDays";

/**
 * 受付を終了した日（手で閉めた日＋上限に達した日）を読む。
 *
 * 🔴 読み口は **RPC `get_tenant_closed_days` 1本**。
 * 「手で閉めた」と「上限に達した」を画面側で組み立てさせない。組み立てさせると、
 * 会員アプリ・公開の体験ページ・ドロップインページの3か所に同じ規則が散り、
 * どれか1つだけ直し忘れて**空きに見える日が予約できない**ことになる。
 * RPC は SECURITY DEFINER なので匿名（公開ページ）からも同じ答えが読める。
 *
 * 🔴 **読めなかったら空配列**。空配列＝「閉まっている日は無い」＝従来どおり全日受け付ける。
 * マイグレーション未適用の環境で**予約が取れなくなるより、従来どおり取れるほうが安全**。
 * 最終判定は DB のトリガー（GB007）が持っているので、ここが緩くても抜け道にならない。
 */
export function useBookingClosedDays(
  fromDate: string | null,
  toDate: string | null,
  tenantIdOverride?: string | null,
) {
  const { tenant } = useTenant();
  const tenantId = tenantIdOverride !== undefined ? tenantIdOverride : (tenant?.id ?? null);
  const [closedDays, setClosedDays] = useState<ClosedDay[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!tenantId || !fromDate || !toDate) {
      setClosedDays([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("get_tenant_closed_days", {
      p_tenant_id: tenantId,
      from_date: fromDate,
      to_date: toDate,
    });
    if (error || !data) {
      setClosedDays([]);
    } else {
      setClosedDays(data as ClosedDay[]);
    }
    setLoading(false);
  }, [tenantId, fromDate, toDate]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { closedDays, loading, refetch };
}

/**
 * その日を閉める／解除する（ジム側）。
 *
 * 閉めるのは INSERT 1件、解除は DELETE 1件。`(tenant_id, closed_date)` に一意制約が
 * あるので、連打しても行は増えない（同じ日を二重に閉められない）。
 */
export function useCloseDay() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [saving, setSaving] = useState(false);

  const close = useCallback(
    async (dateKey: string, reason?: string | null): Promise<{ error: unknown }> => {
      if (!tenantId) return { error: new Error("no tenant") };
      setSaving(true);
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        setSaving(false);
        return { error: new Error("not signed in") };
      }
      const { error } = await supabase.from("booking_closed_days").insert({
        tenant_id: tenantId,
        closed_date: dateKey,
        created_by: uid,
        ...(reason ? { reason } : {}),
      });
      setSaving(false);
      return { error };
    },
    [tenantId],
  );

  const reopen = useCallback(
    async (dateKey: string): Promise<{ error: unknown }> => {
      if (!tenantId) return { error: new Error("no tenant") };
      setSaving(true);
      const { error } = await supabase
        .from("booking_closed_days")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("closed_date", dateKey);
      setSaving(false);
      return { error };
    },
    [tenantId],
  );

  return { close, reopen, saving };
}
