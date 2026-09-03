/**
 * チャットのスタンプ（LINE風）。
 *
 * 実店舗の要望（2026-09-03 宗本さん）:「チャットにLINEのスタンプ機能を真似して追加したい」。
 * 絵はジムボード公式のキャラクター（ダンベル）で、**全ジム共通**。
 *
 * ## 🔴 絵はアプリに同梱する。DB にもストレージにも置かない
 *
 * DB が持つのは `messages.sticker_id` という**文字列1つだけ**。理由:
 *
 * - 全ジム共通なので、テナント別の表もストレージも要らない
 * - 同じ絵を送るたびにアップロードしない
 * - 電波が悪くてもすぐ出る（取りに行かない）
 *
 * 代償は「**スタンプを増やすにはアプリの更新が要る**」こと。ジムごとに違うスタンプを
 * 持たせたくなったら、そのときは `gym_videos` と同じくテナント別の表を足す。
 *
 * ## 🔴 `text` は飾りではない。これが本文として送られる
 *
 * スタンプを送ると `messages.content` にこの文字が入る。空にしない理由:
 *
 * 1. **古いアプリでも意味が通る。** `sticker_id` を知らない版は本文をそのまま表示する
 *    （絵は出ないが「ありがとうございます」とは読める）。2026-09-03 に「古いアプリが
 *    新しい規則を知らずに詰む」を実際に踏んだので、最初から素直に落ちる形にしておく
 * 2. 新規メッセージの通知（`notify-new-message`）が**そのまま動く**。空文字にすると
 *    プッシュもメールも本文が空で届く
 * 3. 会話内検索に引っかかる
 *
 * ⚠️ したがって `text` は**絵に描いてある文字と同じ**にすること。ずれると、古いアプリと
 * 新しいアプリで違うことを言っているように見える。
 *
 * ## 増やすとき
 *
 * 1. `src/assets/stickers/<id>.png` を置く（透過PNG・512×512・余白8%・影なし）
 * 2. 下の `STICKERS` に1行足す
 * 3. それだけ。マイグレーションは要らない（DB は id の**形**しか見ていない）
 */

import yoroshiku from "@/assets/stickers/yoroshiku.png";
import arigatou from "@/assets/stickers/arigatou.png";
import ryokai from "@/assets/stickers/ryokai.png";
import ganbarimasu from "@/assets/stickers/ganbarimasu.png";
import otsukaresama from "@/assets/stickers/otsukaresama.png";
import nice from "@/assets/stickers/nice.png";
import okuremasu from "@/assets/stickers/okuremasu.png";
import gomennasai from "@/assets/stickers/gomennasai.png";

export interface Sticker {
  /** `messages.sticker_id` に入る値。DB の CHECK は `^[a-z0-9_]{1,40}$`。 */
  id: string;
  /** 画像の URL（ビルド時にハッシュ付きのパスへ解決される）。 */
  src: string;
  /** 🔴 絵に描いてある文字。**そのまま `content` として送られる。** */
  text: string;
}

export const STICKERS: readonly Sticker[] = [
  { id: "yoroshiku", src: yoroshiku, text: "よろしくお願いします" },
  { id: "arigatou", src: arigatou, text: "ありがとうございます" },
  { id: "ryokai", src: ryokai, text: "了解です！" },
  { id: "ganbarimasu", src: ganbarimasu, text: "がんばります！" },
  { id: "otsukaresama", src: otsukaresama, text: "おつかれさま！" },
  { id: "nice", src: nice, text: "ナイス！" },
  { id: "okuremasu", src: okuremasu, text: "ちょっと遅れます" },
  { id: "gomennasai", src: gomennasai, text: "ごめんなさい" },
] as const;

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

/**
 * id からスタンプを引く。**知らない id なら null。**
 *
 * 🔴 null のときは絵を出さず、本文（＝スタンプの文字）をそのまま吹き出しで見せること。
 * 新しいスタンプを持つ端末から、まだ更新していない端末へ送られたときにここへ来る。
 * 落とさずに文字で伝わるのが、この設計の狙いそのもの。
 */
export const findSticker = (id: string | null | undefined): Sticker | null =>
  (id ? BY_ID.get(id) : undefined) ?? null;
