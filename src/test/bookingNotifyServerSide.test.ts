import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { SAME_DAY_FORFEIT_STATUS } from "@/hooks/useBookings";
import { PRODUCTION_WEB_ORIGIN } from "@/lib/brand";

// 予約の通知（店宛メール・受付確認・プッシュ）のサーバー側移行を見張る（2026-08-21）。
//
// 背景: 通知は src/lib/bookingNotification.ts（お客様の端末）が送っていて、
// 回線の瞬断で**店宛だけが黙って消える**沈黙故障が実際に起きた
// （8/8・8/15・8/20 の3件。email_send_log の時刻分析で invoke 自体が
// 呼ばれていないことを確認）。bookings の AFTER INSERT トリガー →
// notify-new-booking Edge Function に移した。
//
// 守るべき不変条件:
//   1. 🔴 冪等キーは旧クライアントと**同じ文字列**（booking-notify-<id> /
//      booking-confirm-customer-<id>）。変えると公開済みの旧アプリとの
//      重複排除が壊れ、移行期間中ずっと二重送信になる
//   2. 🔴 トリガーは通知の失敗を握りつぶす（予約の INSERT を絶対に妨げない）
//   3. 🔴 pg_net の認可は x-cron-secret（vault の service_role キーを Bearer に
//      載せる方式は環境変数と一致せず 403 になる。20260812040000 で実際に踏んだ）
//   4. 🔴 通知の本文を pg_net の body に載せない（booking_id / log_id だけ渡し、
//      Edge Function が service_role で実物を読み直す）
//   5. クライアントは端末発の送信を**しない**（復活させると沈黙故障が戻る）

const migrationsDir = "supabase/migrations";
// 🔴 検査は「連結全体」ではなく**最後の定義**に対して行う（CREATE OR REPLACE は
// 最後の定義しか残らないため）。行末コメントも落とす。
const notifySql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
  .filter((sql) =>
    /booking_notify_log|notify_booking_created|delete_my_gym|email_send_log_status_check/.test(sql))
  .join("\n")
  .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const lastFn = (name: string): string => {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const at = notifySql.lastIndexOf(marker);
  expect(at, `${name} の定義が見つからない`).toBeGreaterThanOrEqual(0);
  const rest = notifySql.slice(at);
  const end = rest.search(/\$(function)?\$;/);
  return end >= 0 ? rest.slice(0, end) : rest;
};

const edgeFn = readFileSync("supabase/functions/notify-new-booking/index.ts", "utf8");
const sendEmailFn = readFileSync("supabase/functions/send-transactional-email/index.ts", "utf8");
const configToml = readFileSync("supabase/config.toml", "utf8");

describe("🔴 DB トリガー（notify_booking_created）", () => {
  const fn = lastFn("notify_booking_created");

  it("結線: bookings の AFTER INSERT・FOR EACH ROW（定期予約は1行ずつ通知される）", () => {
    expect(notifySql).toMatch(
      /CREATE TRIGGER on_booking_insert_notify\s*\n\s*AFTER INSERT ON public\.bookings\s*\n\s*FOR EACH ROW EXECUTE FUNCTION public\.notify_booking_created\(\)/,
    );
  });

  it("🔴 認可は x-cron-secret（Bearer + service_role キーは 403 になる）", () => {
    expect(fn).toContain("'x-cron-secret', v_key");
    expect(fn).toMatch(/WHERE name = 'cron_secret'/);
    expect(fn).toMatch(/WHERE name = 'project_functions_url'/);
    expect(fn).not.toContain("'Authorization'");
    expect(fn).not.toContain("service_role_key");
  });

  it("🔴 body は booking_id と log_id だけ（本文・宛先・名前を DB から運ばない）", () => {
    expect(fn).toContain(
      "jsonb_build_object('booking_id', NEW.id, 'log_id', v_log_id)",
    );
    // 通知の材料になる自由文を body に混ぜない
    expect(fn).not.toMatch(/jsonb_build_object\([^)]*display_name/);
    expect(fn).not.toMatch(/jsonb_build_object\([^)]*gym_name/);
  });

  it("🔴 通知の失敗は握りつぶして予約を通す", () => {
    expect(fn).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*RETURN NEW;/);
  });

  it("記録は NEW.user_id（bookings に customer_user_id という列は無い）", () => {
    expect(fn).toContain("NEW.user_id");
    expect(notifySql).not.toContain("customer_user_id");
  });

  it("予約済み以外・予約変更の内部 INSERT・tenant 無しは記録だけ残して送らない", () => {
    expect(fn).toMatch(/NEW\.status IS DISTINCT FROM '予約済み'/);
    expect(fn).toMatch(/NEW\.created_via = 'reschedule'/);
    expect(fn).toMatch(/NEW\.tenant_id IS NULL/);
    // スキップ時も INSERT（記録）自体は行ってから RETURN する構造:
    // 「INSERT → IF v_skip THEN RETURN」の順
    const insertAt = fn.indexOf("INSERT INTO public.booking_notify_log");
    const skipReturnAt = fn.indexOf("IF v_skip IS NOT NULL THEN");
    expect(insertAt).toBeGreaterThan(-1);
    expect(skipReturnAt).toBeGreaterThan(insertAt);
  });

  it("actor（誰の操作か）を auth.uid() で採る（自己/代理は列から区別できない）", () => {
    expect(fn).toMatch(/auth\.uid\(\), 'created'/);
  });
});

