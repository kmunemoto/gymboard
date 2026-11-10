/**
 * メールの悪用を止める（2026-11-10 定期セキュリティ点検の直し①）と、Edge Function 同士の呼び出しの直し。
 *   - trial-book-2 / trial-book-cap-1: 体験予約の確認メールの上限を、店が消せない記録（email_send_quota）で、宛先をそろえて数える
 *   - send-trial-reminders-1: 体験予約の宛先・日時を画面から書き換えさせない門番・リマインドにも上限・配信停止
 *   - resend-email-1: 再送は届かなかった行だけ・回数の上限・配信停止
 *   - invite-email-relay-1: 本人が来ていない取り込みのアカウント宛ては配信停止・回数の上限。招待は配信停止の宛先を付ける前に断る
 *   - trial-book-1: 店宛てメールの宛先は予約の行の担当・サーバーからの宛先もそのジムの人か確かめる・メニューの担当の門番
 *   - 🔴 supabase.functions.invoke（新しい supabase-js）は本番の鍵を Authorization に載せず、送信が 401 になっていた
 *     （体験の前日リマインド・再送・招待・先生への写しが一度も送れていなかった）→ invokeAsService
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  RESEND_LIMITS, UNCLAIMED_USER_LIMITS, canonicalEmail, recipientKey, releaseEmailSend, reserveEmailSend,
} from "../../supabase/functions/_shared/emailQuota";

const read = (p: string) => readFileSync(p, "utf8");
/** 行コメントを落とす（説明の中の語で誤検知しない） */
const code = (p: string) => read(p).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

const MIGRATION = "supabase/migrations/20261110010000_email_send_quota_and_trial_booking_guard.sql";

describe("canonicalEmail: 数えるための宛先の形", () => {
  it.each([
    ["Taro@Example.com", "taro@example.com"],
    ["  taro@example.com  ", "taro@example.com"],
    ["taro+1@example.com", "taro@example.com"],
    ["taro+news+x@example.com", "taro@example.com"],
    ["t.a.r.o@gmail.com", "taro@gmail.com"],
    ["T.Aro+abc@GoogleMail.com", "taro@gmail.com"],
    ["taro@example.com.", "taro@example.com"],
    ["ｔａｒｏ@ＥＸＡＭＰＬＥ.com", "taro@example.com"], // 全角
  ])("%s → %s", (raw, want) => {
    expect(canonicalEmail(raw)).toBe(want);
  });

  it("Gmail 以外の点は落とさない（別の受信箱）", () => {
    expect(canonicalEmail("t.aro@example.com")).toBe("t.aro@example.com");
  });

  it("+ で始まる・@ が無いものは壊さない", () => {
    expect(canonicalEmail("+abc@example.com")).toBe("+abc@example.com");
    expect(canonicalEmail("no-at-mark")).toBe("no-at-mark");
  });

  it("記録に残すのはそろえた形の SHA-256（アドレスそのものは残さない）", async () => {
    const a = await recipientKey("Taro+1@Example.com");
    const b = await recipientKey("taro@example.com");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toContain("taro");
    expect(await recipientKey("jiro@example.com")).not.toBe(b);
  });
});

