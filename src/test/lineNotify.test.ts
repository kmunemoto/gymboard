import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// LINE連携を止めた（LINE_INTEGRATION_ENABLED = false）ことを実効性のある形で担保する。
//
// 以前の状態: フラグは**設定画面のセクション表示しか止めていなかった**。
// 送信は `supabase.functions.invoke("send-line-message", ...)` が10箇所に散っており、
// フラグをOFFにしても予約・キャンセル・メッセージのたびに送信が走り続ける作りだった。
// 送信を src/lib/lineNotify.ts の1箇所に集約したので、それが崩れないよう見張る。

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

beforeEach(() => invoke.mockReset());

describe("LINE連携の停止", () => {
  it("フラグがOFFになっている", () => {
    const src = readFileSync("src/lib/featureFlags.ts", "utf8");
    expect(src).toMatch(/export const LINE_INTEGRATION_ENABLED = false;/);
  });

  it("フラグがOFFのとき、実際に送信しない", async () => {
    const { sendLineMessage } = await import("@/lib/lineNotify");
    await sendLineMessage({ user_id: "u1", message: "テスト" }, "テスト");
    expect(invoke, "LINE連携がOFFなのに送信された").not.toHaveBeenCalled();
  });

  it("send-line-message を呼ぶのは lineNotify.ts だけ", () => {
    // ここが増えると、フラグをすり抜けて送信される経路ができる。
    // 実際にそうなっていて、10箇所が直接 invoke していた。
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!/\.tsx?$/.test(file)) continue;
      if (file === "src/lib/lineNotify.ts" || file.startsWith("src/test/")) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (line.includes('"send-line-message"')) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(
      offenders,
      offenders.length
        ? `LINE送信は @/lib/lineNotify の sendLineMessage() を通してください:\n${offenders.join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("サーバー側の前日リマインド(cron)を止めるマイグレーションがある", () => {
    // クライアントのフラグは pg_cron からの送信を止められない。
    const sql = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
      .join("\n");
    expect(sql).toMatch(/cron\.unschedule/);
    expect(sql).toMatch(/line-booking-reminder/);
  });

  it("「LINEで連絡」ボタン(tenants.line_url)は残っている", () => {
    // これは各ジムが自分のLINE URLを入れるだけのリンクで、Messaging API を使わない。
    // マルチテナントでも問題なく動くので、連携停止の巻き添えで消さない。
    const view = readFileSync("src/components/customer/CustomerView.tsx", "utf8");
    expect(view).toContain("tenant?.line_url");
  });
});
