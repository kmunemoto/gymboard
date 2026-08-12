import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

// 新着メッセージの通知が「送信者の端末任せ」に戻らないことを見張る。
//
// ── なぜ要るか（2026-08-11）─────────────────────────────────────────
//
// 通知は sendMessage の中で fire-and-forget していた。つまり**送信者の端末が
// 投げていた**ので、送信直後にアプリを閉じる・画面を切り替える・電波が切れる、の
// どれでも**通知が飛ばなかった**。console に出るだけで、送った本人にも
// 受け取る側にも分からない。
//
// ネイティブでは「メッセージは届いているのに気づかれない」＝連絡手段が実質ゼロになる。
// 同じ日に altool でも「緑なのに届いていない」を踏んでいる。**同じ型の壊れ方**。

const HOOK = readFileSync("src/hooks/useMessages.ts", "utf8");
const FUNC = readFileSync("supabase/functions/notify-new-message/index.ts", "utf8");
const CONFIG = readFileSync("supabase/config.toml", "utf8");

const MIGRATION_DIR = "supabase/migrations";

// ⚠️ ファイル名を直書きしない。**後から CREATE OR REPLACE で上書きされる**ので、
//    古いファイルを見張り続けると「テストは緑なのに本番の定義は別物」になる。
//    実際に 20260811010000 の認可が間違っていて、20260812040000 で差し替えた。
const MIGRATION_FILES = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => /notify_new_message/.test(readFileSync(`${MIGRATION_DIR}/${f}`, "utf8")));

/** トリガーの有無など「どこかで一度やってあればよい」検査はこちらを見る。 */
const MIGRATION = MIGRATION_FILES.map((f) => readFileSync(`${MIGRATION_DIR}/${f}`, "utf8")).join("\n");

/** いま実際に効いている定義。**最後に関数を定義したファイル**だけを見る。 */
const LATEST_FN_FILE = [...MIGRATION_FILES]
  .reverse()
  .find((f) =>
    /CREATE OR REPLACE FUNCTION public\.notify_new_message\(\)/.test(
      readFileSync(`${MIGRATION_DIR}/${f}`, "utf8"),
    ),
  );
const LATEST_FN = LATEST_FN_FILE ? readFileSync(`${MIGRATION_DIR}/${LATEST_FN_FILE}`, "utf8") : "";

/** JS/TS のコメントを落とす。経緯コメントで検査を満たせないようにする。 */
const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

/** SQL のコメントを落とす。 */
const stripSql = (src: string): string =>
  src
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const HOOK_CODE = stripJs(HOOK);
const FUNC_CODE = stripJs(FUNC);
const MIGRATION_CODE = stripSql(MIGRATION);
const LATEST_FN_CODE = stripSql(LATEST_FN);
const SHARED_AUTH = stripJs(readFileSync("supabase/functions/_shared/auth.ts", "utf8"));

describe("クライアントは通知を投げない", () => {
  it("コメント除去が空振りしていない", () => {
    expect(HOOK_CODE).toContain("sendMessage");
    expect(FUNC_CODE).toContain("Deno.serve");
    expect(MIGRATION_CODE).toContain("CREATE TRIGGER");
    // ファイル探索が空振りすると LATEST_FN_CODE が空文字になり、
    // 下の検査が**全部素通り**する（not.toMatch は空文字に対して緑）。
    expect(MIGRATION_FILES.length, "notify_new_message のマイグレーションが見つかりません").toBeGreaterThan(0);
    expect(LATEST_FN_CODE, "関数を定義しているマイグレーションが見つかりません").toContain(
      "CREATE OR REPLACE FUNCTION public.notify_new_message()",
    );
  });

  it("🔴 useMessages がプッシュ/LINE を送っていない", () => {
    // ここに書き戻すと、サーバー側と合わせて**二重に鳴る**。
    expect(
      /send-push-notification/.test(HOOK_CODE),
      "useMessages がプッシュを直接送っています。トリガー側と二重に鳴ります。",
    ).toBe(false);
    expect(
      /sendLineMessage/.test(HOOK_CODE),
      "useMessages が LINE を直接送っています。足すなら Edge Function 側に。",
    ).toBe(false);
  });
});

