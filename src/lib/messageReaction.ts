/**
 * メッセージへのリアクション。
 *
 * ## なぜ要るか（2026-08-12）
 *
 * 「返信するほどではないが、読んだと伝えたい」が言えない。いまは
 * 「ありがとうございます」だけの吹き出しが並ぶか、既読で済ませるかの二択。
 * 既読は**開いただけでも付く**ので、「見た」と「受け取った」の区別がない。
 *
 * ## 🔴 絵文字は使わない
 *
 * このリポジトリの規約は「アイコンは Lucide React のみ。絵文字は使わない」。
 * DB には**種別のキー**だけを入れ、描画側が Lucide のアイコンに割り当てる。
 *
 * ## 🔴 通知は鳴らさない
 *
 * `message_reactions` は別テーブルなので、`messages` の AFTER INSERT トリガー
 * （`notify_new_message`）の対象外。**プッシュは飛ばない。**
 * 気軽に押せることが価値なので、ここに通知を足さないこと。
 */

/** 固定4種。増やすときは DB の CHECK 制約とアイコン割り当ても一緒に。 */
export const REACTION_KINDS = ["thumbsUp", "heart", "check", "smile"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const isReactionKind = (v: string): v is ReactionKind =>
  (REACTION_KINDS as readonly string[]).includes(v);

export interface Reaction {
  message_id: string;
  user_id: string;
  kind: ReactionKind;
}

export interface ReactionSummary {
  kind: ReactionKind;
  count: number;
  /** 自分が押しているか。押し直し（解除）の判定に使う */
  mine: boolean;
}

/**
 * 1つのメッセージ分のリアクションを、表示用にまとめる。
 *
 * ⚠️ 並びは `REACTION_KINDS` の順に固定する。件数順にすると、
 *    誰かが押すたびに**チップが入れ替わって**押し間違える。
 */
export function summarize(
  reactions: Reaction[],
  currentUserId: string | null | undefined,
): ReactionSummary[] {
  return REACTION_KINDS.map((kind) => {
    const of = reactions.filter((r) => r.kind === kind);
    return {
      kind,
      count: of.length,
      mine: !!currentUserId && of.some((r) => r.user_id === currentUserId),
    };
  }).filter((s) => s.count > 0);
}

/** メッセージ id ごとに配る。 */
export function groupByMessage(reactions: Reaction[]): Map<string, Reaction[]> {
  const map = new Map<string, Reaction[]>();
  for (const r of reactions) {
    const list = map.get(r.message_id);
    if (list) list.push(r);
    else map.set(r.message_id, [r]);
  }
  return map;
}
