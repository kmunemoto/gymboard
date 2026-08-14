import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canSendFeedback, FEEDBACK_MAX_LEN } from "@/lib/operatorFeedback";

// **運営への要望（operator_feedback）の不変条件。**
//
// この機能は「店側が INSERT → DB トリガーが既存のメールキューに積む → 運営に届く」
// だけで成立している。壊れ方はどれも静かで、画面は緑のまま届かなくなる:
//
//   - 宛先が brand.ts の SUPPORT_EMAIL とずれる（フォーク時に片方だけ直す）
//   - トリガーの例外が INSERT ごと落とす（キュー障害で「要望が送れない」に化ける）
//   - SELECT ポリシーが緩んで、他人の要望（人間関係の話が書かれうる）が読める
//   - enqueue_email を authenticated に GRANT し直す（任意宛先へ任意本文を送れる穴）
//
// なのでマイグレーションの**形**をここで見張る。

const MIGRATION = "supabase/migrations/20260814010000_operator_feedback.sql";
const sql = readFileSync(MIGRATION, "utf8");
const brand = readFileSync("src/lib/brand.ts", "utf8");

/** CREATE POLICY 名前 ... ; の1文を取り出す */
const policyOf = (name: string): string => {
  const m = sql.match(new RegExp(`CREATE POLICY ${name}[\\s\\S]*?;`));
  expect(m, `${MIGRATION} に CREATE POLICY ${name} がありません`).not.toBeNull();
  return m![0];
};

describe("canSendFeedback（クライアント側の事前チェック）", () => {
  it("空・空白だけは送れない", () => {
    expect(canSendFeedback("")).toBe(false);
    expect(canSendFeedback("   \n\t ")).toBe(false);
  });

  it("1文字から上限までは送れる", () => {
    expect(canSendFeedback("あ")).toBe(true);
    expect(canSendFeedback("x".repeat(FEEDBACK_MAX_LEN))).toBe(true);
  });

  it("上限を超えたら送れない", () => {
    expect(canSendFeedback("x".repeat(FEEDBACK_MAX_LEN + 1))).toBe(false);
  });

  it("前後の空白は数えない（trim 後で判定する）", () => {
    // DB の CHECK も btrim 後の長さで見るので、ここが違うと
    // 「画面では送れたのに DB で弾かれる」が起きる。
    expect(canSendFeedback("  " + "x".repeat(FEEDBACK_MAX_LEN) + "  ")).toBe(true);
  });

  it("上限は DB の CHECK と同じ値", () => {
    const m = sql.match(/BETWEEN 1 AND (\d+)/);
    expect(m, "マイグレーションに長さ CHECK がありません").not.toBeNull();
    expect(Number(m![1])).toBe(FEEDBACK_MAX_LEN);
  });
});

