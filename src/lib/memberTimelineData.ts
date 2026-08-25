// 活動タイムラインの取得。
//
// 組み立て（memberTimeline.ts・純粋関数）と画面（MemberTimeline.tsx）の間に挟んで、
// DB とやり取りする部分をここに集める（CSV の書き出し・取り込みと同じ構え）。
//
// 🔴 取得はすべて tenant_id ＋ user_id で絞る。RLS も同テナントに絞っているが、
//    二重の防御にする（他のお客様の記録がカルテに混ざる事故は取り返しがつかない）。

import { supabase } from "@/integrations/supabase/client";
import {
  bookingEvents, workoutEvents, measurementEvents, paymentEvents,
  agreementEvents, photoEvents, buildTimeline, type TimelineEvent,
} from "@/lib/memberTimeline";

/**
 * 1つの種類あたり読む上限。
 *
 * 全部読むと、通い続けているお客様ほどカルテが重くなる。タイムラインは
 * 「最近どうだったか」を見るものなので、種類ごとに直近だけ読んで混ぜる。
 */
const PER_KIND = 60;

/** 混ぜたあとに残す件数。画面の初期表示ぶん。 */
export const TIMELINE_LIMIT = 40;

/** 回数に数えない status（bookingLimits.ts と同じ文字列） */
const CANCELLED_STATUS = "キャンセル済み";

export interface TimelineSource {
  tenantId: string;
  userId: string;
}

/**
 * そのお客様の活動を集めて1本の時系列にする。
 *
 * ⚠️ 種類ごとの取得は**並行**に投げる。直列にすると6往復ぶん待たされる。
 *    1つ失敗しても他は出す（握って空配列にする）。カルテが真っ白になるより、
 *    「入金だけ出ていない」のほうが害が小さい。
 */
export const loadTimeline = async ({ tenantId, userId }: TimelineSource): Promise<TimelineEvent[]> => {
  const scoped = <T,>(table: string, columns: string, dateCol: string) =>
    supabase
      .from(table as never)
      .select(columns)
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .order(dateCol, { ascending: false })
      .limit(PER_KIND) as unknown as PromiseLike<{ data: T[] | null; error: unknown }>;

  const safe = async <T,>(p: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> => {
    try {
      const { data, error } = await p;
      if (error) {
        console.warn("timeline: 一部の取得に失敗（その種類だけ出しません）", error);
        return [];
      }
      return data ?? [];
    } catch (e) {
      console.warn("timeline: 一部の取得で例外", e);
      return [];
    }
  };

  const [bookings, workouts, measurements, payments, agreements, photos] = await Promise.all([
    safe<{ id: string; booking_date: string; booking_type: string; status: string }>(
      scoped("bookings", "id, booking_date, booking_type, status", "booking_date")),
    safe<{ id: string; workout_date: string; exercises: { name: string } | null }>(
      scoped("workouts", "id, workout_date, exercises(name)", "workout_date")),
    safe<{ id: string; measured_date: string; weight: number | null; body_fat: number | null }>(
      scoped("user_measurements", "id, measured_date, weight, body_fat", "measured_date")),
    safe<{ id: string; paid_on: string; amount_yen: number; method: string | null }>(
      scoped("member_payments", "id, paid_on, amount_yen, method", "paid_on")),
    safe<{ id: string; agreed_on: string; title: string | null }>(
      scoped("member_agreements", "id, agreed_on, title", "agreed_on")),
    safe<{ id: string; taken_date: string }>(
      scoped("progress_photos", "id, taken_date", "taken_date")),
  ]);

  return buildTimeline(
    [
      bookingEvents(bookings, CANCELLED_STATUS),
      workoutEvents(workouts.map((w) => ({
        id: w.id,
        workout_date: w.workout_date,
        exercise_name: w.exercises?.name ?? null,
      }))),
      measurementEvents(measurements),
      paymentEvents(payments),
      agreementEvents(agreements),
      photoEvents(photos),
    ],
    TIMELINE_LIMIT,
  );
};
