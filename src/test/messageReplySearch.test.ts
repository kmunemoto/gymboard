import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  formatReplyQuote,
  prependReply,
  replyExcerpt,
  splitReplyQuote,
  MAX_REPLY_EXCERPT,
} from "@/lib/messageReply";
import i18n from "@/lib/i18n";
import {
  searchMessages,
  stepHit,
  highlightParts,
  normalizeQuery,
} from "@/lib/messageSearch";

// 引用返信（B1）と会話内検索（B2）。
//
// どちらも DB を増やしていない。引用は**文字列**、検索は**読み込み済みの範囲**。

const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
const readCode = (p: string) => stripJs(readFileSync(p, "utf8"));

// ⚠️ 画面の文言をリテラルで書かない。兄弟アプリがオーバーレイすると落ちる
//    （forkHostileTests.test.ts が見張っている）。i18n から引く。
const LABELS = {
  image: i18n.t("trainerMessages.previewImage"),
  video: i18n.t("trainerMessages.previewVideo"),
};

describe("引用返信（B1）", () => {
  it("引用は「> 名前: 抜粋」の形", () => {
    expect(
      formatReplyQuote(
        { content: "明日19時に変更できますか", attachment_type: null, senderName: "田中" },
        LABELS,
      ),
    ).toBe("> 田中: 明日19時に変更できますか");
  });

  it("名前が無ければ省略する（「> : 本文」にしない）", () => {
    expect(
      formatReplyQuote({ content: "了解です", attachment_type: null, senderName: null }, LABELS),
    ).toBe("> 了解です");
    expect(
      formatReplyQuote({ content: "了解です", attachment_type: null, senderName: "  " }, LABELS),
    ).toBe("> 了解です");
  });

  it("🔴 添付だけのメッセージは種別を出す（「> 」だけにしない）", () => {
    // 空にすると、何を引用したのか読む側に分からない。
    expect(replyExcerpt({ content: "", attachment_type: "image" }, LABELS)).toBe(LABELS.image);
    expect(replyExcerpt({ content: "   ", attachment_type: "video" }, LABELS)).toBe(LABELS.video);
    // 空文字に落ちていないこと（「> 」だけの行にしない）
    expect(LABELS.image.length).toBeGreaterThan(0);
  });

  it("長い本文は切り詰める（吹き出しが引用で埋まらない）", () => {
    const long = "あ".repeat(100);
    const ex = replyExcerpt({ content: long, attachment_type: null }, LABELS);
    expect(ex.length).toBe(MAX_REPLY_EXCERPT + 1); // 末尾の「…」
    expect(ex.endsWith("…")).toBe(true);
  });

  it("改行を1行にまとめる（引用が縦に伸びない）", () => {
    expect(replyExcerpt({ content: "あ\n\nい　う", attachment_type: null }, LABELS)).toBe("あ い う");
  });

  it("🔴 書きかけを消さない／二重に入らない", () => {
    expect(prependReply("書きかけ", "> 元の文")).toBe("> 元の文\n書きかけ");
    expect(prependReply("", "> 元の文")).toBe("> 元の文\n");
    // 連打しても増えない
    expect(prependReply("> 元の文\n書きかけ", "> 元の文")).toBe("> 元の文\n書きかけ");
  });

  it("🔴 表示時に引用と本文を分ける（引用が自分の発言に見えない）", () => {
    const { quote, body } = splitReplyQuote("> 田中: 明日19時に\n大丈夫です");
    expect(quote).toBe("田中: 明日19時に");
    expect(body).toBe("大丈夫です");
  });

  it("引用が無い本文はそのまま", () => {
    expect(splitReplyQuote("ふつうの文")).toEqual({ quote: null, body: "ふつうの文" });
  });

  it("🔴 本文の途中の > は引用にしない", () => {
    // 「A > B」のような書き方を勝手に引用扱いすると、本文が欠ける。
    const { quote, body } = splitReplyQuote("重さは A > B です");
    expect(quote).toBeNull();
    expect(body).toBe("重さは A > B です");
  });

  it("🔴 添付の文言をライブラリ側にリテラルで持たない", () => {
    // 兄弟アプリが業種に合わせて差し替えるので、ここに焼き込むとフォークで直せない。
    const src = readCode("src/lib/messageReply.ts");
    expect(src, "添付の文言がリテラルで書かれています").not.toMatch(/\[写真\]|\[動画\]/);
    expect(src, "ラベルを引数で受け取っていません").toMatch(/labels\.image/);
  });

  it("🔴 引用に booking_id のような参照を持たせていない", () => {
    // 参照にすると、元を送信取り消し（B3）したときに
    // **取り消したはずの本文が引用の中に生き残る**。
    const src = readCode("src/lib/messageReply.ts");
    expect(
      /reply_to_id|replyToId/.test(src),
      "引用を参照で持っています。取り消しと噛み合いません（messageReply.ts の冒頭）。",
    ).toBe(false);
  });
});

