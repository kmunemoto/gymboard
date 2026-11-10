/**
 * 画面（service_role 以外）から send-transactional-email を呼ばれたときに、サーバーが決め直す値
 * （2026-11-01・点検の拡大）。
 *   `supabase/functions/_shared/emailClientGuard.ts`・`supabase/functions/send-transactional-email/index.ts`
 *
 * send-transactional-email-tenant-1: 画面が渡した tenantId をそのまま使っていた。
 *   → お客様が自分で作ったジムの ID を入れると、自分のジムのオーナー・先生のログイン用アドレスが入った
 *     履歴の行（duplicate は送らずに宛先だけ残る）がそのジムに書かれ、オーナーとして読めた。
 * send-transactional-email-link-1: ボタンの飛び先（dashboardUrl）と差出人名（gymName）を画面が決められた。
 *   → お客様が店のスタッフ宛てに「ジムボード運営」の名前で、偽のログイン画面へのボタン付きの
 *     「新しい予約が入りました」を正規のドメインから送れた（オーナーのパスワードを狙うフィッシング）。
 *
 * 🔴 壊しやすいもの:
 *   1. 新規予約・受付確認のテンプレートを、画面から呼べる許可リストに戻す（今はサーバーだけが送る）
 *   2. 画面からの tenantId を、確かめずに使う／templateData の user_id から引き当てる
 *   3. ジム名・ご案内・リンクを画面の値のまま使う／先生への写しの送り直しより後ろで直す
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  pickVerifiedTenant,
  serverDecidedTemplateData,
  uniqueTenantsOrNull,
} from "../../supabase/functions/_shared/emailClientGuard";
import { PRODUCTION_WEB_ORIGIN } from "@/lib/brand";

const read = (path: string) => readFileSync(path, "utf8");
/** コメントを落とす（説明に書いた語で誤検知しない） */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");

const EMAIL_FN = "supabase/functions/send-transactional-email/index.ts";
const fn = code(EMAIL_FN);
const handler = fn.slice(fn.indexOf("Deno.serve("));
/** 改行・字下げを1つの空白に畳んだもの（複数行に折った式を1行で探す） */
const flat = handler.replace(/\s+/g, " ");

const V = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";

describe("pickVerifiedTenant: どのジムの履歴に載せるか", () => {
  it("渡された tenantId は、この送信を正当化するジムの中にあるときだけ使う", () => {
    expect(pickVerifiedTenant(V, [V])).toBe(V);
    expect(pickVerifiedTenant(A, [V, A])).toBe(A);
  });

  it("🔴 正当化できないジム（お客様が自分で作ったジムなど）は使わない。候補が1つならそれにする", () => {
    expect(pickVerifiedTenant(A, [V])).toBe(V);
    expect(pickVerifiedTenant(null, [V])).toBe(V);
    expect(pickVerifiedTenant(undefined, [V])).toBe(V);
  });

  it("候補が2つ以上で決められなければ、どのジムの履歴にも載せない（NULL）", () => {
    expect(pickVerifiedTenant("33333333-3333-4333-8333-333333333333", [V, A])).toBeNull();
    expect(pickVerifiedTenant(null, [V, A])).toBeNull();
    expect(pickVerifiedTenant(V, [])).toBeNull();
  });

  it("文字列でない値は渡されなかったのと同じ", () => {
    expect(pickVerifiedTenant({ toString: () => A } as unknown, [V])).toBe(V);
    expect(pickVerifiedTenant(42, [V, A])).toBeNull();
  });
});

describe("uniqueTenantsOrNull", () => {
  it("重複と空を落とす。空なら null（＝送らせない）", () => {
    expect(uniqueTenantsOrNull([V, V, A])).toEqual([V, A]);
    expect(uniqueTenantsOrNull([])).toBeNull();
    expect(uniqueTenantsOrNull([""])).toBeNull();
  });
});

describe("serverDecidedTemplateData: 「誰から・どこへ」はサーバーが決める", () => {
  const server = { appOrigin: PRODUCTION_WEB_ORIGIN, gymName: "本物のジム", gymNote: "店のご案内" };

  it("🔴 ボタンの飛び先は本番のオリジンにする（画面の値は使わない）", () => {
    const out = serverDecidedTemplateData({ dashboardUrl: "https://evil.example/login" }, server);
    expect(out.dashboardUrl).toBe(PRODUCTION_WEB_ORIGIN);
  });

  it("空の飛び先はボタンを出さない（今までどおり）。他の …Url は消す", () => {
    const out = serverDecidedTemplateData(
      { dashboardUrl: "", cancelUrl: "https://evil.example/c", inviteUrl: "https://evil.example/i", imageURL: "x" },
      server,
    );
    expect("dashboardUrl" in out).toBe(false);
    expect("cancelUrl" in out).toBe(false);
    expect("inviteUrl" in out).toBe(false);
    expect("imageURL" in out).toBe(false);
  });

  it("🔴 ジム名（差出人名・本文）は DB の値。分からなければ消す（差出人は製品名になる）", () => {
    expect(serverDecidedTemplateData({ gymName: "ジムボード運営" }, server).gymName).toBe("本物のジム");
    expect(serverDecidedTemplateData({}, server).gymName).toBe("本物のジム");
    const unknown = serverDecidedTemplateData({ gymName: "ジムボード運営" }, { ...server, gymName: null });
    expect("gymName" in unknown).toBe(false);
    const blank = serverDecidedTemplateData({ gymName: "ジムボード運営" }, { ...server, gymName: "  " });
    expect("gymName" in blank).toBe(false);
  });

  it("お店からのご案内は、画面が渡してきたときだけ DB の値に置き換える", () => {
    expect(serverDecidedTemplateData({ gymNote: "偽のご案内" }, server).gymNote).toBe("店のご案内");
    expect(serverDecidedTemplateData({ gymNote: "偽のご案内" }, { ...server, gymNote: null }).gymNote).toBeNull();
    expect("gymNote" in serverDecidedTemplateData({}, server)).toBe(false);
  });

  it("他の値はそのまま。元の templateData は変えない", () => {
    const data = { customerName: "山田", planName: "月4回", options: [{ name: "opt-1" }], gymName: "偽", dashboardUrl: "https://evil.example" };
    const out = serverDecidedTemplateData(data, server);
    expect(out.customerName).toBe("山田");
    expect(out.planName).toBe("月4回");
    expect(out.options).toEqual([{ name: "opt-1" }]);
    expect(data.gymName).toBe("偽");
    expect(data.dashboardUrl).toBe("https://evil.example");
  });
});

