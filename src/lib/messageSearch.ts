/**
 * 会話の中を語句で探す。
 *
 * ## なぜ要るか（2026-08-12）
 *
 * チャットを「業務記録」として使う設計にした（予約の引用・添付の保存）。
 * ところが**記録として引く手段が無かった**。「あの話いつでしたっけ」を
 * 上へスクロールし続けて探すしかない。半年続いているお客様ほど探せない。
 *
 * ## 読み込み済みの範囲だけを探す
 *
 * `useMessages` はその会話の全件を持っている（相手ごとに引いている）ので、
 * **サーバーに問い合わせず**その場で絞れる。ネットワークもインデックスも要らない。
 */

export interface SearchableMessage {
  id: string;
  content: string;
}

/** 検索語の正規化。全角空白や大文字小文字で取りこぼさない。 */
export function normalizeQuery(q: string): string {
  return q.replace(/　/g, " ").trim().toLowerCase();
}

/**
 * ヒットしたメッセージの id を、会話の並び順のまま返す。
 *
 * ⚠️ 添付だけのメッセージ（本文が空）はヒットしない。**それでよい**。
 *    「[写真]」で全部の写真が引っかかると、探しているものが埋もれる。
 */
export function searchMessages(messages: SearchableMessage[], query: string): string[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  return messages.filter((m) => m.content.toLowerCase().includes(q)).map((m) => m.id);
}

/**
 * 前／次への移動。**端で止まらず巻き戻す**（LINE と同じ）。
 *
 * @param index いまの位置（0 始まり）
 * @param total ヒット件数
 * @param dir "next" は新しいほうへ、"prev" は古いほうへ
 */
export function stepHit(index: number, total: number, dir: "next" | "prev"): number {
  if (total === 0) return 0;
  const d = dir === "next" ? 1 : -1;
  return (index + d + total) % total;
}

/**
 * 本文をハイライト用に切り分ける。
 *
 * 🔴 ここも HTML を組み立てない（`MessageText` と同じ理由）。
 *    文字列の配列を返し、描画側が React 要素にする。
 */
export function highlightParts(
  text: string,
  query: string,
): Array<{ text: string; hit: boolean }> {
  const q = normalizeQuery(query);
  if (!q) return [{ text, hit: false }];

  const parts: Array<{ text: string; hit: boolean }> = [];
  const lower = text.toLowerCase();
  let from = 0;

  for (;;) {
    const at = lower.indexOf(q, from);
    if (at === -1) break;
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    // 元の文字列から切り出す（小文字化した文字列を出すと表示が変わる）
    parts.push({ text: text.slice(at, at + q.length), hit: true });
    from = at + q.length;
  }

  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}