describe("DB の INSERT が通知の起点になっている", () => {
  it("🔴 messages の AFTER INSERT トリガーがある", () => {
    expect(MIGRATION_CODE).toMatch(/CREATE OR REPLACE FUNCTION public\.notify_new_message\(\)/);
    expect(MIGRATION_CODE, "AFTER INSERT のトリガーがありません").toMatch(
      /AFTER INSERT ON public\.messages/,
    );
    expect(MIGRATION_CODE, "Edge Function を叩いていません").toMatch(/net\.http_post/);
    expect(MIGRATION_CODE).toMatch(/notify-new-message/);
  });

  it("🔴 通知の失敗がメッセージの INSERT を巻き添えにしない", () => {
    // 通知は「あったほうがいいもの」、メッセージ本体は「絶対に落とせないもの」。
    // ここが無いと、Edge Function が落ちた日にチャットごと使えなくなる。
    //
    // ⚠️ 見るのは **いま効いている定義**（最後に CREATE OR REPLACE したファイル）。
    //    全ファイルの結合を見ると、古い版に書いてあるだけで緑になる。
    expect(LATEST_FN_CODE, "EXCEPTION で握りつぶしていません").toMatch(
      /EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i,
    );
    const idx = LATEST_FN_CODE.search(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i);
    expect(
      LATEST_FN_CODE.slice(idx, idx + 300),
      "例外を捕まえたあと RETURN NEW していません（INSERT が失敗します）",
    ).toMatch(/RETURN NEW/);
    // vault が未設定でも同じく素通りすること
    expect(LATEST_FN_CODE, "vault 未設定時に素通りしていません").toMatch(
      /IF v_base IS NULL OR v_key IS NULL THEN[\s\S]{0,300}RETURN NEW/,
    );
  });

  it("🔴 トリガーが送る認可ヘッダを、Edge Function が受け付ける", () => {
    // ── 2026-08-12 に本番で踏んだ ────────────────────────────────────
    // 最初の版は Authorization: Bearer <vault の service_role キー> で叩いていた。
    // 本番の実測は **403 Forbidden**。通知は1件も飛ばず、しかもトリガーは
    // EXCEPTION を握りつぶすので **メッセージの INSERT は成功し、どこにもエラーが出ない**。
    //
    // 原因: _shared/auth.ts の verifyCaller は
    //   token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    // と**文字列の完全一致**で見る。vault のキーは「このプロジェクトの正規の
    // service_role キー」ではあったが、**ランタイムの環境変数と同じ文字列ではなかった**。
    // 「有効なキーである」ことと「その環境変数と一致する」ことは別。
    //
    // このプロジェクトで pg_net から叩いている既存の cron は**全部 x-cron-secret**。
    // Bearer 経路は一度も通ったことがなかった。両端が噛み合っているかを見る。
    expect(LATEST_FN_CODE, "トリガーが x-cron-secret を送っていません").toMatch(/'x-cron-secret'/);
    expect(FUNC_CODE, "Edge Function が x-cron-secret を見ていません").toMatch(
      /x-cron-secret[\s\S]{0,200}CRON_SECRET|CRON_SECRET[\s\S]{0,200}x-cron-secret/,
    );

    // 🔴 service_role キーをトリガーに持たせない。
    //    効かないうえに、漏れたときの被害が「RLS 全素通りの鍵」と
    //    「この関数1本を呼べる権利」とでは桁が違う。
    expect(
      /service_role_key/.test(LATEST_FN_CODE),
      "トリガーが service_role キーを読んでいます。verifyCaller は環境変数との完全一致で判定するため効きません（本番で 403 でした）。x-cron-secret を使ってください。",
    ).toBe(false);
    expect(
      /Authorization/i.test(LATEST_FN_CODE),
      "トリガーが Authorization ヘッダを送っています。x-cron-secret を使ってください。",
    ).toBe(false);

    // verifyCaller の判定が「完全一致」のままであることも押さえる。
    // ここが緩められたら上のコメントの前提が変わる。
    expect(SHARED_AUTH, "verifyCaller の service_role 判定が変わっています").toMatch(
      /token === serviceKey/,
    );
  });

  it("🔴 呼び先の URL に project ref を焼き込まない", () => {
    // 直書きすると、兄弟アプリがこのマイグレーションをコピーした瞬間、
    // そのジムの通知が**ジムボードのプロジェクト**に飛ぶ。
    // 既に email_queue_* で実際に起きている（CLAUDE.md）。
    expect(MIGRATION_CODE).not.toMatch(/[a-z]{20}\.supabase\.co/);
    expect(LATEST_FN_CODE, "URL を vault から読んでいません").toMatch(
      /vault\.decrypted_secrets[\s\S]{0,200}project_functions_url/,
    );
  });

  it("🔴 新しいマイグレーションが project ref を直書きしていない", () => {
    // 既存の6件は過去の負債として明示的に許す。**これ以上増やさない**のが目的。
    //
    // ⚠️ 3件は**ジムボード以外の ref**（別プロジェクト）を向いている。
    //    まさにこのテストが防ごうとしている形が、既にリポジトリの中にある:
    //      gvgrqaigffxtkvckjfur … 20260507051909
    //      clsvdhovzqrkojvkvekw … 20260515045646 / 20260515071746
    //      rrbfwitprzuevzytykrq … 20260625054831 / 20260708062324 / 20260709031741（自分）
    //    直すのは別件（動いているものを止めうるため）。ここでは増殖を止める。
    const KNOWN = new Set([
      "20260507051909_949476c4-d705-456b-aecc-bcf06a067bcd.sql",
      "20260515045646_f677514e-36a7-473f-83a0-d81dc398293f.sql",
      "20260515071746_36cf3846-dcd2-451e-b1ae-a95323a8988c.sql",
      "20260625054831_4048d9df-4dd0-4fad-aad6-8da31f3e52cb.sql",
      "20260708062324_f044ca75-621e-4204-82e8-f80b36ce0b1d.sql",
      "20260709031741_47e71a03-c3cf-40b3-a253-fd41afe50432.sql",
    ]);
    const offenders = readdirSync(MIGRATION_DIR)
      .filter((f) => f.endsWith(".sql") && !KNOWN.has(f))
      .filter((f) => /[a-z0-9]{20}\.supabase\.co/.test(readFileSync(`${MIGRATION_DIR}/${f}`, "utf8")));
    expect(
      offenders,
      "マイグレーションに Supabase の project ref を直書きしています。vault から読んでください。",
    ).toEqual([]);
  });
});

