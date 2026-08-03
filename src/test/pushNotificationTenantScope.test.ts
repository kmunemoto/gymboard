import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// send-push-notification の宛先制限を見張るテスト。
//
// ── 何が起きていたか（2026-08-03 に発見） ──────────────────────────
// 認証済み経路の権限チェックがこう書かれていた:
//
//   const isTrainer = caller.userId ? await hasRole(caller.userId, "trainer") : false;
//   if (!isTrainer) {
//     ...宛先の検証はすべてこの中...
//   }
//
// **trainer なら中身が丸ごとスキップされる。** ところが `has_role` が見る
// `user_roles` に `tenant_id` は無く、trainer はテナント横断のグローバル権限。
// つまり「どのジムのトレーナーでも、他ジムの顧客に、任意の title/body のプッシュを
// 無制限に送れる」状態だった。「店舗からのお知らせ」を騙るフィッシング、
// 本物の通知を押し流す洪水、いずれにも使える。
//
// 同じファイルの waitlist 経路は tenant_id を確認していたので、
// **同一ファイル内で不整合**でもあった。両方を tenant_members ベースに揃えた。
//
// ── なぜ本文を読む形のテストなのか ──────────────────────────────
// `supabase/functions/` は vitest の include（`src/**`）の外で、Deno の
// リモート import を含むためそのままでは実行もできない。
// このリポジトリの既存の流儀（edgeFunctionProjectRef / sameDayCancelWording 等）に
// 合わせて、ソースの形を機械的に見張る。

const PUSH_FN = "supabase/functions/send-push-notification/index.ts";
const FUNCTIONS_DIR = "supabase/functions";

const source = readFileSync(PUSH_FN, "utf8");

/** 説明コメントに書いた語で誤検知しないよう、コメント行を落としてから探す */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const code = stripComments(source);

