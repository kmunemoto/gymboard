/**
 * 業種語彙のオーバーレイ（兄弟アプリ用）。
 *
 * GymBoard は「パーソナルジム」向けなので、UIの文言に
 * ジム / トレーナー / トレーニング / 来店 … といった業種固有の語が入っている。
 * 業種特化の兄弟アプリ（ストレッチボード・セッコツボード・ピラボード…）では、
 * これを サロン / セラピスト / 施術 / ご来院 … に読み替えたい。
 *
 * ## なぜ ja.json を直接書き換えないのか
 *
 * 兄弟アプリは GymBoard のフォークとして作られ、`git merge upstream/main` で
 * 上流の修正を取り込み続ける（mem/ops/vertical-fork.md）。
 * `src/locales/ja.json` は約1,900キーあり、ここを書き換えると
 * **上流が文言を1つ足すたびに衝突する**。しかも衝突を解決するたびに、
 * 上流の新しい文言を取りこぼす危険がある。
 *
 * そこで **base の ja.json は上流とバイト一致のまま保ち**、
 * 変えたいキーだけをこのオーバーレイに書く。
 * フォークが触るのは `vertical.ja.json` の1ファイルだけになり、
 * 上流が文言を足しても素通りで流入する。
 *
 * ## 書き方
 *
 * `vertical.ja.json` に、上書きしたいキーだけを **同じ入れ子構造で** 書く。
 * 深いマージなので、書かなかったキーは base のまま残る。
 *
 * ```json
 * {
 *   "nav": { "training": "施術記録" },
 *   "booking": { "title": "施術のご予約" }
 * }
 * ```
 *
 * GymBoard 本体では空（`{}`）＝何も上書きしないので、挙動は一切変わらない。
 *
 * ## 多言語について
 *
 * 兄弟アプリは当面「日本語のみ」の方針（mem/ops/vertical-fork.md）のため、
 * いまは ja のオーバーレイだけを用意している。
 * 他言語も業種語彙を差し替えたくなったら `vertical.<lng>.json` を足して
 * 下のマップに登録すれば、同じ仕組みでそのまま効く。
 * 登録しない言語は base の文言（＝ジム向けの語彙）がそのまま出る。
 */
import type { SupportedLanguage } from "@/lib/i18n";
import verticalJa from "./vertical.ja.json";

export const VERTICAL_OVERLAYS: Partial<Record<SupportedLanguage, Record<string, unknown>>> = {
  ja: verticalJa as Record<string, unknown>,
};

/** その言語に業種オーバーレイがあるか（空オブジェクトは「無い」扱い） */
export function hasVerticalOverlay(lng: string): boolean {
  const overlay = VERTICAL_OVERLAYS[lng as SupportedLanguage];
  return !!overlay && Object.keys(overlay).length > 0;
}
