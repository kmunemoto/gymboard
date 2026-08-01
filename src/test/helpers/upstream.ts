import { describe } from "vitest";
import { BRAND } from "@/lib/brand";

// 上流（ジムボード本体）だけで成り立つ断言を、フォークで落とさないための仕組み。
//
// ## なぜ要るか
//
// 業種特化の兄弟アプリは GymBoard のフォークとして作られ、`git merge upstream/main` で
// 上流に追従し続ける（mem/ops/vertical-fork.md）。フォークが変えるのは原則「値」だけ:
// `brand.ts` / `featureFlags.ts` / `vertical.ja.json` / テナントUUID など。
//
// ところが上流のテストが**その値そのもの**を断言していると、フォークで CI が恒常的に
// 赤くなる。するとフォークは上流のテストを編集せざるを得ず、
// **鉄則3「フォークが編集するファイルを増やさない」に反して毎回の merge 衝突源になる**。
//
// ## 使い分け
//
// - **どのフォークでも真であるべき断言** … 普通に書く。
//   文言は `i18n.t("nav.training")` のようにキーから引き、ブランド値は `brand.ts` から引く。
//   フラグに依存する挙動は `vi.doMock` で明示的に固定してから断言する。
// - **上流の設定値そのものを固定したい断言** … `upstreamOnly` で囲む。
//   例: 「ジムボードは全フラグが既定ON」「vertical.ja.json は空」「プランの人数上限は
//   free=5 / light=20 / standard=30」。これらは**上流にとっては意味のある回帰テスト**
//   なので弱めたくないが、フォークにとっては偽。
//
// 迷ったら「フォークでこの値を変えるか？」で判断する。変えるなら `upstreamOnly`。

// `BRAND.app` は `as const` なのでリテラル型を持つ。そのまま比較すると、フォーク側
// （`BRAND.app = "sekkotsuboard"` 等）で「型に重なりが無い」という tsc エラーになり、
// **上流のテストを直す作業がフォークに発生してしまう**。string に widen して防ぐ。
const brandApp: string = BRAND.app;

/** このリポジトリが上流（ジムボード本体）か。フォークは brand.ts を書き換えるので false */
export const isUpstream = brandApp === "gymboard";

/**
 * 上流だけで成り立つ断言をまとめる describe。フォークでは丸ごと skip される。
 *
 * ```ts
 * upstreamOnly("ジムボード本体の既定値", () => {
 *   it("全フラグが既定ON", async () => { ... });
 * });
 * ```
 */
export const upstreamOnly = isUpstream ? describe : describe.skip;