describe("send-transactional-email: 画面からの呼び出しの扱い", () => {
  it("🔴 新規予約・受付確認は画面から呼べない（サーバーの notify-new-booking だけが送る）", () => {
    const m = fn.match(/CLIENT_ALLOWED_TEMPLATES = new Set\(\[([\s\S]*?)\]\)/);
    const listed = [...(m?.[1] ?? "").matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
    expect(listed).not.toContain("new-booking-notification");
    expect(listed).not.toContain("booking-confirmation");
    // サーバー側が送り続けていること（外した分の送信が消えていない）
    const notif = read("supabase/functions/notify-new-booking/index.ts");
    expect(notif).toMatch(/templateName: "new-booking-notification"/);
    expect(notif).toMatch(/templateName: "booking-confirmation"/);
  });

  it("画面のコードが送っているテンプレートは、すべて許可リストの中（送信が止まっていない）", () => {
    const m = fn.match(/CLIENT_ALLOWED_TEMPLATES = new Set\(\[([\s\S]*?)\]\)/);
    const allowed = new Set([...(m?.[1] ?? "").matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (p === join("src", "test")) continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(n)) files.push(p);
      }
    };
    walk("src");
    const used: string[] = [];
    for (const f of files) {
      const s = code(f);
      let at = s.indexOf('"send-transactional-email"');
      while (at !== -1) {
        const t = s.slice(at, at + 800).match(/templateName:\s*"([a-z0-9-]+)"/);
        if (t) used.push(`${f}:${t[1]}`);
        at = s.indexOf('"send-transactional-email"', at + 1);
      }
    }
    expect(used.length).toBeGreaterThanOrEqual(4);
    for (const u of used) expect(allowed.has(u.split(":").pop()!), u).toBe(true);
  });

  it("🔴 画面からの tenantId は確かめてから使う（service_role だけはそのまま）", () => {
    expect(flat).toContain(
      "tenantId = caller.isServiceRole ? requestedTenantId : pickVerifiedTenant(requestedTenantId, clientTenants ?? [])",
    );
    expect(fn).toContain("async function authorizeClientCall(");
    expect(fn).toMatch(/\): Promise<string\[\] \| null> \{\s*if \(!CLIENT_ALLOWED_TEMPLATES\.has/);
  });

  it("🔴 templateData の user_id から引き当てるのは service_role だけ", () => {
    expect(handler).toContain("if (!tenantId && caller.isServiceRole) {");
    expect(handler).not.toMatch(/if \(!tenantId\) \{/);
  });

  it("🔴 画面からの templateData は、DB のジム名・ご案内と本番のオリジンで決め直す", () => {
    const at = handler.indexOf("templateData = serverDecidedTemplateData(templateData, {");
    expect(at).toBeGreaterThan(-1);
    const block = handler.slice(handler.lastIndexOf("if (!caller.isServiceRole) {", at), at + 300);
    expect(block).toContain(".from('tenants')");
    expect(block).toContain(".select('gym_name, booking_email_note')");
    expect(block).toContain(".eq('id', tenantId)");
    expect(block).toContain("appOrigin: PRODUCTION_WEB_ORIGIN");
    expect(block).toContain("gymName: gym?.gym_name ?? null");
    expect(block).toContain("gymNote: gym?.booking_email_note ?? null");
  });

  it("🔴 決め直しは、先生への写しの送り直し・宛先の解決・本文の描画より前", () => {
    const at = handler.indexOf("templateData = serverDecidedTemplateData(templateData, {");
    expect(at).toBeLessThan(handler.indexOf("await representativeInsteadOfInstructor("));
    // 写しは invokeAsService で頼む（2026-11-10。supabase.functions.invoke では本番の鍵が載らない）
    expect(handler.indexOf("invokeAsService('send-transactional-email'")).toBeGreaterThan(-1);
    expect(at).toBeLessThan(handler.indexOf("invokeAsService('send-transactional-email'"));
    expect(at).toBeLessThan(handler.indexOf("React.createElement(template.component, templateData)"));
    expect(at).toBeLessThan(handler.indexOf("const senderName ="));
  });

  it("飛び先のオリジンは brand.ts の PRODUCTION_WEB_ORIGIN と同じ値（Deno は import できず写し）", () => {
    expect(fn.match(/const PRODUCTION_WEB_ORIGIN = '([^']+)'/)?.[1]).toBe(PRODUCTION_WEB_ORIGIN);
  });

  it("🔴 予約通知の冪等キーの予約（先勝ち）は service_role の呼び出しだけ", () => {
    expect(handler).toMatch(/const dedupable = caller\.isServiceRole\s*&& !!explicitIdempotencyKey/);
  });
});
