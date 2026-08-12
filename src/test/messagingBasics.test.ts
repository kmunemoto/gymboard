import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// メッセージ機能の土台を見張る。
//
// ── なぜ要るか（2026-08-11 の棚卸し）─────────────────────────────────
//
// 1対1チャットは動いていたが、**画面が事実と違うこと**を3つ言っていた:
//
//   ・「オンライン」… プレゼンスを一切見ておらず、**誰が見ても常に緑**だった。
//     深夜に送ったお客様に「オンラインなのに返事が来ない」と感じさせる
//   ・既読 … `read` は DB にあり Realtime も流れているのに、`useMessages` が
//     INSERT しか購読していなかったので、**送信者の画面には永久に届かなかった**
//   ・会話相手 … `user_roles` を全テナント横断・status 無視で引いていたので、
//     **退会したお客様が会話相手として並び続けていた**
//
// どれも「エラーが出ないまま間違ったことを表示する」型。テストでしか止められない。

const HOOK = readFileSync("src/hooks/useMessages.ts", "utf8");
const CUSTOMER_CHAT = readFileSync("src/components/customer/CustomerChat.tsx", "utf8");
const TRAINER_MESSAGES = readFileSync("src/components/trainer/TrainerMessages.tsx", "utf8");

/** JS/TSX のコメントを落とす。経緯コメントで検査を満たせないようにする。 */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

const HOOK_CODE = stripComments(HOOK);
const CUSTOMER_CODE = stripComments(CUSTOMER_CHAT);
const TRAINER_CODE = stripComments(TRAINER_MESSAGES);

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
const localeJson = (lng: string) =>
  JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")) as Record<string, any>;

describe("嘘の「オンライン」表示を復活させない", () => {
  it("コメント除去が空振りしていない（他の検査の前提）", () => {
    expect(CUSTOMER_CODE.length).toBeGreaterThan(500);
    expect(CUSTOMER_CODE).toContain("CustomerChat");
  });

  it("🔴 CustomerChat がプレゼンスなしの在席表示を出していない", () => {
    // 実プレゼンスを実装するなら話は別だが、その場合このキーではなく
    // 状態を持った別の仕組みになるはず。定数表示に戻すのを止めるのが目的。
    expect(
      /customerChat\.online/.test(CUSTOMER_CODE),
      "常時「オンライン」の表示が戻っています。プレゼンスを見ていない在席表示は嘘になります。",
    ).toBe(false);
  });

  it("🔴 online のロケールキーが全言語から消えている", () => {
    for (const lng of LOCALES) {
      const j = localeJson(lng);
      expect(
        j.customerChat && "online" in j.customerChat,
        `${lng}.json に customerChat.online が残っています`,
      ).toBe(false);
    }
  });
});

