import { describe, it, expect } from "vitest";
import { BRAND, STORE_LISTING } from "@/lib/brand";

// ストア（App Store / Google Play）の掲載名・説明の検査。
//
// ── なぜ要るか ──────────────────────────────────────────────────
// この値は**コードから使われない**（人がコンソールに入力する）。
// つまり壊れていても、tsc もテストもビルドも何も言わない。
// **文字数超過はストアに弾かれてから分かる** — 審査に出す当日に判明する。
//
// 掲載名はこれまでリポジトリのどこにも記録されておらず、コンソールを開かないと
// 現在値が分からなかった。兄弟アプリが「上流はどう書いているか」を参照する先も
// 無かった。`brand.ts` の STORE_LISTING を唯一の記録にして、ここで見張る。
//
// ── 上限（2026-08 時点。日本語も1文字＝1）──────────────────────
//   App Store   : 名前 30 / サブタイトル 30
//   Google Play : 名前 30 / 簡単な説明 80
//
// 名前は両ストア共通で30なので、短いほうに合わせて1つで見る。
//
// ⚠️ **絵文字や合字を入れないこと。** ストア側の数え方（UTF-16 コードユニット等）と
//    ズレて、手元で通ってもストアで弾かれる。ASCII と通常の日本語だけにする。
//
// ── 変異テスト（2026-08-06 実施・4件とも赤になることを確認済み）────
//   1. name を31文字にする                    → 赤
//   2. subtitle を31文字にする                → 赤
//   3. shortDescription を81文字にする        → 赤
//   4. name の先頭から製品名を消す             → 赤

const LIMITS = {
  /** App Store / Google Play どちらも30 */
  name: 30,
  /** App Store のサブタイトル */
  subtitle: 30,
  /** Google Play の「簡単な説明」 */
  shortDescription: 80,
} as const;

/** ストアが数えるのはコードポイント。サロゲートペアを1文字として数える */
const length = (s: string) => [...s].length;

describe("ストア掲載情報（STORE_LISTING）", () => {
  for (const [key, limit] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][]) {
    it(`${key} が ${limit} 文字以内`, () => {
      const value = STORE_LISTING[key];
      expect(
        length(value),
        `${key} が ${length(value)} 文字で上限 ${limit} を超えています。` +
          `ストアに弾かれます（審査提出の当日に分かる種類の失敗です）: ${value}`,
      ).toBeLessThanOrEqual(limit);
    });

    it(`${key} が空でない`, () => {
      // 空文字でも上限は通ってしまう。フォークが消したまま出荷するのを防ぐ
      expect(STORE_LISTING[key].trim().length).toBeGreaterThan(0);
    });
  }

  it("name が製品名で始まる", () => {
    // 検索結果では後ろが省略される。製品名が後ろにあると、
    // 省略されたときに何のアプリか分からなくなる。
    expect(
      STORE_LISTING.name.startsWith(BRAND.ja) || STORE_LISTING.name.startsWith(BRAND.en),
      `STORE_LISTING.name は製品名（${BRAND.ja} / ${BRAND.en}）で始めてください。` +
        `検索結果では後ろが省略されるため、製品名が後ろにあると何のアプリか分かりません: ` +
        STORE_LISTING.name,
    ).toBe(true);
  });

  it("name に製品名だけでなく説明が付いている", () => {
    // 「どんなアプリか分かるようにする」のが目的なので、製品名だけの状態を弾く
    const rest = STORE_LISTING.name.replace(BRAND.ja, "").replace(BRAND.en, "").trim();
    expect(
      length(rest),
      `STORE_LISTING.name が製品名だけです。何のアプリか分かる説明を足してください`,
    ).toBeGreaterThan(3);
  });

  it("絵文字・記号の装飾が入っていない", () => {
    // ストアの数え方とズレる。また審査で指摘されることがある
    const decorated = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const [key, value] of Object.entries(STORE_LISTING)) {
      expect(decorated.test(value), `${key} に絵文字が入っています: ${value}`).toBe(false);
    }
  });
});
