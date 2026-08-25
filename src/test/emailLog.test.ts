import { readFileSync, readdirSync } from "fs";
import { describe, expect, it } from "vitest";
import { collapseLog, toneOf, LOG_PAGE, type EmailLogRow } from "@/lib/emailLog";

// 通知の送信履歴（2026-08-26）の見張り。
//
// これまで店は「メールが来ていない」と言われても**何も確認できなかった**。
// email_send_log は service_role からしか読めず、どのジムの通知かも持っていなかった。
//
// 🔴 ここで守っている不変条件:
//   1. 送信結果の行に必ず tenant_id が載る（載らないと履歴に出ない）
//   2. tenant_id が NULL の行は誰にも見えない（認証メールの宛先が全スタッフに漏れる）
//   3. 取得は tenant_id で絞る（他ジムの通知が混ざらない）

const MIGRATION = "supabase/migrations/20260826010000_email_log_tenant.sql";
const SEND = "supabase/functions/send-transactional-email/index.ts";
const QUEUE = "supabase/functions/process-email-queue/index.ts";

/** そのファイルの email_send_log への INSERT を、オブジェクト本体ごとに切り出す。 */
const logInserts = (src: string): string[] => {
  const out: string[] = [];
  const lines = src.split("\n");
  lines.forEach((l, i) => {
    if (!l.includes("email_send_log').insert({")) return;
    const block = lines.slice(i, i + 16).join("\n");
    out.push(block.slice(0, block.indexOf("})")));
  });
  return out;
};

describe("migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("最新の migration に含まれている", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain("20260826010000_email_log_tenant.sql");
  });

  it("tenant_id 列を足す", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public\.tenants\(id\)/);
  });

  it("🔴 tenant_id が NULL の行を読めるようにしない", () => {
    // ここを緩めると、全ジムの認証メールの宛先アドレスが全スタッフに見える
    const policy = sql.slice(sql.indexOf('CREATE POLICY "Tenant staff can read own send log"'));
    expect(policy).toMatch(/tenant_id IS NOT NULL/);
    expect(policy).toMatch(/has_tenant_role\(tenant_id, auth\.uid\(\), ARRAY\['owner', 'trainer'\]\)/);
    expect(policy).not.toMatch(/OR tenant_id IS NULL/);
  });

  it("読み取りだけを許す（書き込みは service_role のまま）", () => {
    const policy = sql.slice(sql.indexOf('CREATE POLICY "Tenant staff can read own send log"'));
    expect(policy.slice(0, 200)).toMatch(/FOR SELECT/);
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE)[\s\S]*TO authenticated/);
  });

  it("🔴 複数のジムに在籍している人はバックフィルしない", () => {
    // どちらのジムの通知か決められない。埋めると他ジムのスタッフに見える
    expect(sql).toMatch(/HAVING count\(DISTINCT tm\.tenant_id\) = 1/);
  });
});

describe("🔴 送信結果の行に tenant_id が載る", () => {
  it("send-transactional-email のすべての INSERT に載っている", () => {
    const blocks = logInserts(readFileSync(SEND, "utf8"));
    expect(blocks.length, "INSERT が見つからない（検査が空振りしている）").toBeGreaterThanOrEqual(9);
    blocks.forEach((b, i) => {
      expect(b, `${i + 1}番目の INSERT に tenant_id が無い`).toContain("tenant_id");
    });
  });

  it("process-email-queue のすべての INSERT に載っている", () => {
    // 🔴 sent を書くのはこちら。ここが抜けると「送れたものだけ履歴に出ない」
    const blocks = logInserts(readFileSync(QUEUE, "utf8"));
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    blocks.forEach((b, i) => {
      expect(b, `${i + 1}番目の INSERT に tenant_id が無い`).toContain("tenant_id");
    });
  });

  it("キューへ渡す payload に tenant_id を載せている", () => {
    // process-email-queue は pgmq の payload しか持たない。
    // ここで載せ忘れると sent / failed の行だけ tenant_id が空になる
    const send = readFileSync(SEND, "utf8");
    const enqueue = send.slice(send.indexOf("rpc('enqueue_email'"));
    expect(enqueue.slice(0, 900)).toMatch(/tenant_id: tenantId/);
  });

  it("呼び出し元が渡せなかったときに引き当てる（公開済みの古いアプリ向け）", () => {
    // 端末に配られたクライアントは書き換えられない。補わないと
    // 予約キャンセルの通知だけ履歴に出ない穴が残る
    const send = readFileSync(SEND, "utf8");
    expect(send).toMatch(/templateData\.resolveUserId \|\| templateData\.trainerUserId/);
    expect(send).toMatch(/ids\.length === 1/);
  });
});

