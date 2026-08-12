import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sortConversations } from "@/lib/conversationOrder";
import { dateSeparator, dayKeyJST, needsDateSeparator } from "@/lib/chatDate";
import { linkify, isSafeHttpUrl } from "@/lib/linkify";

// LINE 相当の使い勝手（並び・日付区切り・リンク・画像の全画面）を見張る。
//
// ── なぜ要るか（2026-08-12）─────────────────────────────────────────
// どれも「壊れてもエラーが出ない」たぐいの機能で、気づけるのはお客様が
// 使いにくいと感じたときだけ。振る舞いを固定しておく。

/**
 * JS/TS のコメントを落とす。
 *
 * ⚠️ これを忘れると、**経緯コメントが検査を騙す**。実際にこのファイルを書いた時、
 *    「dangerouslySetInnerHTML を使わない」と書いた説明文そのものに反応して
 *    「HTML として描画している」と誤判定した。禁止語を検査するときは必ず通すこと。
 */
const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const readCode = (path: string): string => stripJs(readFileSync(path, "utf8"));

describe("会話一覧の並び（A1）", () => {
  const people = [
    { user_id: "a", display_name: "あさひ" },
    { user_id: "b", display_name: "いのうえ" },
    { user_id: "c", display_name: "うえだ" },
  ];

  it("🔴 最後にやり取りした順に並ぶ", () => {
    const sorted = sortConversations(people, {
      a: { content: "x", time: "", at: "2026-08-10T00:00:00Z" },
      b: { content: "y", time: "", at: "2026-08-12T00:00:00Z" },
      c: { content: "z", time: "", at: "2026-08-11T00:00:00Z" },
    });
    expect(sorted.map((p) => p.user_id)).toEqual(["b", "c", "a"]);
  });

  it("🔴 未読の有無で順番を変えない（既読にした瞬間に会話が飛ばない）", () => {
    // 以前は「未読がある人が上」だった。返信しようとして開く＝既読にする、なので
    // **読んだ瞬間にその会話が一覧の下へ移動**していた。
    const order = (last: Parameters<typeof sortConversations>[1]) =>
      sortConversations(people, last).map((p) => p.user_id);
    const last = {
      a: { content: "x", time: "", at: "2026-08-12T09:00:00Z" },
      b: { content: "y", time: "", at: "2026-08-12T08:00:00Z" },
      c: { content: "z", time: "", at: "2026-08-12T07:00:00Z" },
    };
    // 未読情報は sortConversations に渡していない＝並びに影響しないことの担保
    expect(order(last)).toEqual(["a", "b", "c"]);
    expect(sortConversations.length).toBe(2);
  });

  it("やり取りの無い相手は下に、名前順で残る", () => {
    // 一覧から消してはいけない。こちらから声をかける相手がいなくなる。
    const sorted = sortConversations(people, {
      c: { content: "z", time: "", at: "2026-08-11T00:00:00Z" },
    });
    expect(sorted.map((p) => p.user_id)).toEqual(["c", "a", "b"]);
  });

  it("名前未設定は末尾へ（空欄が先頭に固まらない）", () => {
    const sorted = sortConversations(
      [
        { user_id: "x", display_name: null },
        { user_id: "y", display_name: "たなか" },
      ],
      {},
    );
    expect(sorted.map((p) => p.user_id)).toEqual(["y", "x"]);
  });

  it("元の配列を壊さない", () => {
    const original = [...people];
    sortConversations(people, { a: { content: "", time: "", at: "2026-08-12T00:00:00Z" } });
    expect(people).toEqual(original);
  });
});

describe("日付の区切り（A2）", () => {
  const now = new Date("2026-08-12T05:00:00Z"); // JST 8/12 14:00

  it("🔴 今日・昨日を出す", () => {
    expect(dateSeparator("2026-08-12T04:00:00Z", now)).toEqual({ kind: "today" });
    expect(dateSeparator("2026-08-11T04:00:00Z", now)).toEqual({ kind: "yesterday" });
  });

  it("それ以前は曜日つきの日付", () => {
    // 2026-08-10 は月曜
    const sep = dateSeparator("2026-08-10T04:00:00Z", now);
    expect(sep.kind).toBe("date");
    expect(sep.kind === "date" && sep.text).toBe("8/10(月)");
  });

  it("🔴 区切りは JST で切る（端末のタイムゾーンで動かない）", () => {
    // UTC 2026-08-11T16:00 は JST では 8/12 01:00。**今日**でなければならない。
    // ここが端末ローカルだと、海外にいるお客様の画面で区切りの位置がずれる。
    expect(dayKeyJST("2026-08-11T16:00:00Z")).toBe("2026-08-12");
    expect(dateSeparator("2026-08-11T16:00:00Z", now)).toEqual({ kind: "today" });
  });

  it("同じ日の連続では区切りを出さない／日付が変わったら出す", () => {
    expect(needsDateSeparator("2026-08-12T04:00:00Z", null)).toBe(true);
    expect(needsDateSeparator("2026-08-12T04:00:00Z", "2026-08-12T01:00:00Z")).toBe(false);
    // ⚠️ 判定は JST の暦日。UTC の 8/11T23:00 は JST では 8/12 08:00 なので**同じ日**。
    //    区切りが出るのは JST で日をまたいだときだけ（8/11T10:00Z = JST 8/11 19:00）。
    expect(needsDateSeparator("2026-08-12T04:00:00Z", "2026-08-11T23:00:00Z")).toBe(false);
    expect(needsDateSeparator("2026-08-12T04:00:00Z", "2026-08-11T10:00:00Z")).toBe(true);
  });

  it("🔴 吹き出しから日付を落とし、時刻だけにした", () => {
    // 区切りが日付を持つので、全行に「8/12 14:30」と入れる必要がなくなった。
    // 両方に出ていると、区切りを入れた意味（時刻が読みやすくなる）が消える。
    const trainer = readCode("src/components/trainer/TrainerMessages.tsx");
    const customer = readCode("src/components/customer/CustomerChat.tsx");
    expect(trainer, "吹き出しに日付が残っています").not.toMatch(/formatJST\([^)]*"M\/d HH:mm"\)/);
    for (const [name, src] of [["ジム側", trainer], ["お客様側", customer]] as const) {
      expect(src, `${name}に日付区切りがありません`).toMatch(/<DateSeparator\s/);
    }
  });
});

