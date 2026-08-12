import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

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
const MIGRATION_FILE = "20260811010000_message_notification_server_side.sql";
const MIGRATION = readFileSync(`${MIGRATION_DIR}/${MIGRATION_FILE}`, "utf8");

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

describe("クライアントは通知を投げない", () => {
  it("コメント除去が空振りしていない", () => {
    expect(HOOK_CODE).toContain("sendMessage");
    expect(FUNC_CODE).toContain("Deno.serve");
    expect(MIGRATION_CODE).toContain("CREATE TRIGGER");
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
    expect(MIGRATION_CODE, "EXCEPTION で握りつぶしていません").toMatch(
      /EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i,
    );
    const idx = MIGRATION_CODE.search(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i);
    expect(
      MIGRATION_CODE.slice(idx, idx + 300),
      "例外を捕まえたあと RETURN NEW していません（INSERT が失敗します）",
    ).toMatch(/RETURN NEW/);
    // vault が未設定でも同じく素通りすること
    expect(MIGRATION_CODE, "vault 未設定時に素通りしていません").toMatch(
      /IF v_base IS NULL OR v_key IS NULL THEN[\s\S]{0,300}RETURN NEW/,
    );
  });

  it("🔴 呼び先の URL に project ref を焼き込まない", () => {
    // 直書きすると、兄弟アプリがこのマイグレーションをコピーした瞬間、
    // そのジムの通知が**ジムボードのプロジェクト**に飛ぶ。
    // 既に email_queue_* で実際に起きている（CLAUDE.md）。
    expect(MIGRATION_CODE).not.toMatch(/[a-z]{20}\.supabase\.co/);
    expect(MIGRATION_CODE, "URL を vault から読んでいません").toMatch(
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

  it("🔴 デプロイ経路に載っている", () => {
    // **DBトリガーが呼ぶ関数は、誰も手で deploy しない。**
    // Lovable の Publish は config.toml 未記載の関数を面倒みるが、この関数は
    // verify_jwt=false を明記してあるので deploy-functions.yml の担当になる。
    // ここに書き忘れると「トリガーは動くのに 404 で通知だけ飛ばない」。
    //
    // 2026-08-12 に実際にその状態を作った。クライアント側の送信を先に外したので、
    // **本番の通知が数時間まるごと止まった**（エラーもどこにも出ない）。
    const deploy = readFileSync(".github/workflows/deploy-functions.yml", "utf8");
    expect(deploy, "paths に notify-new-message がありません（push で起動しない）").toMatch(
      /paths:[\s\S]{0,600}supabase\/functions\/notify-new-message\/\*\*/,
    );
    expect(deploy, "deploy コマンドに notify-new-message がありません").toMatch(
      /supabase functions deploy notify-new-message --project-ref/,
    );

    // 🔴 トークンが無いときに「スキップして緑」に戻さない。
    //    #13〜#18 の6回すべてが skipped のまま success で終わっており、
    //    **このワークフローは一度もデプロイしていなかった**。
    expect(
      /has_token/.test(deploy),
      "トークンが無いときにスキップする作りに戻っています。起動したのにデプロイしない、は失敗にしてください。",
    ).toBe(false);
    expect(deploy, "トークンが無いときに落としていません").toMatch(
      /SUPABASE_ACCESS_TOKEN[\s\S]{0,400}::error::[\s\S]{0,400}exit 1/,
    );

    // 🔴 デプロイの成功を信じず、実物が 404 でないことを確かめる。
    expect(deploy, "デプロイ後の到達確認がありません").toMatch(/Verify functions are actually reachable/);
    expect(deploy, "404 判定になっていません").toMatch(/"404"/);
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
