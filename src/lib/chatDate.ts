import { ja } from "date-fns/locale";
import { formatJST } from "@/lib/timezone";

/**
 * チャットの日付区切り。
 *
 * ## なぜ要るか（2026-08-12）
 *
 * ジム側のチャットは**全部の吹き出しに「8/12 14:30」**が入っていた。
 * 日付が毎行に出るぶん時刻が読みにくく、逆に「どこで日が変わったか」は分からない。
 * LINE と同じく、**日付は会話の途中に1回だけ**出し、吹き出しには時刻だけ置く。
 *
 * お客様側には区切り自体はあったが「8/12」固定で、
 * **今日のメッセージにも「8/12」と出ていた**。「今日」「昨日」を出す。
 *
 * ## 日付は必ず JST で切る
 *
 * 端末のタイムゾーンで切ると、台湾のお客様の画面だけ**区切りの位置がずれる**
 * （深夜のやり取りが前日側に入る）。`timezone.ts` の方針どおり JST 固定。
 */

/** 同じ日かどうかの判定キー。JST の暦日。 */
export const dayKeyJST = (input: string | Date): string => formatJST(input, "yyyy-MM-dd");

export type DateSeparator =
  | { kind: "today" }
  | { kind: "yesterday" }
  /** 「8/10(月)」。曜日まで出す（「先週の月曜の話」を探せるようにする） */
  | { kind: "date"; text: string };

/**
 * 区切りに出すラベル。i18n を持ち込まないよう**種別と文字列だけ**返し、
 * 「今日」「昨日」の訳は呼び出し元が当てる。
 *
 * @param now テスト用。既定は現在時刻。
 */
export function dateSeparator(input: string | Date, now: Date = new Date()): DateSeparator {
  const key = dayKeyJST(input);
  if (key === dayKeyJST(now)) return { kind: "today" };

  // 「昨日」は JST の暦日で1日前。24時間前ではない
  // （夜11時に前日の朝を見たときに「昨日」と出したい）。
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (key === dayKeyJST(yesterday)) return { kind: "yesterday" };

  return { kind: "date", text: formatJST(input, "M/d(E)", { locale: ja }) };
}

/**
 * 隣り合うメッセージの間に区切りを出すか。
 *
 * @param prev ひとつ前のメッセージの created_at。先頭なら null
 */
export function needsDateSeparator(current: string, prev: string | null): boolean {
  if (prev === null) return true;
  return dayKeyJST(current) !== dayKeyJST(prev);
}