describe("reserveEmailSend / releaseEmailSend", () => {
  const fake = (result: { data?: unknown; error?: unknown }) => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const deletes: string[] = [];
    const admin = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: result.data ?? null, error: result.error ?? null };
      },
      from: (_t: string) => ({ delete: () => ({ eq: async (_c: string, v: string) => { deletes.push(v); return { error: null }; } }) }),
    };
    return { admin, calls, deletes };
  };

  it("上限と宛先の印を RPC に渡し、通れば id を返す", async () => {
    const { admin, calls } = fake({ data: { ok: true, id: "q1" } });
    const r = await reserveEmailSend(admin, {
      kind: "resend", recipient: "Taro+x@Example.com", tenantId: "t1", sourceRef: "m1", limits: RESEND_LIMITS,
    });
    expect(r).toEqual({ ok: true, id: "q1" });
    expect(calls[0].fn).toBe("reserve_email_send");
    expect(calls[0].args).toEqual({
      p_kind: "resend",
      p_recipient_key: await recipientKey("taro@example.com"),
      p_tenant_id: "t1",
      p_source_ref: "m1",
      p_max_recipient_24h: 5,
      p_max_tenant_1h: null,
      p_max_tenant_24h: 30,
      p_max_source: 2,
    });
  });

  it.each(["recipient", "tenant_hour", "tenant_day", "source"])("上限に当たった（%s）", async (reason) => {
    const { admin } = fake({ data: { ok: false, reason } });
    expect(await reserveEmailSend(admin, { kind: "guest_confirm", recipient: "a@b.jp", tenantId: null, limits: {} }))
      .toEqual({ ok: false, reason });
  });

  it("🔴 DB に聞けなかった・形の違う答えは error（呼ぶ側が送らない）", async () => {
    expect((await reserveEmailSend(fake({ error: { message: "down" } }).admin,
      { kind: "guest_confirm", recipient: "a@b.jp", tenantId: null, limits: {} })).ok).toBe(false);
    const r = await reserveEmailSend(fake({ data: { what: 1 } }).admin,
      { kind: "guest_confirm", recipient: "a@b.jp", tenantId: null, limits: {} });
    expect(r).toMatchObject({ ok: false, reason: "error" });
    const throwing = { rpc: () => { throw new Error("boom"); }, from: () => ({}) };
    expect(await reserveEmailSend(throwing, { kind: "guest_confirm", recipient: "a@b.jp", tenantId: null, limits: {} }))
      .toMatchObject({ ok: false, reason: "error" });
  });

  it("戻すのは積んだ1行だけ（失敗しても投げない）", async () => {
    const { admin, deletes } = fake({});
    await releaseEmailSend(admin, "q9");
    expect(deletes).toEqual(["q9"]);
    await expect(releaseEmailSend({ rpc: () => null, from: () => { throw new Error("x"); } }, "q1")).resolves.toBeUndefined();
  });

  it("上限の値", () => {
    expect(RESEND_LIMITS).toEqual({ perRecipient24h: 5, perTenant24h: 30, perSource: 2 });
    expect(UNCLAIMED_USER_LIMITS).toEqual({ perRecipient24h: 10 });
  });
});

