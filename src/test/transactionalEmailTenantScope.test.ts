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
  const notif = readFileSync("src/lib/bookingNotification.ts", "utf8");
  const hooks = readFileSync("src/hooks/useBookings.ts", "utf8");

  const invocations = [
    { file: "bookingNotification.ts", src: notif, template: "new-booking-notification", recipient: "_resolve_trainer_", key: "trainerUserId" },
    { file: "bookingNotification.ts", src: notif, template: "booking-confirmation", recipient: null, key: "resolveUserId" },
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
    expect(notif).toMatch(/resolveUserId: customerUserId/);
    expect(hooks).toMatch(/resolveUserId: booking\.user_id/);
  });

  it("生のメールアドレスを渡すのは、自分の予約をする顧客だけ", () => {
    // CustomerBooking は user.email（＝呼び出し元自身）を渡す。
    // TrainerSchedule は渡さない（_resolve_user_ に落ちる）。
    const customer = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
    const trainer = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
    // 引数に t("…") が入るので `[^)]*` では途中の `)` で切れる。範囲を限って読む。
    //
    // ⚠️ 2026-08-20 に末尾へ gymNote（メールに足す店からの案内）を足したので、
    //    どちらも「メールアドレスの引数の直後がカンマ」になった。見ているのは
    //    **メールアドレスの位置に何が入っているか**であって、引数の個数ではない。
    expect(customer).toMatch(/sendBookingNotifications\([\s\S]{0,300}?user\.id,\s*user\.email\s*,/);
    // トレーナーの代理予約は**メールの位置に undefined** を渡す（_resolve_user_ に落ちる）。
    // ここに proxyClient のメールが入ると、店が顧客のアドレスを直接指定できてしまう。
    expect(trainer).toMatch(/sendBookingNotifications\([\s\S]{0,300}?proxyBookingType,\s*proxyClient,\s*undefined\s*,/);
    // 念のため逆側も固定する: トレーナー側に「生のメールらしき引数」が現れていないこと。
    expect(trainer).not.toMatch(/sendBookingNotifications\([\s\S]{0,300}?\.email\b/);
  });
});
