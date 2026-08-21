import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// send-transactional-email の宛先制限を見張るテスト。
//
// ── 何が起きていたか（2026-08-04 に修正） ──────────────────────────
// 認証済み経路の権限チェックがこう書かれていた:
//
//   const callerIsTrainer = caller.userId ? await hasRole(caller.userId, 'trainer') : false
//   if (!caller.isServiceRole && !callerIsTrainer) {
//     ...テンプレート制限も宛先制限も、すべてこの中...
//   }
//
// **trainer なら中身が丸ごとスキップされる。** ところが `has_role` が見る
// `user_roles` に tenant_id は無く、しかも `trainer` は新規登録画面の
// 「トレーナー」タブから**誰でも自分で取れる**（signup-trainer は意図的に開けてある）。
//
// つまり「トレーナーとして登録する」だけで、
//   - 宛先が自由（recipientEmail に任意のアドレス）
//   - テンプレート8種すべて
//   - _resolve_trainer_ / _resolve_user_ で他人のアドレスに解決させられる
// になっていた。差出人は SPF/DKIM を通した正規ドメイン
// （noreply@notify.kyoto-salute.com）なので、**受信側で弾かれない偽メール**を
// 作れる。悪用されるとドメインの評判が落ち、正規の予約確認メールまで
// 迷惑メール送りになる（復旧に時間がかかる種類の損害）。
//
// send-push-notification の PR #246 とまったく同じ形の穴。
//
// ── 直し方 ──────────────────────────────────────────────
// 「トレーナーかどうか」ではなく「**呼び出し元と宛先が同じジムに属しているか**」で
// 判断する。所属は tenant_members を直接引く。
//
// ── なぜ本文を読む形のテストなのか ──────────────────────────────
// `supabase/functions/` は vitest の include（`src/**`）の外で、Deno の
// リモート import を含むためそのままでは実行もできない。
// 既存の流儀（pushNotificationTenantScope / edgeFunctionProjectRef 等）に合わせ、
// ソースの形を機械的に見張る。

const EMAIL_FN = "supabase/functions/send-transactional-email/index.ts";
const source = readFileSync(EMAIL_FN, "utf8");

/** 説明コメントに書いた語で誤検知しないよう、コメント行を落としてから探す */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const code = stripComments(source);

