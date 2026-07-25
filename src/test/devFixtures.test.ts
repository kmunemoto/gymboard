import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { buildDevFixtures, DEV_OWNER_ID, DEV_TENANT_ID } from "@/dev/fixtures";

// 開発用ダミーデータ（`npm run dev:fixtures`）の安全装置。
// 詳細と使い方: mem/ops/dev-fixtures.md

const SALUTE_TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

describe("開発用ダミーデータ（dev fixtures）", () => {
  it("本番ビルドでは差し替えスタブに置き換わる設定になっている", () => {
    // ここが外れると、架空のジム名・お客様名が本番の JS に混入する。
    // tree-shaking では落ちない（データ生成がモジュール読み込み時の副作用になるため）ので、
    // vite の alias で物理的に差し替えている。
    const config = readFileSync("vite.config.ts", "utf8");
    expect(config).toContain('"@/dev/fixtureClient": path.resolve(__dirname, "./src/dev/fixtureClient.stub.ts")');
    expect(config).toMatch(/mode === "production"[\s\S]{0,200}fixtureClient\.stub\.ts/);
  });

  it("スタブは本物と同じ名前を export している", () => {
    // 名前がずれると本番ビルドが解決できずに壊れる
    expect(readFileSync("src/dev/fixtureClient.stub.ts", "utf8")).toContain("export function createFixtureClient");
    expect(readFileSync("src/dev/fixtureClient.ts", "utf8")).toContain("export function createFixtureClient");
  });

  it("ダミークライアントを読み込むのは supabase クライアント定義だけ", () => {
    // 他所から直接 import されると、alias による差し替えの前提が崩れる
    const importers: string[] = [];
    for (const file of walk("src")) {
      if (!/\.tsx?$/.test(file)) continue;
      if (file.startsWith("src/dev/") || file.startsWith("src/test/")) continue;
      if (!readFileSync(file, "utf8").includes("dev/fixtureClient")) continue;
      importers.push(file);
    }
    expect(importers).toEqual(["src/integrations/supabase/client.ts"]);
  });

  it("有効化の判定に import.meta.env.DEV が入っている", () => {
    // 本番ビルドでは定数 false になる。環境変数だけの判定にすると、
    // 本番に VITE_DEV_FIXTURES が紛れ込んだときにダミーデータで動いてしまう。
    const client = readFileSync("src/integrations/supabase/client.ts", "utf8");
    expect(client).toMatch(/import\.meta\.env\.DEV\s*&&\s*import\.meta\.env\.VITE_DEV_FIXTURES/);
  });

  it("本番テナント（Salute御所南）のIDや実在の連絡先を含まない", () => {
    const json = JSON.stringify(buildDevFixtures());
    expect(json).not.toContain(SALUTE_TENANT_ID);
    expect(json).not.toContain("kyoto-salute");
    expect(json).not.toContain("Salute");
    expect(DEV_TENANT_ID).not.toBe(SALUTE_TENANT_ID);
    expect(DEV_OWNER_ID).not.toBe(SALUTE_TENANT_ID);
  });

  it("画面確認に足りるだけのデータが入っている", () => {
    const f = buildDevFixtures();
    expect(f.tenants).toHaveLength(1);
    expect(f.profiles.length).toBeGreaterThanOrEqual(4);
    expect(f.tenant_plans.length).toBeGreaterThanOrEqual(3);
    expect(f.bookings.length).toBeGreaterThan(20);
    expect(f.exercises.length).toBeGreaterThanOrEqual(8);
    expect(f.workouts.length).toBeGreaterThan(10);
  });

  it("予約は「今日」を基準に作られる（時間が経っても全部過去にならない）", () => {
    const f = buildDevFixtures();
    const now = Date.now();
    const future = f.bookings.filter((b) => new Date(b.booking_date as string).getTime() > now);
    const past = f.bookings.filter((b) => new Date(b.booking_date as string).getTime() < now);
    expect(future.length, "未来の予約が無いと予定表・稼働率の確認ができない").toBeGreaterThan(0);
    expect(past.length, "過去の予約が無いと売上・離脱アラートの確認ができない").toBeGreaterThan(0);
  });

  it("予約の時刻はJST基準で作られている（営業時間内に収まる）", () => {
    // ローカル時刻で作ると、コンテナのタイムゾーン次第で全予約が9時間ずれ、
    // 「営業時間外に全部の予約が並ぶ」という現実にはあり得ない画面になる
    const f = buildDevFixtures();
    const hours = f.bookings.map((b) => {
      const jst = new Date(new Date(b.booking_date as string).getTime() + 9 * 60 * 60 * 1000);
      return jst.getUTCHours();
    });
    const { start, end } = (f.tenants[0].operating_hours as { start: string; end: string });
    for (const h of hours) {
      expect(h, `JST ${h}時の予約が営業時間(${start}〜${end})の外にある`).toBeGreaterThanOrEqual(Number(start.slice(0, 2)));
      expect(h).toBeLessThan(Number(end.slice(0, 2)));
    }
  });

  it("プラン名は profiles.plan と tenant_plans.plan_name で一致している", () => {
    // 売上集計は profiles.plan（文字列）と tenant_plans.plan_name の一致で価格を引く。
    // ずれていると売上が常に ¥0 になり、確認の役に立たない（実際に一度そうなった）
    const f = buildDevFixtures();
    const planNames = new Set(f.tenant_plans.map((p) => p.plan_name));
    const used = f.profiles.map((p) => p.plan).filter(Boolean);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(planNames, `${name} が tenant_plans に無い`).toContain(name);
  });
});
