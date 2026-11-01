/**
 * LINE（公式アカウント）で送ってよい相手（2026-11-01・点検の拡大 send-line-message-1）。
 *   `supabase/functions/_shared/lineRecipients.ts`・`supabase/functions/send-line-message/index.ts`
 *
 * 以前は「同じジムなら誰にでも」で、お客様が他のお客様へ、全ジム共通の公式アカウント（Salute のアカウント）から
 * 任意の文面（リンク付き）を送れた（今のアプリは LINE 連携を止めているが、関数は直接呼べる）。
 * 自分以外へは「同じジムに一緒に在籍していて、どちらかがそのジムのスタッフ」のときだけにした。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mayLineMessage } from "../../supabase/functions/_shared/lineRecipients";

const T1 = "t1";
const T2 = "t2";

describe("mayLineMessage", () => {
  it("スタッフ → そのジムのお客様（代理予約・取り消しの連絡）は可", () => {
    expect(mayLineMessage([{ tenantId: T1, role: "owner" }], [{ tenantId: T1, role: "customer" }])).toBe(true);
    expect(mayLineMessage([{ tenantId: T1, role: "trainer" }], [{ tenantId: T1, role: "customer" }])).toBe(true);
  });

  it("お客様 → そのジムのスタッフ（予約・キャンセルの連絡）は可", () => {
    expect(mayLineMessage([{ tenantId: T1, role: "customer" }], [{ tenantId: T1, role: "owner" }])).toBe(true);
    expect(mayLineMessage([{ tenantId: T1, role: "customer" }], [{ tenantId: T1, role: "trainer" }])).toBe(true);
  });

  it("🔴 お客様 → 同じジムの他のお客様は不可", () => {
    expect(mayLineMessage([{ tenantId: T1, role: "customer" }], [{ tenantId: T1, role: "customer" }])).toBe(false);
  });

  it("🔴 別のジムのスタッフ・お客様へは不可（自分がよそでスタッフでも）", () => {
    expect(mayLineMessage([{ tenantId: T2, role: "owner" }, { tenantId: T1, role: "customer" }], [{ tenantId: T1, role: "customer" }])).toBe(false);
    expect(mayLineMessage([{ tenantId: T1, role: "customer" }], [{ tenantId: T2, role: "owner" }])).toBe(false);
  });

  it("所属が無い・空のジム ID は不可", () => {
    expect(mayLineMessage([], [{ tenantId: T1, role: "owner" }])).toBe(false);
    expect(mayLineMessage([{ tenantId: "", role: "owner" }], [{ tenantId: "", role: "customer" }])).toBe(false);
  });
});

describe("send-line-message は自分以外の宛先にこの判定を使う", () => {
  const code = readFileSync("supabase/functions/send-line-message/index.ts", "utf8");

  it("有効な所属と役割を引いて判定する（判定できなければ送らない）", () => {
    expect(code).toContain('.select("tenant_id, role")');
    expect(code).toContain('.eq("status", "active");');
    expect(code).toContain("allowed = await mayMessage(supabase, caller.userId, user_id);");
    expect(code).toMatch(/catch \(e\) \{[\s\S]{0,160}allowed = false;/);
    expect(code).not.toMatch(/sharesTenant/);
  });

  it("どの版が動いているかの印を全部の応答に付ける（デプロイの確認に使う）", () => {
    expect(code).toMatch(/const BUILD = "\d{4}-\d{2}-\d{2}-[a-z-]+";/);
    expect(code).toContain('"x-gymboard-build": BUILD,');
  });
});