describe("マイグレーション: 送った記録と門番", () => {
  const sql = read(MIGRATION);
  const fnBody = (name: string) => sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), sql.indexOf("$$;", sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)));

  it("🔴 記録の表は service_role だけ（RLS を有効にしてポリシーは作らない・anon と authenticated から取り上げる）", () => {
    expect(sql).toContain("ALTER TABLE public.email_send_quota ENABLE ROW LEVEL SECURITY;");
    expect(sql).not.toMatch(/CREATE POLICY[^;]*email_send_quota/);
    expect(sql).toContain("REVOKE ALL ON public.email_send_quota FROM anon;");
    expect(sql).toContain("REVOKE ALL ON public.email_send_quota FROM authenticated;");
    expect(sql).toContain("GRANT SELECT, INSERT, DELETE ON public.email_send_quota TO service_role;");
  });

  it("🔴 ジムへの外部キーを付けない（ジムを消して記録ごと消させない）・宛先は印（64桁の16進）だけ", () => {
    const table = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS public.email_send_quota"), sql.indexOf(");", sql.indexOf("CREATE TABLE IF NOT EXISTS public.email_send_quota")));
    expect(table).not.toMatch(/REFERENCES/i);
    expect(table).toContain("recipient_key text NOT NULL CHECK (recipient_key ~ '^[0-9a-f]{64}$')");
    expect(table).toContain("kind text NOT NULL CHECK (kind IN ('guest_confirm', 'resend', 'unclaimed_user'))");
  });

  it("🔴 数える→積むを1本ずつ（宛先・ジムの勧告ロック）・古い記録は8日で消す", () => {
    const body = fnBody("reserve_email_send");
    expect(body).toContain("SECURITY DEFINER");
    expect(body).toContain("pg_advisory_xact_lock(hashtextextended('email_send_quota:r:' || p_kind || ':' || p_recipient_key, 0))");
    expect(body).toContain("pg_advisory_xact_lock(hashtextextended('email_send_quota:t:' || p_kind || ':' || p_tenant_id::text, 0))");
    expect(body).toContain("DELETE FROM public.email_send_quota WHERE created_at < now() - interval '8 days';");
    // 数える窓
    expect(body).toContain("recipient_key = p_recipient_key AND created_at > now() - interval '24 hours'");
    expect(body).toContain("tenant_id = p_tenant_id AND created_at > now() - interval '1 hour'");
    expect(body).toContain("tenant_id = p_tenant_id AND created_at > now() - interval '24 hours'");
    expect(body).toContain("source_ref = p_source_ref");
    // 積むのは全部の上限を見たあと
    expect(body.indexOf("INSERT INTO public.email_send_quota")).toBeGreaterThan(body.indexOf("'source'"));
  });

  it("🔴 予約の関数は service_role だけが呼べる", () => {
    const sig = "public.reserve_email_send(text, text, uuid, text, integer, integer, integer, integer)";
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM authenticated;`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
  });

  it("🔴 体験予約の門番: 画面からは宛先・お名前・日時など（作成日時・取り消しの鍵・カレンダーの予定も）を変えさせない", () => {
    const body = fnBody("guard_trial_booking_update");
    expect(body).not.toContain("SECURITY DEFINER"); // current_user で「画面から」を見分ける
    expect(body).toContain("IF current_user NOT IN ('authenticated', 'anon') THEN");
    for (const col of ["id", "tenant_id", "guest_name", "guest_contact", "booking_date", "booking_kind", "booking_type", "menu_id",
      "staff_user_id", "created_at", "cancel_token", "custom_answers", "google_event_id"]) {
      expect(body, col).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`);
    }
    expect(body).toContain("IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'キャンセル済み' THEN");
    expect(sql).toMatch(/CREATE TRIGGER trg_guard_trial_booking_update\s+BEFORE UPDATE ON public\.trial_bookings\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_trial_booking_update\(\);/);
  });

  it("🔴 メニューの担当の門番: 画面からはそのジムの在籍中のスタッフだけ・担当を変えない編集では見ない", () => {
    const body = fnBody("guard_booking_menu_staff");
    expect(body).not.toContain("SECURITY DEFINER");
    expect(body).toContain("IF current_user NOT IN ('authenticated', 'anon') THEN");
    expect(body).toContain("NEW.staff_user_id IS NOT DISTINCT FROM OLD.staff_user_id");
    expect(body).toContain("public.has_tenant_role(NEW.tenant_id, NEW.staff_user_id, ARRAY['owner', 'trainer'])");
    expect(sql).toMatch(/CREATE TRIGGER trg_guard_booking_menu_staff\s+BEFORE INSERT OR UPDATE ON public\.booking_menus/);
  });
});