describe("URL のリンク化（A3）", () => {
  it("http/https をリンクにする", () => {
    const segs = linkify("動画はこちら https://example.com/a です");
    expect(segs).toEqual([
      { type: "text", value: "動画はこちら " },
      { type: "link", value: "https://example.com/a", href: "https://example.com/a" },
      { type: "text", value: " です" },
    ]);
  });

  it("🔴 javascript: / data: をリンクにしない", () => {
    // 本文はお客様が自由に入力できる。ここを緩めると、押させるだけで実行できる。
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"]) {
      expect(isSafeHttpUrl(bad), `${bad} を安全と判定しています`).toBe(false);
      expect(
        linkify(`見て ${bad}`).some((s) => s.type === "link"),
        `${bad} がリンクになっています`,
      ).toBe(false);
    }
  });

  it("🔴 リンクにしない文字列も本文から消えない", () => {
    // 弾いた結果その部分が欠けると、送った本人の意図した文が黙って変わる。
    const text = "見て javascript:alert(1) ここまで";
    expect(linkify(text).map((s) => s.value).join("")).toBe(text);
  });

  it("🔴 末尾の句読点を URL に含めない", () => {
    // 日本語の文中に貼られるので実際に起きる。含めると 404 になる。
    const segs = linkify("詳しくは https://example.com/a 。");
    const link = segs.find((s) => s.type === "link");
    expect(link && link.type === "link" && link.href).toBe("https://example.com/a");
    expect(segs.map((s) => s.value).join("")).toBe("詳しくは https://example.com/a 。");
  });

  it("URL が無ければ全体が1つのテキストとして返る", () => {
    expect(linkify("ふつうの文です")).toEqual([{ type: "text", value: "ふつうの文です" }]);
  });

  it("複数の URL をすべて拾う", () => {
    const links = linkify("a https://x.example/1 b http://y.example/2 c").filter(
      (s) => s.type === "link",
    );
    expect(links).toHaveLength(2);
  });

  it("🔴 本文を HTML として描画していない", () => {
    // ここを dangerouslySetInnerHTML に変えると、上のリンク検査を全部通したまま
    // 任意のスクリプトが動く状態になる。
    const src = readCode("src/components/messages/MessageText.tsx");
    expect(src, "本文を HTML として描画しています").not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe("画像の全画面表示（A4）", () => {
  const attachment = readCode("src/components/messages/MessageAttachment.tsx");
  const lightbox = readCode("src/components/messages/ImageLightbox.tsx");

  it("🔴 画像を外部タブで開かない", () => {
    // ネイティブでは Safari / Chrome が立ち上がってしまう。しかも署名URLには
    // 期限があるので、そのタブを後から開いても切れている。
    expect(
      /target="_blank"/.test(attachment),
      "添付を別タブで開いています。アプリ内のライトボックスで開いてください。",
    ).toBe(false);
    expect(attachment, "画像を押しても何も起きません").toMatch(/onOpenImage/);
  });

  it("閉じ方が複数ある（Android のバックで詰まらせない）", () => {
    expect(lightbox, "Escape で閉じられません").toMatch(/Escape/);
    expect(lightbox, "背景タップで閉じられません").toMatch(/onClick=\{onClose\}/);
  });

  it("両方の画面から開ける", () => {
    for (const f of [
      "src/components/trainer/TrainerMessages.tsx",
      "src/components/customer/CustomerChat.tsx",
    ]) {
      const src = readCode(f);
      expect(src, `${f} にライトボックスがありません`).toMatch(/<ImageLightbox\s/);
      expect(src, `${f} が onOpenImage を渡していません`).toMatch(/onOpenImage=/);
    }
  });
});

describe("会話プレビューは共有受信箱の範囲で引く", () => {
  it("🔴 自分の user_id だけで引いていない", () => {
    // 未読数は staff.ids で数えているのに、プレビューだけ自分の行しか見ていなかった。
    // 別のスタッフが担当している会話が「バッジは付くのに本文が空」になる。
    const src = readCode("src/components/trainer/TrainerMessages.tsx");
    const idx = src.indexOf("const fetchLastMessages");
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 1200);
    expect(
      /sender_id\.eq\.\$\{user\.id\},receiver_id\.eq\.\$\{user\.id\}/.test(body),
      "プレビューを自分の行だけで引いています（共有受信箱で他スタッフの会話が空になります）",
    ).toBe(false);
    expect(body, "スタッフ全員の範囲で引いていません").toMatch(/sender_id\.in\.|receiver_id\.in\./);
  });
});