describe("send-push-notification: 宛先はテナントで絞る", () => {
  it("hasRole（user_roles ベース）を権限判定に使っていない", () => {
    // user_roles にテナントの概念が無いので、ここでの hasRole は
    // 「誰にでも送れる」と同義になる。import ごと消してある。
    expect(code).not.toMatch(/\bhasRole\b/);
  });

  it("trainer を素通しさせる分岐が復活していない", () => {
    // 元のバグそのものの形。`isTrainer` という判定自体をこのファイルから無くした。
    expect(code).not.toMatch(/\bisTrainer\b/);
  });

  it("tenant_members から所属を引くヘルパーがある", () => {
    expect(code).toMatch(/async function loadTenantMemberships\(/);
    expect(code).toMatch(/\.from\("tenant_members"\)/);
    expect(code).toMatch(/\.select\("user_id, tenant_id, status"\)/);
  });

  it("tenant_id が NULL の行を捨てている（null 同士の一致を作らない）", () => {
    // 拾うと「所属テナント未設定の人どうし」が同じテナント扱いになる。
    // 2026-08-01 のフォーク取り込みで踏んだ null === null の再来を防ぐ。
    expect(code).toMatch(/if \(!row\.tenant_id\) continue;/);
  });

  it("呼び出し元の判定は active な所属だけを見る", () => {
    // 退会者に送信権を残さない。宛先側は status を問わない（退会会員の予約を
    // トレーナーがキャンセルしたときの通知を落とさないため）。
    expect(code).toMatch(/function activeTenantIds\(/);
    expect(code).toMatch(/\.filter\(\(m\) => m\.active\)/);
    expect(code).toMatch(/const callerTenants = activeTenantIds\(memberships, callerId\)/);
  });

  it("認証済み経路が loadTenantMemberships を通っている", () => {
    // 「自分自身 or 同じテナント」以外は 403 にする本体。
    expect(code).toMatch(
      /const memberships = await loadTenantMemberships\(adminClient, \[callerId, \.\.\.otherIds\]\)/,
    );
  });

  it("どのテナントにも active 所属が無い呼び出し元は他人に送れない（fail-close）", () => {
    expect(code).toMatch(/if \(callerTenants\.size === 0\)/);
  });

  it("所属が引けない宛先は拒否する（fail-close）", () => {
    expect(code).toMatch(
      /if \(!targetMemberships \|\| targetMemberships\.length === 0\) return true;/,
    );
  });

  it("waitlist 経路もテナント所属を確認している", () => {
    expect(code).toMatch(
      /let allowed = activeTenantIds\(memberships, caller\.userId\)\.has\(tenant_id\);/,
    );
  });

  it("宛先の件数に上限がある", () => {
    expect(code).toMatch(/const MAX_PUSH_TARGETS = \d+;/);
    expect(code).toMatch(/> MAX_PUSH_TARGETS/);
  });

  it("プロトコル相対URL（//evil.example）を通す抜け道が無い", () => {
    // "//evil.example" も "/" 始まりだが、ブラウザは**別オリジン**に解決する。
    // 通知を開いた先が外部サイトになる（AuthCallback で sanitizeAuthNext が
    // 塞いだのと同じ形の穴）。2026-08-03、ピラボードが先に直していた。
    expect(code).toMatch(/u\.startsWith\("\/"\) && !u\.startsWith\("\/\/"\)/);
  });

  it("service_role 以外は userId を必ず持つことを確認している", () => {
    // verifyCaller は service_role のとき { userId: null, isServiceRole: true } を返す。
    // `if (!caller)` だけの判定はこれを通してしまう（signup-trainer は `!caller?.userId`）。
    expect(code).toMatch(/if \(!caller\.userId\) \{/);
  });
});

describe("通知を開く側もプロトコル相対URLを弾く", () => {
  // **送る側（isAllowedUrl）を直しても、開く側は塞がらない。**
  // 通知の payload は send-push-notification を通らない経路でも届く
  // （別の送信元、端末に残っていた古い通知）。両方に同じガードが要る。
  //
  // 2026-08-03、上流が送る側だけ直した直後に、ゴルフボード（フォーク）が
  // 開く側の取り残しを見つけた。逆方向の3件目。
  const NAV = "src/lib/pushNotifications.ts";
  const navSource = readFileSync(NAV, "utf8");

  it("navigateFromData が // を弾いている", () => {
    expect(navSource).toMatch(
      /url\.startsWith\("\/"\)\s*&&\s*!url\.startsWith\("\/\/"\)/,
    );
  });

  it("素の startsWith(\"/\") だけの遷移が残っていない", () => {
    // `if (url && url.startsWith("/")) window.location.assign(url)` の形が
    // どこかに復活していないか。行単位で見る。
    const offenders = navSource
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .filter((line) => /location\.(assign|href)/.test(line))
      .filter((line) => !/!\w+\.startsWith\("\/\/"\)/.test(line));
    expect(
      offenders.map((l) => l.trim().slice(0, 90)),
      "遷移の直前に // ガードが無い行があります",
    ).toEqual([]);
  });
});

describe("Edge Function で supabase-js のビルダーに .catch を生やさない", () => {
  // **鍼灸ボード（フォーク）が先に作った検査を取り込んだもの。**
  // 向こうが 2026-08-03 の本番検証で実際に踏んだ:
  //
  //   await admin.rpc("purge_login_codes").catch(() => {});
  //
  // `rpc()` / `from()` が返すのは Promise ではなく PostgrestFilterBuilder。
  // thenable ではあるが **`.catch` を持たない**ので、これは実行時に
  // `admin.rpc(...).catch is not a function` の TypeError になり 500 で落ちる。
  //
  // 悪いのは壊れ方。向こうでは Edge Function の**後始末の行**だったので、
  // 本体の処理は終わっているのにレスポンスだけ 500 になった。
  // Deno のコードは tsc にもユニットテストにも載らないので、
  // **本番に HTTP を投げるまで誰も気づけない。** try/catch で囲むこと。
  //
  // ジムボードは取り込み時点で該当0件（全 Edge Function を走査して確認）。
  //
  // ⚠️ このファイル名は push 用だが、この describe は**リポジトリ全体**を見る。
  //    配布単位を増やさないため、既存の全走査 describe（下）と同じ場所に置いている。
  const entries = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_shared")
    .map((e) => `${FUNCTIONS_DIR}/${e.name}/index.ts`);

  // `(?<!Array)` と「引数が文字列リテラル」の2つで Array.from(bytes) を除く。
  // supabase-js の .from() / .rpc() は必ずテーブル名・関数名の文字列を取る。
  // （鍼灸ボード版は `\.(?:rpc|from)\(` だけだったので、Array.from を含む行が
  //   将来 .catch と同じ文に来ると誤検知する。こちらで絞った）
  const BUILDER_CATCH = /(?<!Array)\.(?:rpc|from)\(\s*["'`][\s\S]{0,400}?\.catch\(/;

  it("対象の Edge Function を1つ以上見つけられている", () => {
    expect(entries.length).toBeGreaterThan(5);
  });

  for (const file of entries) {
    it(`${file} が rpc()/from() に .catch を付けていない`, () => {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        return; // index.ts を持たない関数はスキップ
      }
      // 1文ずつ見る。ファイル全体を1つの正規表現に掛けると、
      // 無関係な `.catch`（req.json().catch など）まで巻き込む。
      const statements = stripComments(text).split(";");
      const offenders = statements.filter((st) => BUILDER_CATCH.test(st));
      expect(
        offenders.map((o) => o.trim().slice(0, 100)),
        "PostgrestFilterBuilder に .catch は無い。try/catch で囲むこと",
      ).toEqual([]);
    });
  }
});

describe("Edge Function から auth.uid() 依存の RPC を呼ばない", () => {
  // `get_my_tenant_id()` / `shares_tenant_with_me()` は中身が `auth.uid()` 依存。
  // Edge Function の service_role クライアントから呼ぶと **常に NULL / false**
  // （error も出ない）。テナント検証に使うと黙って素通り or 全拒否になる。
  // Edge Function では tenant_members を直接引くこと。
  const AUTH_UID_RPCS = ["get_my_tenant_id", "shares_tenant_with_me"];

  const entries = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_shared")
    .map((e) => `${FUNCTIONS_DIR}/${e.name}/index.ts`);

  it("対象の Edge Function を1つ以上見つけられている", () => {
    // ディレクトリ構成が変わってテストが空振りするのを防ぐ
    expect(entries.length).toBeGreaterThan(5);
  });

  for (const file of entries) {
    it(`${file} が auth.uid() 依存の RPC を呼んでいない`, () => {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        return; // index.ts を持たない関数はスキップ
      }
      const body = stripComments(text);
      for (const rpc of AUTH_UID_RPCS) {
        expect(body).not.toMatch(new RegExp(`rpc\\(\\s*["'\`]${rpc}["'\`]`));
      }
    });
  }
});
