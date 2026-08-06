import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  checkoutWebOrigin,
  checkoutHostname,
  detectStripeEnvironment,
  BILLING_RETURN_PATH,
} from "@/lib/gymboardPlans";
import { PRODUCTION_WEB_ORIGIN, STRIPE_LIVE_HOSTS } from "@/lib/brand";

// ネイティブアプリから Stripe の決済ページへ直行する経路の検査。
//
// ── 🔴 一番危ない壊れ方 ─────────────────────────────────────────
// ネイティブの `window.location` は **`capacitor://localhost`**（Android は
// `https://localhost`）で、**hostname は `localhost`**。
// これを `detectStripeEnvironment()` にそのまま渡すと `LIVE_HOSTS` に無いので
// **`sandbox` が返る。**
//
// sandbox の Checkout は、**本物のカードを入れても「成功」して課金されない。**
// ジムオーナーからは契約できたように見え、売上は立たない。**エラーは出ない。**
//
// 同種の事故は 2026-07 に一度起きている（`app.kyoto-salute.com` が `LIVE_HOSTS` に
// 無く sandbox に落ちていた）。**2度目を許さないための検査。**
//
// ── 変異テスト（2026-08-06 実施・4件とも赤になることを確認済み）────
//   1. checkoutWebOrigin を常に windowOrigin を返すようにする → 赤（sandbox に落ちる）
//   2. PRODUCTION_WEB_ORIGIN を STRIPE_LIVE_HOSTS に無いドメインにする → 赤
//   3. TrainerBilling が window.location.hostname を直接使う形に戻す → 赤
//   4. BILLING_RETURN_PATH を Edge Function が許さないホストにする → 赤

const BILLING_TSX = "src/components/trainer/TrainerBilling.tsx";
const CHECKOUT_FN = "supabase/functions/gymboard-create-checkout/index.ts";

describe("ネイティブからの Stripe Checkout", () => {
  it("ネイティブでは本番Webのオリジンに読み替える", () => {
    // capacitor://localhost をそのまま使うと sandbox に落ちる
    expect(checkoutWebOrigin(true, "capacitor://localhost")).toBe(PRODUCTION_WEB_ORIGIN);
    expect(checkoutWebOrigin(true, "https://localhost")).toBe(PRODUCTION_WEB_ORIGIN);
  });

  it("Web ではいまのオリジンをそのまま使う（プレビューを live にしない）", () => {
    // ここを本番オリジンに固定すると、プレビュー環境から実課金が通ってしまう
    expect(checkoutWebOrigin(false, "https://id-preview--abc.lovable.app")).toBe(
      "https://id-preview--abc.lovable.app",
    );
  });

  it("🔴 ネイティブの決済が live になる（sandbox に落ちない）", () => {
    const origin = checkoutWebOrigin(true, "capacitor://localhost");
    const env = detectStripeEnvironment(checkoutHostname(origin));
    expect(
      env,
      "ネイティブの Checkout が sandbox になっています。" +
        "本物のカードで「成功」して課金されない状態です（画面にエラーは出ません）",
    ).toBe("live");
  });

  it("プレビューは sandbox のまま（検査が空振りしていない）", () => {
    // 上の検査が「常に live」を返すだけの実装で通らないことの確認
    const origin = checkoutWebOrigin(false, "https://id-preview--abc.lovable.app");
    expect(detectStripeEnvironment(checkoutHostname(origin))).toBe("sandbox");
  });

  it("PRODUCTION_WEB_ORIGIN が STRIPE_LIVE_HOSTS に入っている", () => {
    // 片方だけ直すと live 判定が崩れる。両者の対応をここで固定する
    const host = checkoutHostname(PRODUCTION_WEB_ORIGIN);
    expect(
      STRIPE_LIVE_HOSTS.includes(host),
      `PRODUCTION_WEB_ORIGIN (${host}) が STRIPE_LIVE_HOSTS にありません。` +
        `ネイティブの決済が sandbox に落ちます`,
    ).toBe(true);
  });

  it("戻り先が Edge Function のホワイトリストを通る", () => {
    // gymboard-create-checkout は success_url / cancel_url のホストを制限している。
    // 通らないURLを組み立てると「URL not allowed」で決済に進めない。
    const fn = readFileSync(CHECKOUT_FN, "utf8");
    const suffixes = [...fn.matchAll(/"(\.[a-z0-9.-]+)"/g)].map((m) => m[1]);
    const host = checkoutHostname(`${PRODUCTION_WEB_ORIGIN}${BILLING_RETURN_PATH}`);
    expect(
      suffixes.some((s) => host.endsWith(s)),
      `戻り先のホスト (${host}) が ${CHECKOUT_FN} のホワイトリスト ${JSON.stringify(suffixes)} を通りません`,
    ).toBe(true);
  });

  it("戻り先ページのルートが存在する", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain(BILLING_RETURN_PATH);
  });

  it("TrainerBilling が hostname を直接使っていない（checkout の組み立て箇所）", () => {
    // 直接使うと 1) の事故に戻る。ソースを見る検査で再発を止める。
    const src = readFileSync(BILLING_TSX, "utf8");
    const handler = src.slice(
      src.indexOf("const handleCheckout"),
      src.indexOf("const handlePortal"),
    );
    expect(handler.length, "handleCheckout を切り出せていません").toBeGreaterThan(200);
    expect(
      handler.includes("detectStripeEnvironment(window.location.hostname)"),
      "handleCheckout が window.location.hostname を直接使っています。" +
        "ネイティブでは localhost になり、sandbox の Checkout が作られます",
    ).toBe(false);
    expect(handler).toContain("checkoutWebOrigin");
  });

  it("ネイティブの課金導線に上流のドメインが直書きされていない", () => {
    // 2026-08-06 まで "https://gymboard.lovable.app/?tab=billing" が直書きされており、
    // 兄弟アプリのジムオーナーが上流の課金画面へ飛ばされていた。
    const src = readFileSync(BILLING_TSX, "utf8");
    const offenders = [...src.matchAll(/https:\/\/[a-z0-9.-]+\.(?:lovable\.app|com)/g)]
      .map((m) => m[0])
      .filter((u) => !u.startsWith(PRODUCTION_WEB_ORIGIN));
    expect(
      offenders,
      `${BILLING_TSX} にドメインが直書きされています。brand.ts 経由にしてください`,
    ).toEqual([]);
  });
});