describe("send-transactional-email: グローバルロールで認可しない", () => {
  it("hasRole を import も呼び出しもしない", () => {
    // `trainer` は誰でも自分で取れるテナント横断ロール。認可の根拠にならない。
    expect(code).not.toMatch(/\bhasRole\b/);
    expect(code).not.toMatch(/from\s+['"]\.\.\/_shared\/auth\.ts['"][\s\S]{0,80}hasRole/);
  });

  it("callerIsTrainer のようなロール変数でゲートを開けない", () => {
    expect(code).not.toMatch(/callerIsTrainer|isTrainer/);
    expect(code).not.toMatch(/has_role/);
  });

  it("所属は tenant_members を直接引く", () => {
    expect(code).toMatch(/from\(['"]tenant_members['"]\)/);
    expect(code).toMatch(/\.eq\(['"]status['"],\s*['"]active['"]\)/);
  });

  it("auth.uid() に依存する RPC を使わない", () => {
    // service_role のクライアントから呼ぶと**エラー無しで** NULL / false が返り、
    // null === null の突き合わせで素通しになる。
    expect(code).not.toMatch(/get_my_tenant_id|shares_tenant_with_me/);
  });
});

describe("send-transactional-email: 認可の中身", () => {
  it("service_role 以外はすべて authorizeClientCall を通る", () => {
    // 「service_role でなければ検証する」——ロールによる例外を作らない。
    expect(code).toMatch(/if\s*\(\s*!caller\.isServiceRole\s*\)\s*\{/);
    expect(code).toMatch(/await\s+authorizeClientCall\(/);
  });

  it("クライアントから呼べるテンプレートは予約系の3種だけ", () => {
    const m = code.match(/CLIENT_ALLOWED_TEMPLATES = new Set\(\[([\s\S]*?)\]\)/);
    expect(m, "CLIENT_ALLOWED_TEMPLATES が見つからない").toBeTruthy();
    const listed = [...m![1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]).sort();
    expect(listed).toEqual([
      "booking-cancellation",
      "booking-confirmation",
      "new-booking-notification",
    ]);
    // 許可リストを**通り抜けられない**こと（false を返して終わり）。
    expect(code).toMatch(/if\s*\(!CLIENT_ALLOWED_TEMPLATES\.has\([\s\S]{0,40}\)\)\s*return false/);
  });

  it("どのジムにも属していない呼び出し元は何も送れない", () => {
    // 「トレーナーとして登録しただけ」の相手がここで止まる。
    expect(code).toMatch(/mine\.length === 0[\s\S]{0,60}return false/);
  });

  it("_resolve_trainer_ の宛先は「自分と同じジムの現役スタッフ」に限る", () => {
    expect(code).toMatch(
      /_resolve_trainer_[\s\S]*?theirs\.some\(\(m\) => m\.isStaff && myTenants\.has\(m\.tenantId\)\)/,
    );
  });

  it("_resolve_user_ は自分自身か、自分がスタッフをしているジムの在籍者だけ", () => {
    const block = code.slice(code.indexOf("_resolve_user_"));
    expect(block).toMatch(/target === caller\.userId[\s\S]{0,40}return true/);
    expect(block).toMatch(/myStaffTenants\.size === 0[\s\S]{0,40}return false/);
    expect(block).toMatch(/theirs\.some\(\(m\) => myStaffTenants\.has\(m\.tenantId\)\)/);
  });

  it("生のメールアドレス指定は自分宛だけ", () => {
    // ここを緩めると、SPF/DKIM を通した正規ドメインから任意の宛先へ送れる
    // ＝フィッシングの踏み台になる。
    expect(code).toMatch(/recipientEmail\.toLowerCase\(\) === callerEmail\.toLowerCase\(\)/);
  });

  it("所属が引けなかったときは送らない（fail-close）", () => {
    // 握りつぶして通すと、DB が一時的に落ちている間だけ誰でも送れる関数になる。
    expect(code).toMatch(/catch\s*\([\s\S]{0,10}\)\s*\{[\s\S]{0,160}ok = false/);
    expect(code).toMatch(/if\s*\(error\)\s*throw error/);
  });

  it("tenant_id が NULL の所属行は突き合わせに使わない", () => {
    // NULL 同士が一致した判定を作らない。
    expect(code).toMatch(/if\s*\(!row\.tenant_id\)\s*continue/);
  });
});

describe("実際に飛んでいる4本が、この規則で通ること", () => {
  // 直したことで**現在の送信が1通も止まらない**ことを、呼び出し元の形で固定する。
  // ここが変わったら、Edge Function 側の規則も見直しが要る。
  // 予約作成の2本はサーバー側送信へ移行済み（2026-08-21、notify-new-booking。
  // service_role 呼び出しなので同ジム検査は通らないが、宛先解決に同じキーが要る）。
  // キャンセルの2本は今もクライアント発＝この認可規則を通る。
  const notif = readFileSync("supabase/functions/notify-new-booking/index.ts", "utf8");
  const hooks = readFileSync("src/hooks/useBookings.ts", "utf8");

  const invocations = [
    { file: "notify-new-booking/index.ts", src: notif, template: "new-booking-notification", recipient: "_resolve_trainer_", key: "trainerUserId" },
    { file: "notify-new-booking/index.ts", src: notif, template: "booking-confirmation", recipient: null, key: "resolveUserId" },
    { file: "useBookings.ts", src: hooks, template: "booking-cancellation", recipient: "_resolve_trainer_", key: "trainerUserId" },
    { file: "useBookings.ts", src: hooks, template: "booking-cancellation", recipient: "_resolve_user_", key: "resolveUserId" },
  ];

  it("使っているテンプレートは3種のうちのどれか", () => {
    const allowed = new Set(["booking-confirmation", "booking-cancellation", "new-booking-notification"]);
    for (const inv of invocations) {
      expect(allowed.has(inv.template), `${inv.file}: ${inv.template}`).toBe(true);
      expect(inv.src).toMatch(new RegExp(`templateName:\\s*"${inv.template}"`));
    }
  });

  it("スタッフ宛は必ず trainerUserId を添えて _resolve_trainer_ で送る", () => {
    // trainerUserId が無いと Edge Function 側が宛先を検証できず 403 になる。
    for (const inv of invocations.filter((i) => i.recipient === "_resolve_trainer_")) {
      expect(inv.src).toMatch(/recipientEmail: "_resolve_trainer_"/);
      expect(inv.src).toMatch(/trainerUserId/);
    }
  });

  it("お客様宛は resolveUserId を添える（ジム側の代理予約もこの経路）", () => {
    // ジム側が代理で予約すると resolveUserId は**呼び出し元ではないお客様**になる。
    // 「自分宛だけ」に絞ると代理予約の確認メールが止まるので、
    // 「自分がスタッフをしているジムの在籍者」まで許している。
    expect(notif).toMatch(/resolveUserId: booking\.user_id/);
    expect(hooks).toMatch(/resolveUserId: booking\.user_id/);
  });

  it("生のメールアドレスは誰も渡さない（宛先解決は必ず Edge Function 側）", () => {
    // 予約作成の送信はサーバー側（notify-new-booking）に一本化され、
    // _resolve_trainer_ / _resolve_user_ しか使わない。クライアント（画面2つ）は
    // 送信自体を持たない。ここに端末発の送信が復活すると、生アドレス直指定の
    // 経路が再び開きうる（bookingNotifyServerSide.test.ts と二重の見張り）。
    const customer = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
    const trainer = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
    expect(customer).not.toContain("sendBookingNotifications");
    expect(trainer).not.toContain("sendBookingNotifications");
    expect(notif).not.toMatch(/recipientEmail: (?!"_resolve_)/);
  });
});
