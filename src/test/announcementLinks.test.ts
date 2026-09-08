import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { linkify, isSafeHttpUrl } from "@/lib/linkify";
import { STORE_URLS } from "@/lib/brand";

// ────────────────────────────────────────────────────────────────
// お知らせ本文の URL を押せるようにする（2026-09-08 宗本さんの要望）
//
// > これアプリに飛ぶ url 貼ろうよ
//
// アプリの更新をお願いするお知らせに、App Store / Play ストアのURLを載せたい。
// ところが本文は素のテキストとして描画されていて（AnnouncementsDialog.tsx:82）、
// **貼っても押せなかった**。押せないと、お客様は手で選択してコピーすることになる。
//
// チャットには同じ問題を 2026-08-12 に解いた MessageText / linkify があるので、
// それをお知らせにも通す。
//
// 🔴 HTML としては描画しない。本文は店側が自由に入力する文字列なので、
//    dangerouslySetInnerHTML を使うとそこがスクリプト実行の入り口になる。
// ────────────────────────────────────────────────────────────────

const readCode = (path: string) => readFileSync(path, "utf8");

const DIALOG = "src/components/customer/AnnouncementsDialog.tsx";
const MESSAGE_TEXT = "src/components/messages/MessageText.tsx";

describe("🔴 お知らせ本文の URL が押せること", () => {
  const code = readCode(DIALOG);

  it("本文を MessageText で描いている（素のテキストのままにしない）", () => {
    expect(code).toContain('import MessageText from "@/components/messages/MessageText";');
    expect(code).toMatch(/<MessageText text=\{selected\.body\} \/>/);
  });

  it("素の {selected.body} 直書きに戻っていない", () => {
    // 戻すと、貼ったURLが押せない状態に静かに逆戻りする
    expect(code).not.toMatch(/^\s*\{selected\.body\}\s*$/m);
  });

  it("🔴 HTML としては描画していない", () => {
    // ⚠️ コメントを除いてから見る。MessageText.tsx の JSDoc には
    //    「dangerouslySetInnerHTML を使うと危ない」という**説明**が書いてあり、
    //    素で toContain するとその説明に引っかかって、実コードを何も見ないまま赤くなる。
    //    （min_version の番人で踏んだのと同じ型の間違い）
    for (const path of [DIALOG, MESSAGE_TEXT]) {
      const body = readCode(path).replace(/^\s*(\*|\/\/|\/\*).*$/gm, "");
      expect(body, path).not.toContain("dangerouslySetInnerHTML");
    }
  });
});

describe("ストアのURLがそのままリンクになること", () => {
  for (const [platform, url] of Object.entries(STORE_URLS)) {
    it(`${platform} のURLが1つのリンクとして拾える`, () => {
      const segs = linkify(`更新はこちら ${url} からお願いします。`);
      const links = segs.filter((s) => s.type === "link");
      expect(links).toHaveLength(1);
      expect(links[0].type === "link" && links[0].href).toBe(url);
    });
  }

  it("🔴 文末の「。」をURLに巻き込まない", () => {
    // 巻き込むとリンクが 404 になる。日本語の文中に貼るので実際に起きる
    const segs = linkify(`更新は ${STORE_URLS.ios}。`);
    const link = segs.find((s) => s.type === "link");
    expect(link?.type === "link" && link.href).toBe(STORE_URLS.ios);
  });

  it("🔴 クエリ付きの Play の URL が途中で切れない", () => {
    // ?id=... を落とすと、ストアのトップに飛んでアプリが見つからない
    const segs = linkify(`Android の方は ${STORE_URLS.android} です`);
    const link = segs.find((s) => s.type === "link");
    expect(link?.type === "link" && link.href).toContain("?id=");
  });

  it("http / https 以外はリンクにしない", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeHttpUrl(STORE_URLS.ios)).toBe(true);
    expect(isSafeHttpUrl(STORE_URLS.android)).toBe(true);
  });
});

describe("⚠️ 一覧のプレビューはリンクにしない", () => {
  it("店側の一覧は素のテキストのまま", () => {
    // 2行に切り詰めた抜粋なので、押せるとリンクが途中で切れて誤解を生む
    const manager = readCode("src/components/trainer/TrainerAnnouncementManager.tsx");
    expect(manager).toMatch(/line-clamp-2[^>]*>\{a\.body\}</);
    expect(manager).not.toContain("MessageText");
  });
});
