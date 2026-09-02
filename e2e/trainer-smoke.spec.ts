import { test, expect, type Page } from "@playwright/test";

// 主要導線のスモーク（第1段）。
//
// 目的は「画面が開くか」ではなく、**壊れたことに気づけない類の壊れ方**を捕まえること:
//   ・真っ白（描画されない）
//   ・JS の例外でその画面だけ機能しない
//   ・メニューを押しても切り替わらない
// 既存のユニットテストの多くはソースを文字列で検査する「配線の番人」なので、
// 実際にブラウザで動くかは今までどこも見ていなかった。
//
// ## 🔴 画面の文言で判定しない
//
// このアプリは5言語 i18n で、兄弟アプリは語彙をオーバーレイする
// （src/test/forkHostileTests.test.ts が「リテラルで断言するな」を強制している）。
// E2E も同じ方針にする。判定はロール・構造・アイコンで行い、
// 「見出しの文字が Clients か 顧客か」には依存させない。
//
// 実際、最初は英語ラベルを直書きして5本落とした。画面は正しく動いていて、
// メニューが "Customers" なのに見出しは "Clients" だっただけ。
// **文言で判定すると、動いているものを落とすテストになる。**
//
// ⚠️ fixtures モードなので RLS・DB制約・Edge Function は検証範囲外
//    （playwright.config.ts の冒頭コメント参照）。

/**
 * 言語を ja に固定する。
 *
 * i18n の検出順は localStorage → navigator（src/lib/i18n.ts）。固定しないと
 * ブラウザのロケール次第で表示言語が変わり、CI と手元で条件が揃わない。
 * ja は init の resources に同梱されているので、遅延読込の一瞬のちらつきも起きない。
 */
const pinLocale = (page: Page) =>
  page.addInitScript(() => localStorage.setItem("i18nextLng", "ja"));

/**
 * アプリが描画し終えるまで待ってから開く。
 *
 * ⚠️ `goto` の直後に body を読むと**必ず空**になる。React の起動＋認証状態の解決＋
 *    lazy チャンクの取得が終わるまで中身が無いため。実際にこれで2本落として気づいた。
 */
const gotoApp = async (page: Page, path = "/") => {
  await page.goto(path, { waitUntil: "networkidle" });
  await expect
    .poll(async () => (await page.locator("body").innerText()).trim().length, {
      timeout: 20_000,
      message: "アプリが描画されませんでした（真っ白のまま）",
    })
    .toBeGreaterThan(50);
};

/** 画面遷移で例外が出たら落とすための共通配線。 */
const watchErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const text = m.text();
      // 画像の404など、機能に影響しないものは拾わない
      if (!/favicon|Failed to load resource/i.test(text)) errors.push(text);
    }
  });
  return errors;
};

/** いま表示されている主見出し（h1）。ホームの描画確認に使う。 */
const mainHeading = (page: Page) => page.getByRole("heading", { level: 1 }).first();

/**
 * いま表示されている中身の指紋。どの画面を見ているかの判定に使う。
 *
 * ⚠️ h1 では判定しない。**h1 が無い画面が実在する**（カウンセリング画面）。
 *    「全画面に h1 を付けろ」はテストの都合でアプリを変えることになるので採らない。
 *    見たい不変条件は「押した先に中身がある・画面ごとに違う」なので、本文で見る。
 */
const contentSignature = async (page: Page) => {
  const main = page.getByRole("main");
  const text =
    (await main.count()) > 0
      ? await main.innerText()
      : await page.locator("body").innerText();
  return text.replace(/\s+/g, " ").trim().slice(0, 400);
};

/**
 * 描画が落ち着くまで待って指紋を返す（2回続けて同じになったら確定とみなす）。
 *
 * ⚠️ `minLength` を渡すこと。読み込み中の骨組みは**それ自体が安定している**ので、
 *    2回続けて同じ＝確定、だけで抜けると短い指紋をつかんで「中身が空です」で落ちる
 *    （2026-09-03 に実際に踏んだ。記録タブで長さ 20 ちょうど）。短いうちは待ち続け、
 *    それでも伸びなければ最後の値を返す＝本当に空なら呼び出し側の断言で落ちる。
 */
const settledSignature = async (page: Page, minLength = 0) => {
  let prev = "";
  for (let i = 0; i < 12; i++) {
    const now = await contentSignature(page);
    if (now && now === prev && now.length > minLength) return now;
    prev = now;
    await page.waitForTimeout(150);
  }
  return prev;
};

/**
 * ナビ項目を全部押して、画面ごとの指紋を集める。
 *
 * ⚠️ 「押したら前と変わる」では判定できない。**最初の1回はすでに開いている画面**
 *    （ホーム）なので、正しく動いていても中身は変わらない。これで3本落とした。
 *    見るべきは「項目の数だけ違う画面がある」＝どれも固有の画面を開いている、のほう。
 */
