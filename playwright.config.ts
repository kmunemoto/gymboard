import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";

// 主要導線の E2E（第1段）。
//
// ## なぜ fixtures モードで回すのか
//
// 本物の Supabase（Lovable Cloud の本番プロジェクト1つ）しか無く、テスト用の
// ステージング環境が存在しない。本番に対して E2E を回すと他店のデータを触りうるし、
// クラウドのセッションからは *.supabase.co へ直接繋げない（プロキシが CONNECT を弾く）。
//
// そこで第1段は `npm run dev:fixtures`（VITE_DEV_FIXTURES=true）で回す。
// Supabase クライアントがダミー（src/dev/fixtureClient.ts）に差し替わり、
// ログインもネットワークも無しで全画面が描画される。
//
// ⚠️ **この E2E が見るのは UI の導線だけ。** RLS・DBの制約・Edge Function は
//    fixtures では再現されない（fixtureClient.ts:14-17 に明記）。
//    バックエンド込みの E2E は、テスト用テナントを分離できるようになってから（第2段）。
//
// ## ブラウザ
//
// この環境には Chromium が /opt/pw-browsers に**プリインストール済み**で、
// `npx playwright install` は実行しない（環境の指示）。ただし @playwright/test が
// 期待するリビジョンとズレることがあるので、実体を executablePath で直接指す。
// 環境変数 PW_CHROMIUM_PATH で上書きできる（CI や別環境向け）。
// GitHub Actions のランナーにはこのパスは無い。その場合は指定せず、
// `npx playwright install chromium` が置いた playwright 管理下の実体に任せる。
const CHROMIUM =
  process.env.PW_CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const launchOptions = existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {};

// vite.config.ts の host は "::"（IPv6）だが、この環境は IPv6 バインドが使えない。
// E2E からは 127.0.0.1 に明示的に寄せる。
const PORT = 8080;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // ナビを1項目ずつ巡回する本があり、10画面ぶんの描画待ちで30秒では足りなかった。
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --mode fixtures --host 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
