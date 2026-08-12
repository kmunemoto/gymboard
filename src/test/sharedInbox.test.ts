import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// 共有受信箱（スタッフ全員が読めて、誰でも返信できる）。
//
// ── なぜ要るか（2026-08-11）─────────────────────────────────────────
//
// チャットの行は 1対1（sender_id / receiver_id）で、お客様の宛先は
// **代表スタッフ1名**（fetchMyTenantTrainerId）に固定されていた。担当スタッフ制を
// 入れたのに、チャットだけがその前の形のまま残っていた。結果:
//
//   ・担当が休みだと**会話が止まる**（他の人が返しても別の会話になる）
//   ・退職・担当替えで**履歴が切れる**
//   ・未読はその人にしか出ない＝**誰も気づかないまま溜まる会話**ができる
//
// ── どう直したか ────────────────────────────────────────────────
//
// **行の持ち方は変えていない。** 読むときに「ジム側スタッフ全員」を
// ひとまとまりとして扱う。DBのマイグレーションは0件、データ移行も不要。
//
// テナント内でスタッフが全メッセージを読めることは、既存の RLS
// （"Trainers can view all messages" ＋ RESTRICTIVE な tenant_isolation）で
// もともと許可されている。足りなかったのは**クライアントの絞り込み**だけだった。

const HOOK = readFileSync("src/hooks/useMessages.ts", "utf8");
const DIRECTORY = readFileSync("src/hooks/useStaffDirectory.ts", "utf8");
const TRAINER = readFileSync("src/components/trainer/TrainerMessages.tsx", "utf8");
const CUSTOMER = readFileSync("src/components/customer/CustomerChat.tsx", "utf8");
const CLIENT_DETAIL = readFileSync("src/components/trainer/TrainerClientDetail.tsx", "utf8");
const TRAINER_VIEW = readFileSync("src/components/trainer/TrainerView.tsx", "utf8");

const stripJs = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const HOOK_CODE = stripJs(HOOK);
const DIRECTORY_CODE = stripJs(DIRECTORY);

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
const localeJson = (lng: string) =>
  JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")) as Record<string, any>;