describe("記録簿（booking_notify_log）と付随トリガー", () => {
  it("テーブルは service_role 専用（RLS 有効・ポリシー無し・anon/authenticated から REVOKE）", () => {
    expect(notifySql).toMatch(/CREATE TABLE public\.booking_notify_log/);
    expect(notifySql).toMatch(
      /ALTER TABLE public\.booking_notify_log ENABLE ROW LEVEL SECURITY/,
    );
    expect(notifySql).toMatch(
      /REVOKE ALL ON public\.booking_notify_log FROM PUBLIC, anon, authenticated/,
    );
    expect(notifySql).not.toMatch(/CREATE POLICY[^;]*ON public\.booking_notify_log/);
  });

  it("削除と消化も採取する（将来キャンセル通知を移すときの材料。復元不能なデータ）", () => {
    expect(notifySql).toMatch(
      /CREATE TRIGGER on_booking_delete_log\s*\n\s*AFTER DELETE ON public\.bookings/,
    );
    expect(notifySql).toMatch(/AFTER UPDATE OF status ON public\.bookings/);
    // 消化の status 値はクライアント定数と同じ文字列（ズレると採取されない）
    expect(notifySql).toContain(`NEW.status = '${SAME_DAY_FORFEIT_STATUS}'`);
  });

  it("🔴 delete_my_gym: booking_notify_log を bookings より**後**に消す（AFTER DELETE トリガーが行を足すため）", () => {
    const fn = lastFn("delete_my_gym");
    const tables = [...fn.matchAll(/DELETE FROM public\.(\w+)/g)].map((m) => m[1]);
    // 新テーブルが入っている
    expect(tables).toContain("booking_notify_log");
    // 並び: bookings → booking_notify_log
    expect(tables.indexOf("booking_notify_log")).toBeGreaterThan(tables.indexOf("bookings"));
    // 既存テーブルを1つも落としていない
    // （20260821080000 時点の31 + booking_notify_log + email_send_log + gym_videos）
    //
    // ⚠️ ここは**一覧を丸ごと**固定している。tenant_id を持つテーブルを増やしたら
    //    delete_my_gym に消し込みを足したうえで、この配列にも足すこと。
    //    面倒に見えるが、これが「閉じたジムの行が残る」を止めている唯一の関門
    //    （2026-08-26 に email_send_log を足したときも、ここが最初に赤くなった）。
    const expected = [
      "announcement_reads", "member_agreements", "message_reactions", "messages",
      "message_templates", "gym_videos", "operator_feedback", "workouts", "exercise_id_map",
      "exercises", "tenant_muscle_groups", "booking_waitlist", "bookings",
      "booking_notify_log", "email_send_log", "blocked_slots", "trial_bookings", "booking_questions",
      "staff_schedules", "booking_frequency_limits", "booking_capacity_windows",
      "booking_blocked_windows", "booking_closed_days", "member_payments", "counseling_responses",
      "monthly_reports", "progress_photos", "user_measurements", "meals",
      "notification_settings", "announcements", "migration_user_map", "tenant_plans",
      "tenant_members", "tenants",
    ];
    expect(tables).toEqual(expected);
  });

  it("bookings.created_via は 'reschedule' のみ許可（自由文のマーカー増殖を防ぐ）", () => {
    expect(notifySql).toMatch(
      /ADD COLUMN IF NOT EXISTS created_via TEXT\s*\n\s*CHECK \(created_via IS NULL OR created_via IN \('reschedule'\)\)/,
    );
  });
});

