import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// **`send-line-message` のテナント境界を見張る。**
//
// ── 何が問題だったか（2026-08-04 発見 / 2026-08-05 修正）──────────
//
// ### 1. 「トレーナーである」を認可の根拠にしていた
//
// ```ts
// const isTrainer = caller.userId ? await hasRole(caller.userId, "trainer") : false;
// if (!isTrainer) { /* 検証はすべてこの中 */ }
// ```
//
// `user_roles` に tenant_id は無く、`trainer` は新規登録画面から**誰でも自分で取れる**。
// つまり**トレーナーとして登録するだけで、他ジムのお客様に任意の文面のLINEを送れた。**
//
// send-push-notification（#246）・send-transactional-email（#257）と同じ形。ここが最後。
//
// ### 2. `to: "trainer"` が全テナントへの一斉送信だった
//
// `get_trainer_ids()` は `SELECT user_id FROM user_roles WHERE role='trainer'` で
// **全テナント横断**。1件の体験予約が、無関係な他ジムのトレーナー全員に
// お客様の氏名と日時を配っていた。
//
// **呼び出し元はゼロ**（クライアントは既に自テナント限定ヘルパーに移行済み）だったので、
// 意味論を決め直すのではなく**削除**した。
//
// ── なぜテストで見張るか ────────────────────────────────────
// LINE は現在無効（`LINE_INTEGRATION_ENABLED = false`）なので、
// **壊れていても誰も気づかない。** 復活させたときに穴ごと復活しないよう、ここで止める。

const FN = "supabase/functions/send-line-message/index.ts";
const source = readFileSync(FN, "utf8");

/** 行コメントを落とす（経緯コメントに書いた識別子を実装と誤認しない） */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

describe("send-line-message が『トレーナーである』を認可に使わない", () => {
  it("解析器が実装を拾えている", () => {
    // コメント除去で中身ごと消えて、空文字を検査して緑になるのを防ぐ。
    expect(code).toMatch(/Deno\.serve/);
    expect(code.length).toBeGreaterThan(1000);
  });

  it("hasRole を import も使用もしていない", () => {
    // `trainer` は自由に取れるロールなので、権限の根拠にならない。
    expect(code, `${FN} が hasRole を使っています`).not.toMatch(/\bhasRole\b/);
  });

  it("get_trainer_ids を呼んでいない", () => {
    // 全テナント横断で返るため、宛先の解決に使うと他ジムへ漏れる。
    expect(code, `${FN} が get_trainer_ids を使っています`).not.toMatch(/get_trainer_ids/);
  });

  it("auth.uid() 依存の RPC を使っていない", () => {
    // service_role から呼ぶと **エラー無しで NULL / false** を返し、
    // `null === null` で素通りする。
    expect(code).not.toMatch(/get_my_tenant_id/);
    expect(code).not.toMatch(/shares_tenant_with_me/);
  });

  it("tenant_members を直接引いて判定している", () => {
    expect(code, "テナント所属の判定が tenant_members に基づいていません").toMatch(
      /from\("tenant_members"\)/,
    );
    // status を見ないと、退会済みの所属で通ってしまう。
    expect(code, "active な所属だけに絞っていません").toMatch(/\.eq\("status",\s*"active"\)/);
  });

  it("tenant_id が NULL の行を一致に使わない", () => {
    // NULL 同士が一致したことにすると、所属の無い者同士が同じテナント扱いになる。
    expect(code, "tenant_id が NULL の行を除外していません").toMatch(
      /if\s*\(row\.tenant_id\)|if\s*\(!row\.tenant_id\)/,
    );
  });
});

describe("send-line-message の宛先が絞られている", () => {
  it("`to` の一斉送信を受け付けない", () => {
    // 黙って「宛先なし＝skip」に落とすと気づけないので、明示的に断る。
    expect(code, "`to` を明示的に拒否していません").toMatch(
      /if\s*\(to\s*!==\s*undefined\)[\s\S]{0,400}status:\s*400/,
    );
  });

  it("一斉送信のループが残っていない", () => {
    // 分岐だけ消してループが残っている、を防ぐ。
    expect(code).not.toMatch(/for\s*\(const t of trainerIds\)/);
    expect(code).not.toMatch(/trainerIds/);
  });

  it("生の line_user_id は service_role だけ", () => {
    // LINE ID を直に指定できると、テナントの概念を丸ごと迂回できる。
    const clientBlock = /if\s*\(!caller\.isServiceRole\)\s*\{([\s\S]*?)\n    \}/.exec(code)?.[1];
    expect(clientBlock, "service_role 以外の分岐を見つけられません").toBeTruthy();
    expect(clientBlock, "認証ユーザーに line_user_id を許しています").toMatch(
      /if\s*\(line_user_id\)[\s\S]{0,200}403/,
    );
  });

  it("他人宛ては同一テナントの相手だけ", () => {
    const clientBlock = /if\s*\(!caller\.isServiceRole\)\s*\{([\s\S]*?)\n    \}/.exec(code)?.[1];
    expect(clientBlock).toMatch(/user_id\s*!==\s*caller\.userId/);
    expect(clientBlock, "同一テナントの確認をしていません").toMatch(/sharesTenant\(/);
  });

  it("判定に失敗したら送らない（fail-close）", () => {
    // 例外を握りつぶして「許可」に倒すと、DBが一時的に落ちただけで穴が開く。
    expect(code, "テナント判定の失敗時に送信を許しています").toMatch(
      /catch[\s\S]{0,200}allowed\s*=\s*false/,
    );
  });
});

describe("クライアントの呼び出し口", () => {
  const NOTIFY = "src/lib/lineNotify.ts";
  const notify = readFileSync(NOTIFY, "utf8");

  it("宛先は user_id のみを受け付ける", () => {
    // `userId`（LINE の ID）は Edge Function が読んでおらず、
    // **宛先なしで skip され続けていた**。型から消して同じ渡し方を防ぐ。
    expect(notify, `${NOTIFY} の LineMessageBody に userId が残っています`).not.toMatch(
      /^\s*userId\??:/m,
    );
    expect(notify).toMatch(/user_id:\s*string/);
  });
});