describe("notify-new-message Edge Function", () => {
  it("🔴 誰でも叩ける状態になっていない", () => {
    // verify_jwt=false なので、関数の中で必ず絞る。
    expect(CONFIG, "config.toml に verify_jwt の宣言がありません").toMatch(
      /\[functions\.notify-new-message\][\s\S]{0,120}verify_jwt = false/,
    );
    expect(FUNC_CODE, "呼び出し元を検証していません").toMatch(/verifyCaller\(req\)/);
    expect(FUNC_CODE, "service_role / CRON_SECRET 以外を弾いていません").toMatch(
      /isServiceRole[\s\S]{0,120}Forbidden/,
    );
  });

  it("🔴 通知の中身を呼び出し元から受け取らない", () => {
    // タイトルや本文を受け取ると、この入り口を叩ける相手が任意の通知を作れてしまう。
    // message_id だけ受け取り、実物を service_role で読み直す。
    expect(FUNC_CODE, "message_id を受け取っていません").toMatch(/message_id/);
    expect(FUNC_CODE, "メッセージ本体を DB から読み直していません").toMatch(
      /from\("messages"\)[\s\S]{0,200}eq\("id", message_id\)/,
    );
    // ⚠️ 見るのは分割代入の**左辺**。`await req.json()` から後ろだけを窓にすると、
    //    `const { message_id, title, body } = await req.json()` を見逃す
    //    （実際に変異検証で素通りした）。
    const destructure = FUNC_CODE.match(/const\s*\{([^}]*)\}\s*=\s*await req\.json\(\)/);
    expect(destructure, "req.json() の分割代入が見つかりません").toBeTruthy();
    const taken = destructure![1]
      .split(",")
      .map((s) => s.split(":")[0].trim())
      .filter(Boolean);
    expect(
      taken,
      `リクエストから ${taken.join(" / ")} を受け取っています。message_id 以外を受け取ると、` +
        `この入り口を叩ける相手が任意の内容の通知を作れます。`,
    ).toEqual(["message_id"]);
  });

  it("🔴 verify_jwt が明記されていて、デプロイ経路が書き残されている", () => {
    // **DBトリガーが呼ぶ関数は、誰も手で deploy しない。**
    // 2026-08-12 に実際にその状態を作った。クライアント側の送信を先に外したのに
    // 関数が本番に無く、**通知が数時間まるごと止まった**（エラーもどこにも出ない）。
    //
    // ── デプロイ経路は CI ではない ───────────────────────────────
    // deploy-functions.yml に載せて解決したつもりでいたが、あのワークフローは
    // **18回の実行すべてで skipped、しかも全部 success** だった（初回からずっと）。
    // さらにジムボードの Supabase は Lovable Cloud の持ち物なので、
    // `SUPABASE_ACCESS_TOKEN` を発行する手段がそもそも無い。ので削除した。
    //
    // 実際の経路は **Lovable のエージェントに deploy を依頼する**こと。
    // GitHub 同期でファイルが届いただけでは本番に反映されない（実測）。
    // 手順と確認方法（pg_net で 404 かどうかを見る）は mem/ops/edge-function-deploy.md。
    expect(CONFIG, "config.toml に verify_jwt の宣言がありません").toMatch(
      /\[functions\.notify-new-message\][\s\S]{0,200}verify_jwt = false/,
    );

    const DOC = readFileSync("mem/ops/edge-function-deploy.md", "utf8");
    expect(DOC, "デプロイ手順に notify-new-message の記載がありません").toContain(
      "notify-new-message",
    );
    expect(DOC, "404 での確認方法が書かれていません").toMatch(/404/);

    // 🔴 「緑なのにデプロイしていない」ワークフローを戻さない。
    expect(
      existsSync(".github/workflows/deploy-functions.yml"),
      "deploy-functions.yml が戻っています。18回すべて skipped のまま success でした。" +
        "戻すなら edgeFunctionProjectRef.test.ts のガードを満たすこと。",
    ).toBe(false);
  });

  it("🔴 二重に鳴らさない（冪等キー）", () => {
    expect(FUNC_CODE).toMatch(/notification_dedupe/);
    expect(FUNC_CODE, "冪等キーがメッセージ単位になっていません").toMatch(
      /new-message:\$\{message\.id\}/,
    );
    expect(FUNC_CODE, "送信前に既送をチェックしていません").toMatch(/already_sent/);
  });

  it("送信に失敗したら冪等キーを戻す", () => {
    // 戻さないと「一度失敗したメッセージは二度と通知できない」状態になる。
    const idx = FUNC_CODE.indexOf("if (pushErr)");
    expect(idx, "プッシュ失敗の分岐がありません").toBeGreaterThan(-1);
    expect(
      FUNC_CODE.slice(idx, idx + 500),
      "失敗しても冪等キーを消していません（そのメッセージは二度と通知できなくなります）",
    ).toMatch(/from\("notification_dedupe"\)[\s\S]{0,40}\.delete\(\)/);
  });
});
