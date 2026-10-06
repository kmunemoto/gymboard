import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { getJSTToday } from "@/lib/timezone";

/**
 * 日ごとの「1日の上限人数まで、あと何件」（残り枠の表示用。2026-10-06）。
 *
 * 宗本さん「僕のジムの場合、一日4枠までって制限掛けてるので、その設定は考慮しないと」。
 *
 * 数えるのは DB（`get_tenant_daily_limit_left` → `tenant_day_booking_count`）。
 * 上限で閉めるガード（GB007）と同じ関数なので、画面と DB が食い違わない。
 *
 * - `trigger`（埋まり枠の配列）が変わるたびに読み直す。埋まり枠は1分ごと・戻ったとき・
 *   自分が予約したあとに読み直されるので、それに乗る（読み直しの経路を2本持たない）。
 * - 同じときに `alsoRefresh`（受付終了の日の一覧）も読み直す。上限に達した日を
 *   その場で「満」にするため。
 * - 🔴 **設定 OFF の店では何もしない**（問い合わせも出さない＝今まで通り）。
 * - 🔴 **読めなければ「上限で絞らない」**（時間だけで数える）。上限に達した日は
 *   受付終了の一覧が閉じるので、予約できない日に数字が出ることはない。
 *
 * 返すのは「その日あと何件まで受けるか」。上限が無い日は `Infinity`。
 */
const EMPTY: ReadonlyMap<string, number> = new Map();

interface Row { limit_date: string; left_count: number }

export function useDailyLimitLeft(
  enabled: boolean,
  toDate: string | null,
  trigger: unknown,
  alsoRefresh?: () => void,
): (dateKey: string) => number {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [left, setLeft] = useState<ReadonlyMap<string, number>>(EMPTY);
  const also = useRef(alsoRefresh);
  useEffect(() => {
    also.current = alsoRefresh;
  }, [alsoRefresh]);

  useEffect(() => {
    if (!enabled || !tenantId || !toDate) {
      setLeft(EMPTY);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("get_tenant_daily_limit_left" as never, {
          p_tenant_id: tenantId,
          from_date: getJSTToday(),
          to_date: toDate,
        } as never);
        if (cancelled) return;
        const rows = (error ? null : data) as Row[] | null;
        setLeft(Array.isArray(rows) ? new Map(rows.map((r) => [r.limit_date, r.left_count])) : EMPTY);
      } catch {
        if (!cancelled) setLeft(EMPTY);
      }
    })();
    also.current?.();
    return () => {
      cancelled = true;
    };
  }, [enabled, tenantId, toDate, trigger]);

  return useCallback((dateKey: string) => left.get(dateKey) ?? Number.POSITIVE_INFINITY, [left]);
}
