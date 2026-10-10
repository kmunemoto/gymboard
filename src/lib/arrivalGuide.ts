/**
 * 「ご来店は 13:55 以降にお願いします」（2026-10-10）。
 *
 * 宗本さん「予約を受けた時にお客様にセッション開始の5分前以内にお越しください。
 * のメッセージを伝えたい。10分前とかに来られると困るから」。
 *
 * ## 🔴 引き算をお客様にさせない
 *
 * 「5分前以内に」と書くだけだと、お客様が自分で引き算する。読み流されやすいので、
 * **その予約の開始時刻から計算した時刻**（14:00 開始・5分前なら 13:55）を出す。
 *
 * ## 🔴 設定していない店には何も出さない
 *
 * 何分前から来てよいかは店ごとに違う（`tenants.arrival_lead_minutes`）。
 * 既定は NULL＝出さない。上流が代弁しない（`cancel_policy_body` と同じ方針）。
 */
import { minutesToTime, parseTimeToMinutes } from "@/lib/businessHours";

/** 設定画面の選択肢（分）。DB の CHECK は 1〜60 で、こちらはその中の選びやすい値だけ。 */
export const ARRIVAL_LEAD_OPTIONS: readonly number[] = [3, 5, 10, 15, 20, 30];

/** DB の CHECK 制約と同じ範囲（`20261010010000_arrival_lead_minutes.sql`。テストが一致を見張る）。 */
export const ARRIVAL_LEAD_MIN = 1;
export const ARRIVAL_LEAD_MAX = 60;

/** 保存・表示に使える値に整える。範囲外・整数でない・数字でないものは null（＝出さない）。 */
export const normalizeArrivalLead = (raw: unknown): number | null => {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= ARRIVAL_LEAD_MIN && raw <= ARRIVAL_LEAD_MAX ? raw : null;
};

/**
 * お客様に案内する「この時刻以降に来てください」。
 *
 * - 設定が無い（null・未設定・範囲外）／開始時刻が読めない → null（何も出さない）
 * - 日をまたがない。0:03 開始で 5 分前なら 00:00（前日の 23:58 にはしない）
 */
export const arrivalFromTime = (startTime: string | null | undefined, lead: unknown): string | null => {
  const minutes = normalizeArrivalLead(lead);
  if (minutes === null) return null;
  const start = parseTimeToMinutes(startTime);
  if (start === null) return null;
  return minutesToTime(Math.max(0, start - minutes));
};
