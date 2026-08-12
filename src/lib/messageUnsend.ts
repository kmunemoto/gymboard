/**
 * 送信取り消し（24時間以内）。
 *
 * ## なぜ要るか（2026-08-12）
 *
 * 本命は**誤爆対策**。別のお客様宛てに送ってしまった、写真を取り違えた、
 * 金額を間違えた——業務アプリではここが一番効く。
 *
 * ## ⚠️ 取り消せないもの
 *
 * - **すでに飛んだプッシュ通知**。相手の通知バーに残った文言は消せない（LINE と同じ）
 * - **引用されたあとの抜粋**。引用は文字列として相手の本文に入るため
 *   （`messageReply.ts` の冒頭に、参照にしなかった理由）
 *
 * どちらも「間に合えば消える」もので、24時間の猶予はそのためのもの。
 * UI では**取り消せることを過信させない**文言にすること。
 */

/** 取り消せる時間。DB 側（`unsend_message`）と必ず同じ値にすること。 */
export const UNSEND_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface UnsendableMessage {
  sender_id: string;
  created_at: string;
  unsent_at: string | null;
}

/**
 * 取り消しメニューを出してよいか。
 *
 * ⚠️ ここは**親切のための判定**であって、防御ではない。
 *    本当の可否は `unsend_message`（SECURITY DEFINER）が決める。
 *    クライアントの時計はずれるので、境界ちょうどは DB 側の判断が正。
 */
export function canUnsend(
  message: UnsendableMessage,
  currentUserId: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!currentUserId) return false;
  // 🔴 共有受信箱でも「他のスタッフの発言」は取り消せない。
  //    誰が消したのか分からなくなるほうが困る。
  if (message.sender_id !== currentUserId) return false;
  if (message.unsent_at) return false;
  return now.getTime() - new Date(message.created_at).getTime() < UNSEND_WINDOW_MS;
}

/** 取り消し済みか。表示の出し分けに使う。 */
export const isUnsent = (m: { unsent_at: string | null }): boolean => m.unsent_at !== null;
