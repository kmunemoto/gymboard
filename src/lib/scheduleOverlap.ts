/**
 * 予定表で「予約が時間ブロックと重なっているか」を出す。
 *
 * ## なぜ要るか（2026-09-14）
 *
 * 体験予約だけ時間ブロックを無視して受けられる設定を足した
 * （`tenants.trial_ignores_blocked_slots`。`mem/features/trial-ignores-blocks.md`）。
 * ON にすると、**ブロックした時間に体験が入る**。
 *
 * ところが週タイムラインのカードは全部 `absolute left-0.5 right-0.5` で、
 * 重なりを想定していない。同じ時間に2枚あると**後から描いた1枚が前の1枚を丸ごと覆う**。
 * ブロックが体験を隠すと、店は「入っていること自体」に気づけない。
 *
 * そこで
 *   1. ブロックは必ず背面へ（`z-index` を下げる）
 *   2. ブロックと重なった予約には印を出す
 * の2つを当てる。ここはその判定だけを持つ（画面側は見た目に集中する）。
 *
 * 🔴 判定は**表示している配列の中だけ**で完結させる。DB に「ブロックを無視して入った」
 *    という印を持たせていないので、時間帯を突き合わせて出すのが唯一の手段。
 *    設定を後から OFF に戻しても、既に入っている予約には印が出続ける（それでよい。
 *    「いまブロックと重なっている」は事実として変わらないため）。
 */

/** 重なり判定に要る最小限の形。呼ぶ側の型をそのまま渡せるように緩くしてある。 */
export interface OverlapItem {
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
  /** 時間ブロックか */
  isBlocked?: boolean;
}

/** "HH:MM" を分に。読めなければ null（NaN を作らない）。 */
const toMinutes = (hhmm: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
};

/**
 * `items` のうち時間ブロックであるものと重なっている「予約」の集合を返す。
 *
 * - ブロック同士の重なりは見ない（店が並べて置くのは普通のこと）
 * - 端が接するだけ（10:00-11:00 と 11:00-12:00）は**重なりとしない**
 * - 時刻が読めない行は、判定から静かに落とす（印が出ないだけ。安全側）
 *
 * 返すのは配列のインデックスの集合。呼ぶ側が `has(i)` で引ける。
 */
export const indexesOverlappingBlocks = (items: readonly OverlapItem[]): Set<number> => {
  const hit = new Set<number>();
  const blocks: { start: number; end: number }[] = [];
  for (const b of items) {
    if (!b.isBlocked) continue;
    const start = toMinutes(b.startTime);
    const end = toMinutes(b.endTime);
    if (start === null || end === null || end <= start) continue;
    blocks.push({ start, end });
  }
  if (blocks.length === 0) return hit;

  items.forEach((b, i) => {
    if (b.isBlocked) return;
    const start = toMinutes(b.startTime);
    const end = toMinutes(b.endTime);
    if (start === null || end === null || end <= start) return;
    if (blocks.some((k) => start < k.end && k.start < end)) hit.add(i);
  });
  return hit;
};
