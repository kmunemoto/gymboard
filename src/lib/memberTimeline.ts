// カルテの活動タイムライン（そのお客様に何が起きたかを1本の時系列にする）。
//
// なぜ要るか: カルテはタブが7本あり、来店・記録・測定・入金・同意が別々の場所にある。
// セッション前に「前回いつ来て、何をして、体重はどうで、入金は済んでいるか」を
// 知りたいのに、**4回タブを行き来しないと分からない**。
//
// 🔴 このファイルは純粋関数だけにする（DB を触らない）。
//    「何をどう混ぜて、どう並べるか」をテストできる形にするため。
//    取得は memberTimelineData.ts、画面は MemberTimeline.tsx。

import { formatJST } from "@/lib/timezone";

/** タイムラインに出す出来事の種類。画面のアイコン・色はこれで決める。 */
export type TimelineKind =
  | "booking"      // 来店（予約）
  | "cancelled"    // キャンセル
  | "workout"      // トレーニング記録
  | "measurement"  // 測定
  | "payment"      // 入金
  | "agreement"    // 同意
  | "photo";       // 写真

export interface TimelineEvent {
  /** 同じ日に同じ種類が複数あっても衝突しない一意キー */
  id: string;
  kind: TimelineKind;
  /** 並べ替えに使う時刻（ISO）。日付しか無いものは JST の 0 時にそろえる */
  at: string;
  /** 画面に出す一行。i18n のキーと差し込み値を返す（文言は画面が持つ） */
  labelKey: string;
  labelValues?: Record<string, string | number>;
  /** 補足（種目名・支払方法など）。無ければ出さない */
  detail?: string;
}

/**
 * 日付だけの列（date 型）を並べ替え可能な時刻にする。
 *
 * ⚠️ `new Date("2026-08-26")` は **UTC の 0 時**として解釈される。そのまま JST で
 *    表示すると9時間ずれて前日になる。JST の 0 時として扱う。
 */
export const dateOnlyToIso = (d: string): string => `${d}T00:00:00+09:00`;

/** 新しい順に並べる。同時刻なら種類で安定させる（描画がちらつかないように）。 */
export const sortTimeline = (events: readonly TimelineEvent[]): TimelineEvent[] =>
  [...events].sort((a, b) => {
    const diff = b.at.localeCompare(a.at);
    if (diff !== 0) return diff;
    return a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
  });

/** 表示用の日付グループ（YYYY-MM-DD, JST）。 */
export const dayKeyOf = (iso: string): string => formatJST(iso, "yyyy-MM-dd");

export interface TimelineDay {
  day: string;
  events: TimelineEvent[];
}

/**
 * 日ごとにまとめる。
 *
 * 1日に「来店・記録・測定」が並ぶのが普通なので、日付の見出しを毎行出すと読めない。
 * 入力は新しい順に並んでいる前提（sortTimeline を通したもの）。
 */
export const groupByDay = (events: readonly TimelineEvent[]): TimelineDay[] => {
  const out: TimelineDay[] = [];
  let current: TimelineDay | null = null;
  for (const e of events) {
    const day = dayKeyOf(e.at);
    if (!current || current.day !== day) {
      current = { day, events: [] };
      out.push(current);
    }
    current.events.push(e);
  }
  return out;
};

// ---------------------------------------------------------------------------
// 各テーブル → 出来事
// ---------------------------------------------------------------------------
//
// 🔴 ここに「どの行を出さないか」の判断を集める。画面に散らすと、
//    種類を足したときに片方だけ直して食い違う。

/** 予約。キャンセルは別の種類として出す（消さない。来なかったことも事実）。 */
export const bookingEvents = (
  rows: readonly { id: string; booking_date: string; booking_type: string; status: string }[],
  cancelledStatus: string,
): TimelineEvent[] =>
  rows.map((r) => ({
    id: `booking:${r.id}`,
    kind: r.status === cancelledStatus ? ("cancelled" as const) : ("booking" as const),
    at: r.booking_date,
    labelKey: r.status === cancelledStatus ? "timeline.cancelled" : "timeline.booking",
    labelValues: { type: r.booking_type },
  }));

/**
 * トレーニング記録。
 *
 * ⚠️ 1回のセッションで種目ぶんの行ができる（10種目なら10行）。そのまま出すと
 *    タイムラインが記録で埋まるので、**日ごとに1件**に畳んで種目数を出す。
 */
export const workoutEvents = (
  rows: readonly { id: string; workout_date: string; exercise_name?: string | null }[],
): TimelineEvent[] => {
  const byDay = new Map<string, { count: number; names: string[] }>();
  for (const r of rows) {
    const hit = byDay.get(r.workout_date) ?? { count: 0, names: [] };
    hit.count += 1;
    if (r.exercise_name && !hit.names.includes(r.exercise_name)) hit.names.push(r.exercise_name);
    byDay.set(r.workout_date, hit);
  }
  return [...byDay.entries()].map(([day, v]) => ({
    id: `workout:${day}`,
    kind: "workout" as const,
    at: dateOnlyToIso(day),
    labelKey: "timeline.workout",
    labelValues: { count: v.count },
    // 種目名は多いと読めないので先頭3つまで
    detail: v.names.slice(0, 3).join("・") || undefined,
  }));
};

export const measurementEvents = (
  rows: readonly { id: string; measured_date: string; weight?: number | null; body_fat?: number | null }[],
): TimelineEvent[] =>
  rows.map((r) => ({
    id: `measurement:${r.id}`,
    kind: "measurement" as const,
    at: dateOnlyToIso(r.measured_date),
    labelKey: "timeline.measurement",
    labelValues: {
      weight: r.weight != null ? String(r.weight) : "-",
      fat: r.body_fat != null ? String(r.body_fat) : "-",
    },
  }));

export const paymentEvents = (
  rows: readonly { id: string; paid_on: string; amount_yen: number; method?: string | null }[],
): TimelineEvent[] =>
  rows.map((r) => ({
    id: `payment:${r.id}`,
    kind: "payment" as const,
    at: dateOnlyToIso(r.paid_on),
    labelKey: "timeline.payment",
    labelValues: { amount: r.amount_yen.toLocaleString("ja-JP") },
    detail: r.method ?? undefined,
  }));

export const agreementEvents = (
  rows: readonly { id: string; agreed_on: string; title?: string | null }[],
): TimelineEvent[] =>
  rows.map((r) => ({
    id: `agreement:${r.id}`,
    kind: "agreement" as const,
    at: dateOnlyToIso(r.agreed_on),
    labelKey: "timeline.agreement",
    detail: r.title ?? undefined,
  }));

export const photoEvents = (
  rows: readonly { id: string; taken_date: string }[],
): TimelineEvent[] =>
  rows.map((r) => ({
    id: `photo:${r.id}`,
    kind: "photo" as const,
    at: dateOnlyToIso(r.taken_date),
    labelKey: "timeline.photo",
  }));

/** 全部混ぜて新しい順に並べ、上限まで切る。 */
export const buildTimeline = (
  parts: readonly TimelineEvent[][],
  limit: number,
): TimelineEvent[] => sortTimeline(parts.flat()).slice(0, limit);