describe("Edge Function（notify-new-booking）", () => {
  it("config.toml: verify_jwt=false（pg_net から JWT なしで叩かれる）", () => {
    expect(configToml).toMatch(
      /\[functions\.notify-new-booking\]\s*\n\s*verify_jwt = false/,
    );
  });

  it("認可は service_role か x-cron-secret（notify-new-message と同じ）", () => {
    expect(edgeFn).toContain('req.headers.get("x-cron-secret") === cronSecret');
    expect(edgeFn).toMatch(/if \(!caller\?\.isServiceRole && !cronAuthorized\)/);
  });

  it("🔴 冪等キーは旧クライアントと同じ文字列（変えると移行期間中ずっと二重送信）", () => {
    // 旧クライアント（削除済み src/lib/bookingNotification.ts、公開済みビルドに残存）が
    // 名乗っていたキー。send-transactional-email 側の重複排除はこの文字列一致が前提。
    expect(edgeFn).toContain("`booking-notify-${booking.id}`");
    expect(edgeFn).toContain("`booking-confirm-customer-${booking.id}`");
  });

  it("プッシュのタグも旧クライアントと同じ booking-<id>（Web は置き換えで畳む）", () => {
    expect(edgeFn).toContain("`booking-${booking.id}`");
  });

  it("🔴 リクエストから読むのは booking_id / log_id だけ（本文・宛先は DB から読み直す）", () => {
    expect(edgeFn).toContain("const { booking_id, log_id } = await req.json()");
    // タイトル・本文・宛先をリクエストから受け取らない
    expect(edgeFn).not.toMatch(/req\.json\(\)[^;]*title/);
    expect(edgeFn).not.toMatch(/body\.user_ids/);
  });

  it("店宛は new-booking-notification、お客様宛は booking-confirmation", () => {
    expect(edgeFn).toContain('templateName: "new-booking-notification"');
    expect(edgeFn).toContain('recipientEmail: "_resolve_trainer_"');
    expect(edgeFn).toContain('templateName: "booking-confirmation"');
    expect(edgeFn).toContain('recipientEmail: "_resolve_user_"');
  });

  it("プッシュは自己予約のみ（代理予約は従来もプッシュ無し）・宛先はスタッフ＋本人", () => {
    expect(edgeFn).toMatch(/actorUserId !== null && actorUserId === booking\.user_id/);
    expect(edgeFn).toMatch(/if \(isSelfBooking\)/);
    expect(edgeFn).toContain("[...new Set([...staffIds, booking.user_id])]");
  });

  it("代表スタッフの順序は trainer → owner（クライアントの fetchMyTenantStaffIds と同じ）", () => {
    const trainerAt = edgeFn.indexOf('m.role === "trainer"');
    const ownerAt = edgeFn.indexOf('m.role === "owner"');
    expect(trainerAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeGreaterThan(trainerAt);
  });

  it("メールのリンク先は brand.ts の PRODUCTION_WEB_ORIGIN と同じ値（Deno は import できず写し）", () => {
    const m = edgeFn.match(/const PRODUCTION_WEB_ORIGIN = "([^"]+)"/);
    expect(m?.[1]).toBe(PRODUCTION_WEB_ORIGIN);
  });

  it("予約済み以外・reschedule・tenant 無しは送らない（トリガーと二重のガード）", () => {
    expect(edgeFn).toMatch(/booking\.status !== ACTIVE_STATUS/);
    expect(edgeFn).toContain('booking.created_via === "reschedule"');
    expect(edgeFn).toContain('const ACTIVE_STATUS = "予約済み"');
  });
});

