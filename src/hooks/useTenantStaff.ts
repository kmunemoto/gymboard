/**
 * 自分が所属するジムのスタッフ一覧を読むフック。
 * 予約の担当者セレクタ（お客様側・ジム側）とスタッフ管理画面で使う。
 *
 * useTenant() がテナントを解決するまでは空配列を返す。担当セレクタは
 * `canSelectStaff()`（2人以上）で出し分けるので、未ロード中は自然に非表示になる。
 */
import { useCallback, useEffect, useState } from "react";
import { useTenant } from "@/hooks/useTenant";
import { fetchTenantStaff, type TenantStaff } from "@/lib/tenantStaff";

export function useTenantStaff() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [staff, setStaff] = useState<TenantStaff[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!tenantId) {
      setStaff([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setStaff(await fetchTenantStaff(tenantId));
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void refetch(); }, [refetch]);

  return { staff, loading, refetch };
}