describe("会話を「集合 対 集合」で束ねる", () => {
  it("useMessages が selfIds / otherIds を受け取る", () => {
    expect(HOOK_CODE).toMatch(/selfIds\?: string\[\]/);
    expect(HOOK_CODE).toMatch(/otherIds\?: string\[\]/);
  });

  it("🔴 絞り込みが集合（in）になっている", () => {
    // eq のままだと、担当以外のスタッフが返した分が会話から抜け落ちる。
    //
    // ⚠️ 「in が1つでもあれば緑」にしない。条件は**2本**（行き・帰り）あり、
    //    片方だけ eq に戻す変異が素通りした。2本とも in であることを数える。
    const idx = HOOK_CODE.indexOf("const conversationFilter");
    expect(idx, "conversationFilter が見つかりません").toBeGreaterThan(-1);
    const body = HOOK_CODE.slice(idx, HOOK_CODE.indexOf("\n};", idx));
    const senderIn = (body.match(/sender_id\.in\./g) ?? []).length;
    const receiverIn = (body.match(/receiver_id\.in\./g) ?? []).length;
    expect(senderIn, "sender_id 側の in が2本ありません（行き・帰りの両方）").toBe(2);
    expect(receiverIn, "receiver_id 側の in が2本ありません").toBe(2);
    expect(
      /sender_id\.eq\.|receiver_id\.eq\./.test(body),
      "会話の絞り込みに eq が残っています。担当以外の返信が会話から抜け落ちます。",
    ).toBe(false);
  });

  it("既定は自分1人（お客様側の挙動を変えない）", () => {
    expect(HOOK_CODE).toMatch(/\[\.\.\.new Set\(\[user\.id,/);
    expect(HOOK_CODE).toMatch(/\[\.\.\.new Set\(\[otherUserId,/);
  });

  it("🔴 自分が両側に入らない", () => {
    // スタッフが自分自身を相手側にも持つと「自分との会話」が混ざる。
    expect(HOOK_CODE, "相手側からこちら側を除いていません").toMatch(
      /otherIds:\s*otherIds\.filter\(\(id\) => !selfIds\.includes\(id\)\)/,
    );
  });

  it("Realtime の判定も集合で見る", () => {
    // ⚠️ 「selfIds が1回でも出れば緑」にしない。行き・帰りの2本があるので、
    //    片方だけ `=== user.id` に戻す変異が素通りした（実際に見逃した）。
    //    4つの includes が全部揃っていることを見る。
    const idx = HOOK_CODE.indexOf("const belongsHere");
    expect(idx).toBeGreaterThan(-1);
    const body = HOOK_CODE.slice(idx, idx + 400);
    for (const needle of [
      "sides.selfIds.includes(msg.sender_id)",
      "sides.otherIds.includes(msg.receiver_id)",
      "sides.otherIds.includes(msg.sender_id)",
      "sides.selfIds.includes(msg.receiver_id)",
    ]) {
      expect(body, `Realtime の判定に ${needle} がありません`).toContain(needle);
    }
    expect(
      /=== user\.id/.test(body),
      "Realtime の判定に自分1人の比較が残っています。他スタッフの返信が届きません。",
    ).toBe(false);
  });
});

describe("🔴 未読が「誰も気づかないまま」溜まらない", () => {
  it("バッジがこちら側の集合で数える", () => {
    expect(HOOK_CODE).toMatch(/export const useUnreadCount = \(selfIds\?: string\[\]\)/);
    const idx = HOOK_CODE.indexOf("export const useUnreadCount");
    const body = HOOK_CODE.slice(idx, idx + 1200);
    expect(body, "受信者を集合で見ていません").toMatch(/in\("receiver_id", ids\)/);
    // スタッフ同士のやり取りを「お客様からの未読」に数えない
    expect(body, "自分たちが送った分を除外していません").toMatch(/not\("sender_id", "in"/);
  });

  it("会話一覧の未読もこちら側の集合で数える", () => {
    expect(HOOK_CODE).toMatch(/export const useUnreadBySender = \(selfIds\?: string\[\]\)/);
    const idx = HOOK_CODE.indexOf("export const useUnreadBySender");
    const body = HOOK_CODE.slice(idx, idx + 900);
    expect(body).toMatch(/in\("receiver_id", ids\)/);
    expect(body).toMatch(/not\("sender_id", "in"/);
  });

  it("既読も「こちら側の誰か宛て」を対象にする", () => {
    const idx = HOOK_CODE.indexOf("const markAsRead");
    const body = HOOK_CODE.slice(idx, HOOK_CODE.indexOf("\n  };", idx));
    expect(body, "自分宛てだけを既読にしています").toMatch(
      /sides\.selfIds\.includes\(m\.receiver_id\)/,
    );
    // 対象を id で指定して更新する（eq(receiver_id, me) に戻さない）
    expect(body).toMatch(/in\("id", unread\.map/);
  });
});

describe("画面の接続", () => {
  it("ジム側の3画面がスタッフ集合を渡している", () => {
    for (const [label, code, marker] of [
      ["TrainerMessages", TRAINER, /useMessages\(selectedCustomerId, \{[\s\S]{0,80}selfIds: staff\.ids/],
      ["TrainerClientDetail", CLIENT_DETAIL, /selfIds: staff\.ids/],
      ["TrainerView", TRAINER_VIEW, /useUnreadCount\(staff\.ids\)/],
    ] as const) {
      expect(code, `${label} が共有受信箱になっていません`).toMatch(marker);
      expect(code, `${label} が useStaffDirectory を使っていません`).toMatch(/useStaffDirectory/);
    }
  });

  it("🔴 お客様側は「相手側」にスタッフ全員を置く", () => {
    // selfIds に置くと、お客様が**スタッフとして**扱われて会話が壊れる。
    expect(CUSTOMER).toMatch(/useMessages\(trainerId, \{[\s\S]{0,80}otherIds: staff\.ids/);
    expect(
      /useMessages\(trainerId, \{[\s\S]{0,80}selfIds:/.test(CUSTOMER),
      "お客様側が selfIds にスタッフを渡しています",
    ).toBe(false);
  });

  it("ジム側の一覧の未読もスタッフ集合で数える", () => {
    expect(TRAINER).toMatch(/useUnreadBySender\(staff\.ids\)/);
  });
});

describe("誰が返したか分かる", () => {
  it("ジム側で、他のスタッフの返信に名前が付く", () => {
    expect(TRAINER).toMatch(/otherStaffName/);
    const idx = TRAINER.indexOf("const otherStaffName");
    const body = TRAINER.slice(idx, idx + 300);
    expect(body, "自分の分にまで名前が付いています").toMatch(/msg\.sender_id !== user\?\.id/);
    expect(body, "名前が取れないときの表示がありません").toMatch(/sharedInbox\.otherStaff/);
  });

  it("ジム側の吹き出しの左右が「お客様かどうか」で決まる", () => {
    // 自分かどうかで決めると、他のスタッフの返信が**お客様側**に並んでしまう。
    expect(TRAINER).toMatch(/const isOurSide = msg\.sender_id !== selectedCustomerId/);
  });

  it("お客様側は、スタッフが2人以上のときだけ名前を出す", () => {
    // 1人ジムでは毎回同じ名前が並ぶだけで邪魔になる。
    const idx = CUSTOMER.indexOf("const staffName");
    expect(idx).toBeGreaterThan(-1);
    expect(CUSTOMER.slice(idx, idx + 200)).toMatch(/staff\.ids\.length > 1/);
  });
});

describe("スタッフ名の出どころ", () => {
  it("🔴 profiles ではなく既存の useTenantStaff を通す", () => {
    // profiles はお客様から他人の行を読めない（profiles_tenant_scope_select）。
    // 直接 profiles を引くと**お客様側でだけ名前が出ない**。
    // 既存の tenantStaff は tenant_members.display_name から取っている。
    expect(DIRECTORY_CODE, "既存の useTenantStaff を使っていません").toMatch(
      /from "@\/hooks\/useTenantStaff"/,
    );
    expect(
      /from\("profiles"\)/.test(DIRECTORY_CODE),
      "useStaffDirectory が profiles を直接引いています。お客様側で名前が出なくなります。",
    ).toBe(false);
  });
});

describe("5言語", () => {
  it("sharedInbox.otherStaff が全言語にある", () => {
    for (const lng of LOCALES) {
      const v = localeJson(lng).sharedInbox?.otherStaff;
      expect(typeof v === "string" && v.length > 0, `${lng}.json に sharedInbox.otherStaff がありません`).toBe(
        true,
      );
    }
  });
});