describe("send-transactional-email の重複排除と拒否の記録", () => {
  it("🔴 明示された冪等キーを notification_dedupe で先勝ちにする（旧クライアントとの二重送信を1通に畳む）", () => {
    expect(sendEmailFn).toMatch(/if \(dedupable\)/);
    expect(sendEmailFn).toContain("`email:${explicitIdempotencyKey}`");
    expect(sendEmailFn).toContain("'23505'");
    expect(sendEmailFn).toContain("status: 'duplicate'");
    expect(sendEmailFn).toContain("deduped: true");
  });

  it("🔴 予約（INSERT）は enqueue の直前・失敗したら取り消す（キーだけ焼けて永久 duplicate を防ぐ）", () => {
    // 配信停止トークンの処理より後・enqueue より前に予約する
    const tokenAt = sendEmailFn.indexOf("email_unsubscribe_tokens");
    const reserveAt = sendEmailFn.indexOf(".insert({ idempotency_key: `email:${explicitIdempotencyKey}` })");
    const enqueueAt = sendEmailFn.indexOf("rpc('enqueue_email'");
    expect(reserveAt).toBeGreaterThan(tokenAt);
    expect(enqueueAt).toBeGreaterThan(reserveAt);
    // enqueue 失敗時に予約を消す
    const enqueueFail = sendEmailFn.slice(sendEmailFn.indexOf("if (enqueueError)"));
    expect(enqueueFail).toMatch(/dedupeReserved && explicitIdempotencyKey/);
    expect(enqueueFail).toContain(".delete()");
  });

  it("fallback の messageId では予約しない（毎回ユニークで排除の意味が無い）", () => {
    expect(sendEmailFn).toMatch(/explicitIdempotencyKey = body\.idempotencyKey \|\| body\.idempotency_key \|\| null/);
  });

  it("🔴 排除の対象は予約行の id を含むキーだけ（体験・ドロップインの再予約メールを永久に消さない）", () => {
    // notification_dedupe に期限は無い。全キーを対象にすると、体験予約の冪等キー
    // （trial-confirm-<日時>-<連絡先>＝予約行ではなく「枠×連絡先」で決まる）が焼き付き、
    // 「キャンセル → 同じ枠を取り直す」で確認メールが二度と出なくなる。
    // 体験のお客様はアプリを持たず、メールが唯一の連絡手段。
    const m = sendEmailFn.match(/const DEDUPE_KEY_PREFIXES = \[([^\]]+)\]/);
    expect(m, "DEDUPE_KEY_PREFIXES の定義が見つからない").toBeTruthy();
    const prefixes = m![1].split(",").map((x) => x.trim().replace(/^'|'$/g, "")).filter(Boolean);
    expect(prefixes.sort()).toEqual(["booking-confirm-customer-", "booking-notify-"]);
    // 予約行の id を含まないキー（体験・ドロップイン・リマインダー）が混ざっていないこと
    for (const p of prefixes) {
      expect(["trial-", "dropin-", "booking-reminder-", "cancel-"].some((bad) => p.startsWith(bad)))
        .toBe(false);
    }
    expect(sendEmailFn).toMatch(/DEDUPE_KEY_PREFIXES\.some\(\(p\) => explicitIdempotencyKey!\.startsWith\(p\)\)/);
  });

  it("解放（DELETE）の失敗を握りつぶさない（キーだけ焼けると手作業でしか直せない）", () => {
    const enqueueFail = sendEmailFn.slice(sendEmailFn.indexOf("if (enqueueError)"));
    expect(enqueueFail).toMatch(/const \{ error: releaseErr \}/);
    expect(enqueueFail).toMatch(/CRITICAL: dedupe key stuck/);
  });

  it("🔴 認可 403・宛先解決の失敗・テンプレート404 は email_send_log に 'rejected' を残す", () => {
    expect(sendEmailFn).toContain("status: 'rejected'");
    // 403（authorizeClientCall が false）
    const forbiddenBlock = sendEmailFn.slice(
      sendEmailFn.indexOf("if (!ok) {"),
      sendEmailFn.indexOf("status: 403"),
    );
    expect(forbiddenBlock).toContain("logRejected(");
    // 宛先解決の失敗（店宛メールだけが通る経路 = 今回の沈黙故障の対抗仮説だった場所）
    expect(sendEmailFn).toMatch(/logRejected\(templateName, recipientEmail, `could not resolve trainer email/);
    expect(sendEmailFn).toMatch(/logRejected\(templateName, recipientEmail, `could not resolve user email/);
    expect(sendEmailFn).toMatch(/logRejected\(templateName, recipientEmail, 'template not found'\)/);
  });

  it("未認証の 401 では記録しない（anon キーだけで叩ける入口＝無制限の書き込み経路になる）", () => {
    const authBlock = sendEmailFn.slice(
      sendEmailFn.indexOf("const caller = await verifyCaller(req)"),
      sendEmailFn.indexOf("status: 401"),
    );
    expect(authBlock).not.toContain("logRejected");
  });

  it("email_send_log の CHECK に duplicate / rejected / rate_limited が入っている", () => {
    const lastCheck = notifySql.slice(notifySql.lastIndexOf("email_send_log_status_check"));
    expect(lastCheck).toContain("'duplicate'");
    expect(lastCheck).toContain("'rejected'");
    // process-email-queue が 429 のときに書く値。CHECK に無いと 23514 が無音で捨てられ、
    // レート制限に当たった事実がどこにも残らない（既存バグをこの機会に直した）。
    expect(lastCheck).toContain("'rate_limited'");
    const queue = readFileSync("supabase/functions/process-email-queue/index.ts", "utf8");
    expect(queue).toContain("status: 'rate_limited'");
  });
});