describe("会話内の検索（B2）", () => {
  const msgs = [
    { id: "1", content: "明日の予約について" },
    { id: "2", content: "はい、大丈夫です" },
    { id: "3", content: "予約を変更しました" },
    { id: "4", content: "" }, // 添付だけ
  ];

  it("並び順のままヒットを返す", () => {
    expect(searchMessages(msgs, "予約")).toEqual(["1", "3"]);
  });

  it("空の検索語では何も返さない（全件ヒットにしない）", () => {
    expect(searchMessages(msgs, "")).toEqual([]);
    expect(searchMessages(msgs, "　 ")).toEqual([]);
  });

  it("全角空白と大文字小文字で取りこぼさない", () => {
    expect(normalizeQuery("　ABC　")).toBe("abc");
    expect(searchMessages([{ id: "a", content: "Hello World" }], "hello")).toEqual(["a"]);
  });

  it("本文が空のメッセージはヒットしない", () => {
    expect(searchMessages(msgs, "予約")).not.toContain("4");
  });

  it("🔴 前/次は端で巻き戻す", () => {
    expect(stepHit(0, 3, "next")).toBe(1);
    expect(stepHit(2, 3, "next")).toBe(0);
    expect(stepHit(0, 3, "prev")).toBe(2);
    // 0件のときに負や NaN を返さない
    expect(stepHit(0, 0, "next")).toBe(0);
    expect(stepHit(5, 0, "prev")).toBe(0);
  });

  it("強調は一致部分だけ、元の表記のまま", () => {
    const parts = highlightParts("Hello World hello", "hello");
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["Hello", "hello"]);
    // 小文字化した文字列を表示に出さない
    expect(parts.map((p) => p.text).join("")).toBe("Hello World hello");
  });

  it("検索語が無ければ全体が非ヒットの1つ", () => {
    expect(highlightParts("あいう", "")).toEqual([{ text: "あいう", hit: false }]);
  });

  it("🔴 強調も HTML を組み立てない", () => {
    const src = readCode("src/components/messages/MessageText.tsx");
    expect(src, "強調で HTML を描画しています").not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("🔴 検索中は最下部へ自動スクロールしない", () => {
    // ヒットへジャンプした直後に最下部へ戻されると、探しているものが
    // 一瞬で画面から消える（検索が使い物にならない）。
    for (const f of [
      "src/components/trainer/TrainerMessages.tsx",
      "src/components/customer/CustomerChat.tsx",
    ]) {
      const src = readCode(f);
      const idx = src.indexOf("bottomRef.current?.scrollIntoView");
      expect(idx, `${f} に自動スクロールがありません`).toBeGreaterThan(-1);
      // 直前に検索中の早期 return があること
      expect(
        src.slice(Math.max(0, idx - 200), idx),
        `${f} が検索中でも最下部へ飛びます`,
      ).toMatch(/search\.active\)\s*return/);
    }
  });

  it("0件のときに黙らない", () => {
    const src = readCode("src/components/messages/ConversationSearch.tsx");
    expect(src, "0件の表示がありません").toMatch(/searchNoHit/);
  });
});

describe("両方の画面に入っている", () => {
  it("返信メニューと検索バーがジム側・お客様側の両方にある", () => {
    for (const f of [
      "src/components/trainer/TrainerMessages.tsx",
      "src/components/customer/CustomerChat.tsx",
    ]) {
      const src = readCode(f);
      expect(src, `${f} に返信メニューがありません`).toMatch(/<MessageActions/);
      expect(src, `${f} に引用の表示がありません`).toMatch(/<ReplyQuote/);
      expect(src, `${f} に検索バーがありません`).toMatch(/<ConversationSearch/);
    }
  });

  it("🔴 長押しはスクロールで誤爆しない", () => {
    // ここが無いと、会話を遡るたびにメニューが出て使い物にならない。
    const src = readCode("src/components/messages/MessageActions.tsx");
    // ⚠️ `onPointerMove` だけを探すと `onPointerMoveDISABLED` にも当たって素通りする
    //    （変異検証で実際に見逃した）。属性として渡っているところまで見る。
    expect(src, "指の移動で長押しを取り消していません").toMatch(/onPointerMove=\{/);
    // しきい値を超えたら cancel() まで到達していること
    const idx = src.search(/onPointerMove=\{/);
    expect(
      src.slice(idx, idx + 200),
      "移動しても長押しを取り消していません",
    ).toMatch(/Math\.abs\([\s\S]{0,80}>\s*\d+\)[\s\S]{0,40}cancel\(\)/);
  });
});