describe("送る側が tenantId を渡している", () => {
  const senders = [
    "supabase/functions/notify-new-booking/index.ts",
    "supabase/functions/push-booking-reminder/index.ts",
    "supabase/functions/send-trial-reminders/index.ts",
    "supabase/functions/trial-book/index.ts",
    "supabase/functions/drop-in-book/index.ts",
    "supabase/functions/invite-customer/index.ts",
    "src/hooks/useBookings.ts",
  ];

  it.each(senders)("%s が tenantId を載せている", (path) => {
    const src = readFileSync(path, "utf8");
    // ⚠️ ファイル冒頭の説明にも関数名が出るので、**実際の呼び出し**だけを見る
    const calls = src.split(/invoke(?:Fn)?\(\s*["']send-transactional-email["']/).slice(1);
    expect(calls.length, "呼び出しが見つからない（検査が空振りしている）").toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.slice(0, 600), "この呼び出しに tenantId が無い").toMatch(/tenantId/);
    }
  });
});

describe("🔴 取得はテナントで絞る", () => {
  const src = readFileSync("src/lib/emailLog.ts", "utf8");

  it("email_send_log の取得に tenant_id の絞りがある", () => {
    expect(src).toContain('.eq("tenant_id", tenantId)');
  });

  it("読み取りだけ（画面から書き換えない）", () => {
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});

describe("1通ぶんを1行に畳む", () => {
  const row = (o: Partial<EmailLogRow>): EmailLogRow => ({
    id: Math.random().toString(36),
    created_at: "2026-08-26T10:00:00Z",
    template_name: "booking-confirmation",
    recipient_email: "a@example.com",
    status: "sent",
    error_message: null,
    ...o,
  });

  it("同じ宛先・同じ種別・同じ日は1行になる", () => {
    const out = collapseLog([
      row({ status: "sent", created_at: "2026-08-26T10:05:00Z" }),
      row({ status: "pending", created_at: "2026-08-26T10:00:00Z" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].attempts).toBe(2);
  });

  it("🔴 残るのは一番新しい行（＝最終的にどうなったか）", () => {
    // 新しい順に渡ってくる前提。pending が残ると「送信中のまま」に見える
    const out = collapseLog([
      row({ status: "sent", created_at: "2026-08-26T10:05:00Z" }),
      row({ status: "failed", created_at: "2026-08-26T10:01:00Z" }),
      row({ status: "pending", created_at: "2026-08-26T10:00:00Z" }),
    ]);
    expect(out[0].status).toBe("sent");
    expect(out[0].attempts).toBe(3);
  });

  it("宛先が違えば別の行", () => {
    expect(collapseLog([row({}), row({ recipient_email: "b@example.com" })])).toHaveLength(2);
  });

  it("種別が違えば別の行", () => {
    expect(collapseLog([row({}), row({ template_name: "booking-reminder" })])).toHaveLength(2);
  });

  it("日が違えば別の行（毎日のリマインドが1行に潰れない）", () => {
    const out = collapseLog([
      row({ created_at: "2026-08-26T10:00:00Z" }),
      row({ created_at: "2026-08-25T10:00:00Z" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("空でも落ちない", () => {
    expect(collapseLog([])).toEqual([]);
  });
});

describe("状態の色分け", () => {
  it("届いたのは sent だけ", () => {
    expect(toneOf("sent")).toBe("ok");
  });

  it("店が動く必要があるものは bad", () => {
    for (const s of ["bounced", "failed", "dlq", "rejected"]) {
      expect(toneOf(s), s).toBe("bad");
    }
  });

  it("途中・意図的に止めたものは warn", () => {
    for (const s of ["pending", "suppressed", "duplicate", "rate_limited"]) {
      expect(toneOf(s), s).toBe("warn");
    }
  });

  it("🔴 知らない状態を「届いた」と言わない", () => {
    // DB 側が先に状態を増やすことがある。未知を ok に倒すと嘘の安心を出す
    expect(toneOf("something_new")).not.toBe("ok");
  });
});

describe("画面への配線", () => {
  const settings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");
  const screen = readFileSync("src/components/trainer/TrainerEmailLog.tsx", "utf8");

  it("メール・通知のカテゴリーに載っている", () => {
    expect(settings).toContain("TrainerEmailLog");
    const page = settings.slice(settings.indexOf('settingsView === "comms"'));
    expect(page.slice(0, 800)).toContain("<TrainerEmailLog />");
  });

  it("🔴 読み込み失敗を「履歴なし」と混同しない", () => {
    // 取り違えると「送っていない」と誤解して二重に送る
    expect(screen).toMatch(/emailLog\.loadFailed/);
    expect(screen).toMatch(/emailLog\.empty/);
  });

  it("ページの件数が lib と揃っている", () => {
    expect(screen).toContain("LOG_PAGE");
    expect(LOG_PAGE).toBeGreaterThan(0);
  });

  it("失敗の理由を隠さない", () => {
    expect(screen).toMatch(/e\.error_message/);
  });
});
