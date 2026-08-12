/**
 * 会話一覧の並び順。
 *
 * ## なぜ変えたか（2026-08-12）
 *
 * 以前は「未読がある人が上、あとは名簿の取得順」だった。つまり:
 *
 *   ・今まさにやり取りしている相手が、**一覧の下のほう**に埋もれる
 *   ・既読にした瞬間に**その会話が飛んでいく**（読んだら定位置を失う）
 *   ・返信しようとしてスクロールで探すことになる
 *
 * LINE と同じ「**最後にやり取りした順**」にする。未読は新着なので、
 * 時刻順にすれば自然に上に来る（バッジでも分かる）ので、未読優先はやめた。
 *
 * 一度もやり取りが無い相手は下にまとめる。**一覧から消しはしない**
 * （こちらから声をかける相手がいなくなる）。その中は名前順。
 */

export interface LastMessageInfo {
  /** 一覧に出すプレビュー本文（添付だけなら「[写真]」等） */
  content: string;
  /** 一覧に出す時刻の表示文字列 */
  time: string;
  /** 並べ替えに使う元の created_at（ISO）。表示用の time では順序が作れない */
  at: string;
}

interface Conversation {
  user_id: string;
  display_name: string | null;
}

/**
 * 最終メッセージが新しい順。やり取りの無い相手は末尾に名前順で。
 *
 * ⚠️ 破壊的に並べ替えない（呼び出し元の state をその場で書き換えない）。
 */
export function sortConversations<T extends Conversation>(
  list: T[],
  lastMessages: Record<string, LastMessageInfo | undefined>,
): T[] {
  const at = (c: T) => lastMessages[c.user_id]?.at ?? null;

  return [...list].sort((a, b) => {
    const aAt = at(a);
    const bAt = at(b);

    // やり取りのある相手が先。片方だけ持っているならそちらが上。
    if (aAt && !bAt) return -1;
    if (!aAt && bAt) return 1;

    if (aAt && bAt) {
      const diff = new Date(bAt).getTime() - new Date(aAt).getTime();
      if (diff !== 0) return diff;
      // 同時刻（テストや一括投入で起こりうる）は名前で安定させる
      return compareName(a, b);
    }

    return compareName(a, b);
  });
}

/** 名前順。未設定は末尾へ（空文字が先頭に固まると探しにくい）。 */
function compareName(a: Conversation, b: Conversation): number {
  const an = a.display_name?.trim() || "";
  const bn = b.display_name?.trim() || "";
  if (an && !bn) return -1;
  if (!an && bn) return 1;
  if (an === bn) return a.user_id.localeCompare(b.user_id);
  return an.localeCompare(bn, "ja");
}