describe("🔴 画面が体験予約に書く列は、門番が許すものだけ（今のアプリが止まらない）", () => {
  // 門番が通す列（status はキャンセル済みへの変更だけ）
  const ALLOWED = new Set(["follow_up_status", "followed_up_at", "source", "declined_reason", "trial_fee_status", "follow_up_note", "status"]);
  const srcFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) return p.includes("/test") ? [] : srcFiles(p);
      return /\.(ts|tsx)$/.test(e.name) && !/fixture/i.test(e.name) ? [p] : [];
    });

  it("trial_bookings の .update({…}) のキーを全部見る", () => {
    const found: string[] = [];
    for (const f of srcFiles("src")) {
      const s = read(f);
      for (let at = s.indexOf('.from("trial_bookings")'); at >= 0; at = s.indexOf('.from("trial_bookings")', at + 1)) {
        const tail = s.slice(at, at + 400);
        const m = tail.match(/^\.from\("trial_bookings"\)\s*\n?\s*\.update\(\{([^}]*)\}/);
        if (!m) continue;
        for (const key of m[1].matchAll(/(\[?\w+\]?)\s*:/g)) {
          found.push(`${f}:${key[1]}`);
          if (key[1] === "[field]") {
            // 流入元・見送り理由（handleSaveText の field は "source" | "declined_reason"）
            expect(s).toContain('field: "source" | "declined_reason"');
            continue;
          }
          expect(ALLOWED.has(key[1]), `${f}: ${key[1]}`).toBe(true);
          if (key[1] === "status") expect(m[1]).toContain('status: "キャンセル済み"');
        }
      }
    }
    // 空振りしていない（体験の CRM・予定表の取り消し）
    expect(found.length).toBeGreaterThanOrEqual(6);
  });
});

