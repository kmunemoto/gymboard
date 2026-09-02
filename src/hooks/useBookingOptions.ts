import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { activeOptions, type BookingOption } from "@/lib/bookingOptions";

/**
 * そのジムの予約オプション（`booking_options`）。
 *
 * ログイン済みの画面用（お客様の予約画面・店側の代理予約）。公開ページ
 * （体験・ドロップイン）は anon なので `get_tenant_booking_options` RPC を使う
 * ——が、この版ではまだ公開ページにオプションを出さない。
 *
 * 🔴 **読めなかったら空配列**（`useBookingQuestions` と同じ規則）。
 * オプションが読めないせいで予約自体ができなくなるより、オプション無しで
 * 予約できるほうが安全。マイグレーション未適用の環境でも従来どおり動く。
 *
 * 返すのは**受付中のものだけ**（`activeOptions`）。停止中のオプションは
 * 選択肢に出さない。
 */
export function useBookingOptions() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [options, setOptions] = useState<BookingOption[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!tenantId) {
      setOptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("booking_options")
      .select("id, name, duration_minutes, price_yen, description, enabled, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true });
    if (error || !data) {
      setOptions([]);
    } else {
      setOptions(
        activeOptions(
          (data as Record<string, unknown>[]).map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            duration_minutes: typeof row.duration_minutes === "number" ? row.duration_minutes : 0,
            price_yen: typeof row.price_yen === "number" ? row.price_yen : 0,
            description: (row.description as string | null) ?? null,
            enabled: row.enabled !== false,
            sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
          })),
        ),
      );
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { options, loading, refetch };
}