describe("既読は送信者の画面に届く", () => {
  it("🔴 useMessages が会話の UPDATE を購読している", () => {
    // ここが INSERT だけだと、`read` が DB で立っても送信者の画面は永久に変わらない。
    // 「既読を表示する」の前提条件。
    expect(HOOK_CODE, "会話の Realtime 購読に UPDATE がありません").toMatch(
      /event:\s*"UPDATE",\s*schema:\s*"public",\s*table:\s*"messages"/,
    );
    // 受け取った行を既存のメッセージにマージしていること（購読しているだけでは意味がない）
    const idx = HOOK_CODE.indexOf('event: "UPDATE"');
    expect(idx, "UPDATE の購読が見つかりません").toBeGreaterThan(-1);
    expect(
      HOOK_CODE.slice(idx, idx + 600),
      "UPDATE を受けても messages に反映していません",
    ).toMatch(/setMessages/);
  });

  it("🔴 両方の画面が、自分が送った分にだけ既読を出す", () => {
    for (const [label, code] of [
      ["CustomerChat", CUSTOMER_CODE],
      ["TrainerMessages", TRAINER_CODE],
    ] as const) {
      expect(code, `${label} が既読を表示していません`).toMatch(/common\.messageRead/);
      // 相手の吹き出しに出すのは誤り。自分の送信分に限定する条件が要る。
      //
      // ⚠️ `isMe && msg.read` と**続けて**書いてあることは求めない。
      //    2026-08-12 に送信取り消しを入れて `isMe && !unsent && msg.read` になり、
      //    条件が増えただけでこの検査が落ちた（意図は満たしているのに）。
      //    見るのは「msg.read の手前が isMe / isTrainer で絞られているか」。
      const at = code.indexOf("msg.read");
      expect(at, `${label} に msg.read がありません`).toBeGreaterThan(-1);
      expect(
        code.slice(Math.max(0, at - 80), at),
        `${label} の既読表示が「自分が送った分」に限定されていません`,
      ).toMatch(/(isMe|isTrainer)\s*&&/);
    }
  });

  it("🔴 messageRead が全言語にある", () => {
    for (const lng of LOCALES) {
      const v = localeJson(lng).common?.messageRead;
      expect(typeof v === "string" && v.length > 0, `${lng}.json に common.messageRead がありません`).toBe(
        true,
      );
    }
  });

  it("未読が無いときは既読の書き込みにいかない", () => {
    // markAsRead は messages が変わるたびに呼ばれる。無条件だと毎回 UPDATE の往復が出る。
    const idx = HOOK_CODE.indexOf("const markAsRead");
    expect(idx, "markAsRead が見つかりません").toBeGreaterThan(-1);
    const body = HOOK_CODE.slice(idx, HOOK_CODE.indexOf("\n  };", idx));
    expect(body, "未読を数えていません").toMatch(/const unread =/);
    expect(body, "未読が無いときに早期 return していません").toMatch(
      /if\s*\(unread\.length === 0\)\s*return/,
    );
    // ⚠️ 共有受信箱では「自分宛て」だけを既読にすると、別のスタッフ宛てのまま残り、
    //    開いて読んだのに未読が消えない。こちら側の集合で判定すること。
    expect(body, "既読の対象がこちら側の集合になっていません").toMatch(
      /sides\.selfIds\.includes\(m\.receiver_id\)/,
    );
  });
});

describe("会話相手は自テナントの在籍者だけ", () => {
  it("🔴 退会者が会話相手に並ばない（tenant_members の status で絞る）", () => {
    // user_roles は全テナント横断で status も持たない。ここを見ていると
    // 退会したお客様が会話相手として残り続ける。
    expect(
      /from\("user_roles"\)/.test(TRAINER_CODE),
      "会話相手を user_roles から引いています。テナントも在籍状態も判定できません。",
    ).toBe(false);
    expect(TRAINER_CODE, "tenant_members から引いていません").toMatch(/from\("tenant_members"\)/);
    expect(TRAINER_CODE, "テナントで絞っていません").toMatch(/eq\("tenant_id",\s*tenantId\)/);
    // 休会は残す。休会にした瞬間に消えるのは「休会」ではなく「消滅」。
    expect(TRAINER_CODE, "在籍状態で絞っていません").toMatch(
      /in\("status",\s*\["active",\s*"suspended"\]\)/,
    );
  });

  it("🔴 会話プレビューを人数分のクエリで取らない（N+1 に戻さない）", () => {
    // 以前は顧客1人につき1クエリを直列で回していた。30人なら30往復。
    const fnIdx = TRAINER_CODE.indexOf("fetchLastMessages");
    expect(fnIdx, "fetchLastMessages が見つかりません").toBeGreaterThan(-1);
    const body = TRAINER_CODE.slice(fnIdx, fnIdx + 1200);
    expect(
      /for\s*\(const\s+\w+\s+of\s+customers\)/.test(body),
      "顧客ごとにループしてクエリを投げています（N+1）",
    ).toBe(false);
    expect(body, "1回で引いていません").toMatch(/from\("messages"\)/);
    expect(body, "遡る件数の上限がありません").toMatch(/LAST_MESSAGE_SCAN_LIMIT/);
  });

  it("走査上限が実際の定数として存在する", () => {
    const m = TRAINER_CODE.match(/LAST_MESSAGE_SCAN_LIMIT\s*=\s*(\d+)/);
    expect(m, "LAST_MESSAGE_SCAN_LIMIT の定義がありません").toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(100);
  });
});
