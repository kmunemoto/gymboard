import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { fetchAllRows } from "./fetchAllRows";

/**
 * 予定表（useAllBookings）の材料: 予約・体験予約・ブロック枠を**全件**読む（2026-11-02）。
 *
 * 🔴 以前は1回の問い合わせで読んでいて、ジムの予約が1000件を超えると、いちばん新しい
 *    （＝これからの）予約から黙って欠けるところだった（御所南は 2026-11 時点で688件・月150件ほど増える）。
 *    予定表の回数のチップ・利用期間は、お客様の今のプランの1回目の予約までさかのぼって数えるので、
 *    期間で絞らずに全件読む（fetchAllRows。mem/ops/postgrest-max-rows.md）。
 *
 * 返す形は supabase の応答と同じ `{ data, error }` の3つ組。予約が読めなかったときは error を返し、
 * 体験・ブロックが読めなかったときは空として扱う（従来どおり。呼び出し側は予約の error だけを見る）。
 */
export async function fetchScheduleRows() {
  const byId = (r: { id: string }) => r.id;
  const settle = <T,>(p: Promise<T[]>): Promise<{ data: T[] | null; error: Error | null }> =>
    p.then(
      (data) => ({ data, error: null }),
      (e: unknown) => ({ data: null, error: e instanceof Error ? e : new Error(String(e)) }),
    );
  return Promise.all([
    settle(fetchAllRows<Tables<"bookings">>((from, to) =>
      supabase.from("bookings").select("*")
        .order("booking_date", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to), { key: byId })),
    settle(fetchAllRows<Tables<"trial_bookings">>((from, to) =>
      supabase.from("trial_bookings").select("*")
        .order("booking_date", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to), { key: byId })),
    settle(fetchAllRows<Tables<"blocked_slots">>((from, to) =>
      supabase.from("blocked_slots").select("*")
        .order("id", { ascending: true })
        .range(from, to), { key: byId })),
  ] as const);
}