describe("🔴 クライアントは端末発の送信をしない（復活させると沈黙故障が戻る）", () => {
  it("bookingNotification.ts は削除済み", () => {
    expect(existsSync("src/lib/bookingNotification.ts")).toBe(false);
  });

  it("CustomerBooking: 作成時のメール・プッシュの端末発送信が無い", () => {
    const src = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
    expect(src).not.toContain("sendBookingNotifications");
    expect(src).not.toContain("send-push-notification");
    expect(src).not.toContain("fetchMyTenantStaffIds");
  });

  it("TrainerSchedule: 代理予約のメールの端末発送信が無い", () => {
    const src = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
    expect(src).not.toContain("sendBookingNotifications");
  });

  it("予約変更の内部 INSERT に created_via マーカーを付ける（付け忘れると変更のたびに新規予約メールが出る）", () => {
    const src = readFileSync("src/hooks/useBookings.ts", "utf8");
    // マーカーは silent（＝予約変更）のときだけ載せる。通常の予約に付くと
    // サーバー側が新規予約の通知を出さなくなる＝直したはずの不具合が復活する。
    expect(src).toMatch(
      /withMarker \? \{ \.\.\.basePayload, created_via: "reschedule" \} : basePayload/,
    );
    expect(src).toMatch(/await insertBooking\(!!opts\.silent\)/);
  });

  it("🔴 tenantHelper は getSession（getUser は毎回ネットワークに出て、失敗すると所属なしと区別できない）", () => {
    const src = readFileSync("src/lib/tenantHelper.ts", "utf8");
    expect(src).toContain("supabase.auth.getSession()");
    expect(src).not.toContain("supabase.auth.getUser()");
  });
});

describe("レビューで見つかった落とし穴（2026-08-21 のレビュー修正）", () => {
  it("🔴 プッシュの抑止は INSERT の一意制約で直列化する（select→upsert だと定期予約でN回鳴る）", () => {
    // トリガーは予約1行ごとに pg_net を撃つので、定期予約では N 本が同時に走る。
    // 「読んでから書く」だと全員が『行が無い』を見てしまい抑止が効かない。
    const pushBlock = edgeFn.slice(edgeFn.indexOf("const pushKey ="));
    expect(pushBlock).toMatch(/\.from\("notification_dedupe"\)\s*\n\s*\.insert\(\{ idempotency_key: pushKey/);
    expect(pushBlock).toContain('reserveErr.code === "23505"');
    // upsert（＝先勝ちにならない）に戻していないこと
    expect(pushBlock).not.toMatch(/\.upsert\(\{ idempotency_key: pushKey/);
  });

  it("抑止の基盤が壊れているときは鳴らす（fail-open。店が気づかないほうが害が大きい）", () => {
    expect(edgeFn).toMatch(/push dedupe reservation failed — sending anyway/);
  });

  it("🔴 スタッフ一覧の取得エラーを「スタッフ0人」と混同しない（サーバー側で沈黙故障を再発させない）", () => {
    expect(edgeFn).toMatch(/if \(staffRes\.error\) throw staffRes\.error;/);
  });

  it("プランの所要時間は limit(1)（tenant_plans に一意制約が無く、同名2件で maybeSingle が落ちる）", () => {
    const planBlock = edgeFn.slice(
      edgeFn.indexOf('.from("tenant_plans")'),
      edgeFn.indexOf('.from("profiles")'),
    );
    expect(planBlock).toContain(".limit(1)");
    expect(planBlock).not.toContain(".maybeSingle()");
  });

  it("🔴 created_via は未適用のDBでも予約を失わない（PGRST204 なら列なしで入れ直す）", () => {
    // 予約変更は「旧行を削除 → 新行を INSERT」。未適用のDBで INSERT が PGRST204 で
    // 落ちると**お客様の予約が消える**（ロールバックの再作成も同じ経路で道連れ）。
    const src = readFileSync("src/hooks/useBookings.ts", "utf8");
    expect(src).toMatch(/const insertBooking = \(withMarker: boolean\)/);
    expect(src).toMatch(/code === "PGRST204" && opts\.silent/);
    expect(src).toMatch(/\(\{ data, error \} = await insertBooking\(false\)\)/);
  });
});
