import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { getJSTNow } from "@/lib/timezone";

const EMPTY: ReadonlySet<string> = new Set();

/** 何日先まで読むか。RPC の上限（92日）に合わせる。 */
const DAYS_AHEAD = 92;

/**
 * 体験予約ページ: 「体験も含めた1日の上限（合計）」に達した日（2026-10-14）。
 *
 * 宗本さん「体験予約もその日がすでに5枠埋まっていれば体験予約も取れない様にしたい」。
 * 判定は DB の `tenant_day_total_reached`（`get_tenant_trial_closed_days` が同じ関数で返す）。
 *
 * - 🔴 **手で止めた日・会員の上限に達した日は入っていない。** どちらも体験は通る
 *   （2026-09-01「体験は上限なく」／2026-09-19「赤い日でも体験は入れられる様にして」）。
 *   合計の上限を設定していない店では、いつも空（＝今まで通り）。
 * - 🔴 **読めなければ空**＝「止める日は無い」に倒す。判定できないせいで新規のお客様を
 *   断るほうが実害が大きい。最終判定は DB のトリガー（GB007）が持っている。
 * - `recheck` は送信の直前に読み直す用。開いている間に埋まることがあり、
 *   trial-book は GB007 を業務上の拒否として扱わない（お客様には汎用の失敗しか出ない）。
 */
export function useTrialFullDays(enabled: boolean, tenantId: string | null | undefined) {
  const [fullDays, setFullDays] = useState<ReadonlySet<string>>(EMPTY);

  const load = useCallback(async (): Promise<ReadonlySet<string>> => {
    // フラグOFF（体験予約を出していないフォーク）では RPC を1本も呼ばない
    if (!enabled || !tenantId) {
      setFullDays(EMPTY);
      return EMPTY;
    }
    const today = getJSTNow();
    const end = new Date(today);
    end.setDate(today.getDate() + DAYS_AHEAD);
    try {
      const { data, error } = await supabase.rpc("get_tenant_trial_closed_days", {
        p_tenant_id: tenantId,
        from_date: format(today, "yyyy-MM-dd"),
        to_date: format(end, "yyyy-MM-dd"),
      });
      const next: ReadonlySet<string> =
        error || !Array.isArray(data) ? EMPTY : new Set(data.map((r) => String(r.closed_date)));
      setFullDays(next);
      return next;
    } catch {
      setFullDays(EMPTY);
      return EMPTY;
    }
  }, [enabled, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isFull = useCallback((dateKey: string): boolean => fullDays.has(dateKey), [fullDays]);
  const recheck = useCallback(async (dateKey: string): Promise<boolean> => (await load()).has(dateKey), [load]);

  return { isFull, recheck };
}