const walkNav = async (page: Page, items: ReturnType<Page["getByRole"]>) => {
  const count = await items.count();
  const seen: string[] = [];
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const label = (await item.innerText()).trim() || `#${i}`;
    await item.click();
    const sig = await settledSignature(page, 20);
    expect(sig.length, `「${label}」の中身が空です`).toBeGreaterThan(20);
    seen.push(sig);
  }
  return { count, seen };
};

test.describe("ジム側の主要導線", () => {
  test.beforeEach(({ page }) => pinLocale(page));

  test("ホームが描画され、当日の予定と数字が並ぶ", async ({ page }) => {
    const errors = watchErrors(page);
    await gotoApp(page);

    // 主見出しがある＝ダッシュボードが描けている
    await expect(mainHeading(page)).toBeVisible();
    // サイドメニューが並んでいる（fixtures のオーナーとして入れている）
    const menu = page.getByRole("complementary").getByRole("button");
    expect(await menu.count(), "サイドメニューが出ていません").toBeGreaterThanOrEqual(5);

    expect(errors, `ホームで例外が出ている:\n${errors.join("\n")}`).toEqual([]);
  });

  test("サイドメニューの各画面が、例外なく開いて切り替わる", async ({ page }) => {
    // 10画面を1つずつ開いて描画を待つので、既定の枠には収まらない
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await gotoApp(page);

    const menu = page.getByRole("complementary").getByRole("button");
    const { count, seen } = await walkNav(page, menu);
    expect(count, "メニュー項目がありません").toBeGreaterThanOrEqual(5);

    // 押しても切り替わっていなければ、指紋が重複して数が足りなくなる
    expect(
      new Set(seen).size,
      `メニュー${count}個に対して、開いた画面は${new Set(seen).size}種類しかありません`,
    ).toBe(count);
    expect(errors, `メニュー巡回で例外が出ている:\n${errors.join("\n")}`).toEqual([]);
  });

  test("顧客一覧からカルテを開ける", async ({ page }) => {
    const errors = watchErrors(page);
    await gotoApp(page);

    // 顧客の画面へ。
    // ⚠️ ラベルの文字では探さない（言語で変わる）。Lucide は svg に
    //    `lucide-<アイコン名>` を付けるので、TrainerSidebar が clients に割り当てている
    //    Users アイコンで引く。タブ定義（id と icon）と同じだけ安定している。
    const clientsTab = page
      .getByRole("complementary")
      .getByRole("button")
      .filter({ has: page.locator("svg.lucide-users") });
    await expect(clientsTab, "顧客タブが見つかりません").toHaveCount(1);
    await clientsTab.click();

    const listSignature = await settledSignature(page);

    // 一覧のカードは card-hover + cursor-pointer（TrainerClientList の renderRow）
    const rows = page.getByRole("main").locator(".card-hover.cursor-pointer");
    expect(await rows.count(), "顧客カードが1件も出ていません").toBeGreaterThan(0);

    await rows.first().click();
    await expect
      .poll(async () => await contentSignature(page), {
        timeout: 10_000,
        message: "顧客を押してもカルテが開きません",
      })
      .not.toBe(listSignature);

    expect(errors, `カルテで例外が出ている:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("お客様側の主要導線", () => {
  // fixtures は localStorage の devFixtureRole で会員/店を切り替える
  test.beforeEach(async ({ page }) => {
    await pinLocale(page);
    await page.addInitScript(() => localStorage.setItem("devFixtureRole", "customer"));
  });

  test("ホームが描画される", async ({ page }) => {
    const errors = watchErrors(page);
    await gotoApp(page); // 中身が出るまで待つ＝真っ白の検出はここで済んでいる
    expect(errors, `お客様ホームで例外が出ている:\n${errors.join("\n")}`).toEqual([]);
  });

  test("下部ナビの各タブが、例外なく開いて切り替わる", async ({ page }) => {
    const errors = watchErrors(page);
    await gotoApp(page);

    // 下部ナビ。ホーム/記録/予約/食事/設定 のような並び
    const nav = page.getByRole("navigation").getByRole("button");
    const { count, seen } = await walkNav(page, nav);
    expect(count, "下部ナビが出ていません").toBeGreaterThanOrEqual(3);

    expect(
      new Set(seen).size,
      `タブ${count}個に対して、開いた画面は${new Set(seen).size}種類しかありません`,
    ).toBe(count);
    expect(errors, `タブ巡回で例外が出ている:\n${errors.join("\n")}`).toEqual([]);
  });
});
