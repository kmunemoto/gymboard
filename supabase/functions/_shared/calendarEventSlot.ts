/**
 * 店の Google カレンダーの予定を「1予約1件」にするための決まり（2026-11-11・定期点検 google-calendar-sync-3）。
 *
 * 予約行の google_event_id が「この予約の予定」を指す。以前の google-calendar-sync は、列が空なら予定を作って
 * あとから列に書き戻していたので、確かめてから書き戻すまでの間に create を何度も（同時に）呼ぶと、呼んだ数だけ
 * 店のカレンダーに予定が増えた。今は予定を作る前に、条件付きの UPDATE で列に「作っている印」を入れる
 * （＝作る権利を取る。同時に呼ばれても1つしか取れない）。作れたら印を本物の ID に置き換え、置き換えられなかった
 * （その間に予約が取り消されて印が外された）ら、作った予定を消す。
 *
 * - 印は Google の予定 ID には使われない ":" を含むので、本物の ID と取り違えない。
 * - 印が古い（作っていた呼び出しが途中で落ちた）ときは、その印を条件に取り直す。
 * - Google の予定 ID の形（base32hex の小文字 a〜v と数字・5〜1024文字）でない値は、Google に送らない。
 *
 * 画面（お客様・店）はこの列を書けない（DB の門番。supabase/migrations/20261111030000_*.sql）。
 * 見張り: src/test/googleCalendarSyncAuthz.test.ts
 */

/** Google カレンダーの予定 ID の形（Calendar API の events.id の決まり: base32hex の小文字と数字・5〜1024文字） */
export const GOOGLE_EVENT_ID_PATTERN = /^[a-v0-9]{5,1024}$/;

export const isGoogleEventId = (value: unknown): value is string =>
  typeof value === "string" && GOOGLE_EVENT_ID_PATTERN.test(value);

/** 予定を作っている間の印の頭 */
export const EVENT_CLAIM_PREFIX = "creating:";

/** 印がこれより古ければ、作っていた呼び出しは途中で落ちたとみなして取り直す */
export const EVENT_CLAIM_TTL_MS = 2 * 60 * 1000;

export const makeEventClaim = (nowMs: number, nonce: string): string => `${EVENT_CLAIM_PREFIX}${nowMs}:${nonce}`;

/** 印なら作り始めた時刻（ミリ秒）。壊れた印は 0（とても古い扱い）。印でなければ null */
export const eventClaimStartedAt = (value: string | null | undefined): number | null => {
  if (typeof value !== "string" || !value.startsWith(EVENT_CLAIM_PREFIX)) return null;
  const ms = Number(value.slice(EVENT_CLAIM_PREFIX.length).split(":")[0]);
  return Number.isFinite(ms) ? ms : 0;
};

export type EventSlot =
  /** 列が空 → 列が空のままであることを条件に、作る権利を取る */
  | { kind: "empty" }
  /** 本物の予定 ID → 今のカレンダーにあるか確かめる（無ければ、その ID を条件に取り直す） */
  | { kind: "check"; eventId: string }
  /** ほかの呼び出しが作っている最中 → 何もしない */
  | { kind: "in_progress" }
  /** 古い印・形の合わない値 → その値を条件に取り直す */
  | { kind: "reclaim"; expected: string };

export const eventSlotOf = (current: string | null | undefined, nowMs: number): EventSlot => {
  if (!current) return { kind: "empty" };
  const startedAt = eventClaimStartedAt(current);
  if (startedAt !== null) {
    const age = nowMs - startedAt;
    // 時計の少しのずれ（別のインスタンスが少し先を進んでいる）も「作っている最中」に入れる
    return age > -EVENT_CLAIM_TTL_MS && age < EVENT_CLAIM_TTL_MS
      ? { kind: "in_progress" }
      : { kind: "reclaim", expected: current };
  }
  if (isGoogleEventId(current)) return { kind: "check", eventId: current };
  return { kind: "reclaim", expected: current };
};

/** 予定を作らない予約の状態（取り消し・当日の取り消しで消化） */
export const CANCELLED_BOOKING_STATUSES: ReadonlySet<string> = new Set(["キャンセル済み", "同日キャンセル済み"]);