describe("operator_feedback のマイグレーション", () => {
  it("RLS が有効", () => {
    expect(sql).toMatch(/ALTER TABLE public\.operator_feedback ENABLE ROW LEVEL SECURITY/);
  });

  it("RESTRICTIVE なテナント境界がある", () => {
    const p = policyOf("tenant_isolation");
    expect(p).toMatch(/AS RESTRICTIVE/);
    expect(p).toMatch(/get_my_tenant_id/);
  });

  it("INSERT は本人かつ店側（trainer ロール）だけ", () => {
    const p = policyOf("operator_feedback_insert");
    expect(p).toMatch(/user_id = auth\.uid\(\)/);
    expect(p).toMatch(/has_role\(auth\.uid\(\), 'trainer'/);
  });

  it("SELECT は自分が送った分だけ。店全体には広げない", () => {
    // 要望にはスタッフ間の人間関係の話も書かれうる。
    // trainer 全員が読める（has_role）にすると、それが同僚に見える。
    const p = policyOf("operator_feedback_select");
    expect(p).toMatch(/user_id = auth\.uid\(\)/);
    expect(p).not.toMatch(/has_role|shares_tenant_with_me|is_tenant_member/);
  });

  it("送った要望は書き換えも取り消しもできない（GRANT ごと剥がす）", () => {
    expect(sql).toMatch(/REVOKE UPDATE, DELETE ON public\.operator_feedback FROM authenticated, anon/);
    // UPDATE/DELETE のポリシーを作っていないこと
    expect(sql).not.toMatch(/CREATE POLICY \w+ ON public\.operator_feedback\s+FOR (UPDATE|DELETE)/);
  });

  it("AFTER INSERT トリガーが既存の transactional_emails キューに積む", () => {
    expect(sql).toMatch(/AFTER INSERT ON public\.operator_feedback/);
    expect(sql).toMatch(/enqueue_email\('transactional_emails'/);
  });

  it("メールに失敗しても INSERT は成功する（例外を握る）", () => {
    // ここが無いと、キュー障害＝「要望が送れない」に化ける。
    // 行が正式な記録なので、保存だけは必ず通す。
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS/);
    expect(sql).toMatch(/RAISE WARNING/);
  });

  it("宛先が brand.ts の SUPPORT_EMAIL と一致している", () => {
    // DB は brand.ts を読めないので直書きしている。フォークで片方だけ
    // 直すと、要望が旧アドレス（＝ジムボードの運営）に届き続ける。
    const inSql = sql.match(/v_to\s+CONSTANT TEXT := '([^']+)'/);
    const inBrand = brand.match(/SUPPORT_EMAIL = "([^"]+)"/);
    expect(inSql, "マイグレーションに宛先がありません").not.toBeNull();
    expect(inBrand, "brand.ts に SUPPORT_EMAIL がありません").not.toBeNull();
    expect(inSql![1]).toBe(inBrand![1]);
  });

  it("差出ドメインが send-transactional-email と一致している", () => {
    // 認証されていないドメインから送るとメールプロバイダ側で落ちる。
    const fn = readFileSync("supabase/functions/send-transactional-email/index.ts", "utf8");
    const inFn = fn.match(/const SENDER_DOMAIN = "([^"]+)"/);
    const inSql = sql.match(/v_domain CONSTANT TEXT := '([^']+)'/);
    expect(inFn).not.toBeNull();
    expect(inSql).not.toBeNull();
    expect(inSql![1]).toBe(inFn![1]);
  });

  it("unsubscribe_token を必ず付けている", () => {
    // 送信APIは transactional に unsubscribe_token を**必須**にしている。
    // 無くてもキューには載るので、**配送だけが 400 missing_unsubscribe で
    // 落ち続けて DLQ 行き**＝画面は成功、メールは届かない（本番検証で実際に踏んだ）。
    expect(sql).toMatch(/'unsubscribe_token', v_unsub/);
    // トークンは宛先ごとに1つ（email_unsubscribe_tokens）。無ければ作る。
    expect(sql).toMatch(/FROM public\.email_unsubscribe_tokens WHERE email = lower\(v_to\)/);
    expect(sql).toMatch(/ON CONFLICT \(email\) DO NOTHING/);
  });

  it("自由入力の本文を HTML に流す前にエスケープしている", () => {
    expect(sql).toMatch(/'&', '&amp;'/);
    expect(sql).toMatch(/'<', '&lt;'/);
    expect(sql).toMatch(/'>', '&gt;'/);
  });

  it("1時間あたりの通知メールに上限がある（行の保存は止めない）", () => {
    expect(sql).toMatch(/interval '1 hour'/);
    // 上限に達したときは RETURN NEW（＝保存は続行）であること
    expect(sql).toMatch(/IF v_recent > \d+ THEN\s*\n\s*RETURN NEW;/);
  });

  it("トリガー関数は SECURITY DEFINER + search_path 固定 + クライアントから呼べない", () => {
    // ⚠️ ファイル全体を toMatch すると**コメント中の同語**に当たって、
    // 本体から外しても緑のままになる（変異検証で実際にすり抜けた）。
    // 関数定義のヘッダ（CREATE 〜 AS $$）だけを見る。
    const header = sql.match(
      /CREATE OR REPLACE FUNCTION public\.notify_operator_feedback\(\)[\s\S]*?AS \$\$/,
    );
    expect(header, "notify_operator_feedback の定義がありません").not.toBeNull();
    expect(header![0]).toMatch(/SECURITY DEFINER/);
    expect(header![0]).toMatch(/SET search_path = public/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.notify_operator_feedback\(\) FROM PUBLIC, anon, authenticated/,
    );
  });

  it("enqueue_email を authenticated に GRANT し直していない", () => {
    // 20260805000000 で剥がした穴を、この機能のために開け直さないこと。
    // SECURITY DEFINER のトリガー関数から呼ぶので GRANT は不要。
    expect(sql).not.toMatch(/GRANT[^;]*enqueue_email[^;]*(authenticated|anon)/i);
  });
});

describe("画面への配線", () => {
  const settings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");
  const component = readFileSync("src/components/trainer/OperatorFeedback.tsx", "utf8");

  it("店側の設定画面に載っている", () => {
    expect(settings).toMatch(/<OperatorFeedback/);
  });

  it("お客様側の設定には載せない", () => {
    // 要望窓口は店側（有償契約者）向け。お客様の声はジム経由で聞く。
    const customer = readFileSync("src/components/customer/CustomerSettings.tsx", "utf8");
    expect(customer).not.toMatch(/OperatorFeedback/);
  });

  it("送信ボタンは canSendFeedback で無効化される", () => {
    // これが無いと空文字や 2001 文字を投げて DB エラー→「送信に失敗しました」
    // という分かりにくい体験になる。
    expect(component).toMatch(/disabled=\{[^}]*!canSendFeedback\(body\)/);
  });

  it("textarea に DB と同じ上限が付いている", () => {
    expect(component).toMatch(/maxLength=\{FEEDBACK_MAX_LEN\}/);
  });

  it("本文を HTML として描画しない", () => {
    expect(component).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