describe("🔴 Edge Function 同士の呼び出し（invokeAsService）", () => {
  const helper = read("supabase/functions/_shared/invokeAsService.ts");

  it("鍵を Authorization（Bearer）と apikey の両方に自分で付ける", () => {
    expect(helper).toContain("apikey: key,");
    expect(helper).toContain("Authorization: `Bearer ${key}`,");
    expect(helper).toContain("signal: AbortSignal.timeout(");
  });

  const fnDirs = readdirSync("supabase/functions").filter((d) => d !== "mcp" && !d.startsWith("_"));
  const sources = fnDirs
    .map((d) => `supabase/functions/${d}/index.ts`)
    .filter((f) => existsSync(f))
    .map((f) => ({ f, s: code(f) }));

  it("🔴 新しい supabase-js（npm:@supabase/supabase-js@2）を使う関数は supabase.functions.invoke を使わない", () => {
    // 新しい版は sb_secret_… の鍵を Authorization に載せない → 呼ばれた側が 401 で断り、送信履歴にも残らない
    const offenders = sources
      .filter(({ s }) => /from ['"]npm:@supabase\/supabase-js@2['"]/.test(s) && /\.functions\.invoke\(/.test(s))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
    expect(sources.length).toBeGreaterThan(30);
  });

  it("🔴 functions.invoke を使う関数は、鍵を Bearer に載せる古い版（esm.sh の 2.4x）に固定している", () => {
    for (const { f, s } of sources) {
      if (!/\.functions\.invoke\(/.test(s)) continue;
      expect(s, f).toMatch(/from ["']https:\/\/esm\.sh\/@supabase\/supabase-js@2\.4\d\.\d+["']/);
    }
  });

  it.each([
    ["supabase/functions/send-trial-reminders/index.ts", "invokeAsService('send-transactional-email'"],
    ["supabase/functions/resend-email/index.ts", 'invokeAsService("send-transactional-email"'],
    ["supabase/functions/invite-customer/index.ts", 'invokeAsService("send-transactional-email"'],
    ["supabase/functions/send-transactional-email/index.ts", "invokeAsService('send-transactional-email'"],
  ])("%s は invokeAsService で頼む", (f, call) => {
    expect(code(f)).toContain(call);
  });
});

describe("send-trial-reminders（体験の前日リマインド）", () => {
  const f = "supabase/functions/send-trial-reminders/index.ts";
  const s = code(f);

  it("🔴 送る時にも数える（1つのジムから60通・同じ宛先へ3通まで。宛先はそろえて数える）", () => {
    expect(s).toContain("const MAX_PER_TENANT_PER_RUN = 60");
    expect(s).toContain("const MAX_PER_RECIPIENT_PER_RUN = 3");
    expect(s).toContain("const recipient = canonicalEmail(contact)");
    expect(s).toContain("if (tenantSent >= MAX_PER_TENANT_PER_RUN) {");
    expect(s).toContain("if (recipientSent >= MAX_PER_RECIPIENT_PER_RUN) {");
    // 数えるのは送る前
    expect(s.indexOf("perRecipient.set(recipient, recipientSent + 1)")).toBeLessThan(s.indexOf("await invokeAsService("));
  });

  it("🔴 明日の予約を区切って全部読む（並びを決めて .range）", () => {
    expect(s).toContain(".order('booking_date', { ascending: true })");
    expect(s).toContain(".order('id', { ascending: true })");
    expect(s).toContain(".range(from, from + PAGE - 1)");
  });

  it("配信停止で止まったものは送った数に入れない・デプロイの印を付ける", () => {
    expect(s).toContain("} else if (payload?.success === false) {");
    expect(s).toMatch(/const BUILD = '\d{4}-\d{2}-\d{2}-[a-z-]+'/);
    expect(s).toContain("'x-gymboard-build': BUILD,");
  });
});

describe("send-transactional-email", () => {
  const s = code("supabase/functions/send-transactional-email/index.ts");
  const must = s.slice(s.indexOf("const MUST_DELIVER_TEMPLATES = new Set(["), s.indexOf("])", s.indexOf("const MUST_DELIVER_TEMPLATES = new Set([")));

  it("🔴 体験の前日リマインドは必ず届けるメールではない（配信停止を見る）", () => {
    expect(must).not.toContain("trial-booking-reminder");
    expect(must).toContain("'trial-booking-confirmation'");
    expect(must).toContain("'booking-cancellation'");
  });

  it("🔴 再送と、本人が来ていない取り込みのアカウント宛ては、必ず届けるメールでも配信停止を見る", () => {
    expect(s).toContain("const mustDeliver = MUST_DELIVER_TEMPLATES.has(templateName) && !honorSuppression && !unclaimedRecipient");
    expect(s).toContain("honorSuppression = body.honorSuppression === true");
    expect(s).toContain("unclaimedRecipient = authUser.user.user_metadata?.imported === true && !authUser.user.last_sign_in_at");
  });

  it("🔴 本人が来ていない取り込みのアカウント宛ては同じ宛先へ24時間10通まで（重複排除のあと・送る前に数える）", () => {
    const at = s.indexOf("kind: 'unclaimed_user',");
    expect(at).toBeGreaterThan(s.indexOf("const DEDUPE_KEY_PREFIXES"));
    expect(at).toBeLessThan(s.indexOf("rpc('enqueue_email'"));
    expect(s.slice(at, at + 200)).toContain("limits: UNCLAIMED_USER_LIMITS,");
    // 止めたら冪等キーの予約を戻す（戻さないと、その予約のメールが二度と送れない）
    const stop = s.slice(at, s.indexOf("rpc('enqueue_email'"));
    expect(stop).toContain(".from('notification_dedupe').delete().eq('idempotency_key', `email:${explicitIdempotencyKey}`)");
  });

  it("まだ招待していない取り込みのアカウント（届かない仮のアドレス）には送らない", () => {
    expect(s).toContain("const IMPORT_PLACEHOLDER_DOMAIN = '@gymboard.invalid'");
    expect(s).toContain("if (effectiveRecipient.toLowerCase().endsWith(IMPORT_PLACEHOLDER_DOMAIN)) {");
  });

  it("🔴 サーバーからの user_id 指定の宛先も、そのジムの人か確かめる（店宛ては在籍中のスタッフ）", () => {
    const check = s.indexOf("if (caller.isServiceRole && tenantId");
    expect(check).toBeGreaterThan(-1);
    // 宛先のアドレスを引く前
    expect(check).toBeLessThan(s.indexOf("getUserById(templateData.trainerUserId)"));
    expect(check).toBeLessThan(s.indexOf("getUserById(templateData.resolveUserId)"));
    const block = s.slice(check, s.indexOf("let unclaimedRecipient = false"));
    expect(block).toContain(".from('tenant_members')");
    expect(block).toContain(".eq('tenant_id', tenantId)");
    expect(block).toContain("if (asStaff) q = q.eq('status', 'active').in('role', ['owner', 'trainer'])");
    expect(block).toContain("await logRejected(");
  });
});

describe("resend-email（送信履歴の再送）", () => {
  const s = code("supabase/functions/resend-email/index.ts");

  it("🔴 届かなかった行だけ・もう届いた送信は断る", () => {
    expect(s).toContain('const RESENDABLE_STATUSES = new Set(["failed", "dlq", "bounced", "rejected"]);');
    expect(s).toContain('if (!RESENDABLE_STATUSES.has(String(row.status))) return json({ error: "not_failed" }, 409);');
    expect(s).toContain('if ((delivered ?? 0) > 0) return json({ error: "already_delivered" }, 409);');
  });

  it("🔴 回数の上限（1通2回・1ジム24時間30通・同じ宛先24時間5通）を送る前に数える", () => {
    const at = s.indexOf("const quota = await reserveEmailSend(admin, {");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(s.indexOf('await invokeAsService("send-transactional-email"'));
    const call = s.slice(at, s.indexOf("});", at));
    expect(call).toContain('kind: "resend"');
    expect(call).toContain("sourceRef: String(row.message_id ?? row.id)");
    expect(call).toContain("limits: RESEND_LIMITS");
    expect(s).toContain('return json({ error: "resend_limited" }, 429);');
  });

  it("🔴 必ず届けるメールでも配信停止を見る・送れなかったら数を戻す・営業中のジムだけ", () => {
    expect(s).toContain("honorSuppression: true,");
    expect(s.match(/await releaseEmailSend\(admin, quota\.id\);/g)?.length).toBe(2);
    expect(s).toContain('if (!gym || !["active", "trial"].includes(String(gym.status))) return json({ error: "Forbidden" }, 403);');
  });

  it("画面は上限・届いた済みを分かる言葉で出す（全部の言語にある）", () => {
    const screen = read("src/components/trainer/TrainerEmailLog.tsx");
    expect(screen).toContain(': r.code === "resend_limited" ? "emailLog.resendLimited"');
    expect(screen).toContain(': r.code === "already_delivered" ? "emailLog.resendDelivered"');
    for (const lang of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const json = JSON.parse(read(`src/locales/${lang}.json`));
      expect(json.emailLog.resendLimited, lang).toBeTruthy();
      expect(json.emailLog.resendDelivered, lang).toBeTruthy();
    }
  });
});

describe("invite-customer（招待）", () => {
  const s = code("supabase/functions/invite-customer/index.ts");

  it("🔴 配信停止のアドレスは、アカウントに付ける前に断る", () => {
    const check = s.indexOf('.from("suppressed_emails")');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(s.indexOf("admin.auth.admin.updateUserById(targetUserId"));
    expect(s).toContain('if (suppressed) return json({ error: "email_suppressed" }, 409);');
    // 画面は今までどおりの言葉で出す
    expect(read("src/components/trainer/clientDetail/MemberInviteCard.tsx")).toContain('code === "email_suppressed" ? "dataImport.invite.errSuppressed"');
  });
});

describe("trial-book（点検 trial-book-1）: 店宛てメールの担当は予約の行の値", () => {
  const s = code("supabase/functions/trial-book/index.ts");

  it("🔴 INSERT の返り値で担当を受け取り、その人に送る（最初に読んだメニューの担当は使わない）", () => {
    expect(s).toContain('.select("id, booking_date, cancel_token, staff_user_id")');
    expect(s).toContain("const bookedStaff = (inserted.staff_user_id as string | null) ?? null;");
    const staffMail = s.slice(s.indexOf("idempotencyKey: `trial-notify-${notifyKey}-staff`,"));
    const data = staffMail.slice(0, staffMail.indexOf("}).then("));
    expect(data).toContain("trainerUserId: bookedStaff,");
    expect(data).not.toContain("menu.staff_user_id");
  });
});
