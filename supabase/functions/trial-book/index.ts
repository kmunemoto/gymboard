// trial-book: 公開の体験予約作成 API (テナント指定・認証不要)。
//
// 外部の予約サイト (例: app.kyoto-salute.com/trial) や GymBoard 自身の公開ページ
// (/trial/:tenantId) から呼ばれ、予約の作成と通知をサーバー側で完結させる。
// 従来のクライアント直 INSERT + ブラウザからの通知呼び出し (fire-and-forget) は
// 通知の取りこぼし (trial-booking-confirmation が anon 許可リスト外で 403 等) が
// あったため、この関数に一本化する。直 INSERT 経路 (anon の INSERT 権限) は
// migration 20260704140000 で閉鎖済み。
//
// POST { tenant_id, guest_name, guest_contact, booking_date, menu_id? }
//   - booking_date: ISO 文字列 (例 "2026-07-10T11:00:00+09:00")
//   - menu_id: メニューの体験（例: マシンピラティス専用の体験予約ページ /trial/:tenantId/menu/:menuId）。
//     そのメニューの担当（先生）の予約になり、担当のシフトの時間だけ受ける（2026-10-31）
//
// 業務上の拒否 (満枠・回数制限・入力不備) は HTTP 200 + { ok:false, error, code } で返す
// (フロントが supabase.functions.invoke でエラーメッセージをそのまま表示できるように)。
// 予期しない失敗 (500) は詳細をログにのみ残し、クライアントには汎用メッセージを返す。
//
// ガード:
//   - テナント実在 + status が active/trial であること
//   - 前日まで (会員予約と統一。予約日JSTの0:00を過ぎたら不可＝当日予約は不可。
//     送信中の境界ズレは小さな猶予で許容。旧: 24時間前まで)
//   - 10日先まで (ジムが「何日先まで」を決めていればその日数。サーバー側は +2日で判定。先すぎる日程は
//     当日キャンセルが増えやすいため短縮した — 旧: 1ヶ月先まで)。メニューの開始日がまだ先なら、
//     開始日の前日から数える（開始日から10日分を前もって受ける）
//   - 開始時刻は公開ページの枠と同じ: 営業時間（メニューの体験は担当のシフト）の中・開店から15分刻み・
//     1枠が閉店までに収まる（../_shared/trialRules.ts。2026-10-31 までは 10:00〜21:00 開始の直書きで、
//     22:30 閉店の店の 21:15・21:30 の枠を断っていた）
//   - 同一メールアドレスの予約は 24時間で3件まで (キャンセル済みは数えない)
//   - テナント全体で 1時間に20件まで (メール差し替えによる回数制限回避への防御)
//   - 時間帯の重複は BEFORE INSERT の check_booking_overlap トリガーが最終防衛
//
// 通知 (service_role で並列送信・各10秒タイムアウト・結果を response の notify に記録):
//   - お客様宛 確認メール (trial-booking-confirmation) — テンプレートが Salute の住所を
//     含むため当面 Salute テナント限定 (テナント別住所の差し込み対応までの暫定)
//   - トレーナー宛 メール (new-booking-notification) / LINE / push
//   - トレーナーの Google カレンダーへ登録 (連携済みの場合)
//   - 宛先スタッフは tenant_members (owner 優先、次に trainer。インストラクターは除く) で解決する。
//     旧 get_trainer_ids はテナント横断のため使用しない (他ジムへの誤通知防止)。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  LEGACY_GUEST_WINDOW_DAYS, isListedStart, jstDateKey, normalizeWindowDays, resolveDayBusinessMinutes,
  shiftDayMinutes, trialBookingLabel, trialMaxAheadMs, trialWindowAnchorMs, type OperatingHours, type ShiftRow,
} from "../_shared/trialRules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Postgres に渡す前に厳密な ISO 形式のみ許可する (V8 の new Date は寛容すぎるため)
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

// 予約可能ウィンドウ (公開ページのルールにサーバー側の余裕を持たせた値)
// 締切は会員予約と同じ「前日まで」＝予約日(JST)の0:00を過ぎたら不可。
// 送信中の日付境界ズレ(深夜の駆け込み)を許容する小さな猶予を持たせる。
const DEADLINE_GRACE_MS = 10 * 60 * 1000;
const RATE_LIMIT_PER_CONTACT_24H = 3;
const RATE_LIMIT_PER_TENANT_1H = 20;
const CANCELLED = "キャンセル済み";
// 2026-08-08 まで、ここに Salute御所南のテナントIDを直書きし、そのジムだけ
// 確認メールを「初回無料体験」表記にしていた。**体験の有料化に伴い分岐ごと廃止。**
// 呼称は全ジム共通「体験トレーニング」で、金額は tenants.trial_price_yen から出す。
// **テナントIDをこのファイルに戻さないこと**（1ジムの都合を全ジムのコードに置かない）。

const GENERIC_ERROR = "サーバーで問題が発生しました。時間をおいて再度お試しください。";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// 業務上の拒否は 200 で返す (フロントでメッセージ表示しやすくするため)
function reject(code: string, error: string) {
  return json({ ok: false, code, error }, 200);
}

// 予期しない失敗: 詳細はログのみ、クライアントには汎用メッセージ
function fail(step: string, detail: string) {
  console.error(`[trial-book] ${step} failed: ${detail}`);
  return json({ ok: false, error: GENERIC_ERROR }, 500);
}

type Payload = {
  tenant_id?: unknown;
  guest_name?: unknown;
  guest_contact?: unknown;
  booking_date?: unknown;
  custom_answers?: unknown;
  menu_id?: unknown;
};

/**
 * 予約時のカスタム質問（booking_questions）への回答スナップショット。
 *
 * 🔴 **クライアントから来た値をそのまま信用して保存しない。**
 * 公開ページ（未ログイン）から届くので、形・件数・長さをここで削る。
 * DB 側にも CHECK があるが、そこで落ちると予約自体が失敗する。
 * 「回答が壊れているせいで予約が取れない」のは筋が悪いので、**黙って捨てる**。
 *
 * 制限値は src/lib/bookingQuestions.ts と揃えてある
 * （ANSWER_MAX_LENGTH=500 / 1予約あたり10件）。
 */
function sanitizeCustomAnswers(raw: unknown): { question_id: string; label: string; value: string }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { question_id: string; label: string; value: string }[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label.trim().slice(0, 120) : "";
    const value = typeof rec.value === "string" ? rec.value.trim().slice(0, 500) : "";
    if (!label || !value) continue;
    out.push({
      question_id: typeof rec.question_id === "string" ? rec.question_id.slice(0, 64) : "",
      label,
      value,
    });
  }
  return out.length > 0 ? out : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return reject("validation", "リクエストの形式が正しくありません。");
    }

    const tenantId = String(body.tenant_id ?? "").trim();
    const guestName = String(body.guest_name ?? "").trim();
    const guestContact = String(body.guest_contact ?? "").trim();
    const bookingDateRaw = String(body.booking_date ?? "").trim();
    const customAnswers = sanitizeCustomAnswers(body.custom_answers);
    const menuId = String(body.menu_id ?? "").trim();

    if (!UUID_RE.test(tenantId)) return reject("validation", "ジムの指定が正しくありません。");
    if (menuId && !UUID_RE.test(menuId)) return reject("validation", "メニューの指定が正しくありません。");
    if (!guestName || guestName.length > 100) return reject("validation", "お名前を入力してください。");
    if (!EMAIL_RE.test(guestContact) || guestContact.length > 255) {
      return reject("validation", "正しいメールアドレスを入力してください。");
    }

    if (!ISO_DATETIME_RE.test(bookingDateRaw)) {
      return reject("validation", "予約日時の形式が正しくありません。");
    }
    const bookingInstant = new Date(bookingDateRaw);
    if (Number.isNaN(bookingInstant.getTime())) {
      return reject("validation", "予約日時の形式が正しくありません。");
    }
    // JST の開始時刻・日付を取り出す（枠グリッド判定と「前日まで」締切の両方で使う）
    const jst = new Date(bookingInstant.getTime() + 9 * 60 * 60 * 1000);
    // 前日まで: 予約日(JST)の0:00 の実インスタントを求め、それを過ぎていたら締切。
    const jstDayStartMs = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 60 * 60 * 1000;
    if (Date.now() >= jstDayStartMs + DEADLINE_GRACE_MS) {
      return reject("too_soon", "体験のご予約は前日までにお願いいたします。別の日をお選びください。");
    }
    // JST の開始時刻（分）。枠に乗っているかはジムの営業時間（メニューの体験は担当のシフト）を読んでから見る
    const startMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
    if (jst.getUTCSeconds() !== 0 || jst.getUTCMilliseconds() !== 0) {
      return reject("validation", "選択できない時間帯です。表示された空き枠からお選びください。");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ===== テナント確認 =====
    // 住所・連絡先・サイトURLは確認メールの本文に差し込むため一緒に取得する
    // (ジムごとに正しい情報を載せる。旧実装は Salute 固定だったため他ジムには送っていなかった)。
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .select("id, gym_name, status, address, email, website_url, slot_duration_minutes, trial_price_yen, booking_email_note, trial_email_cancel_note, operating_hours, booking_window_days")
      .eq("id", tenantId)
      .maybeSingle();
    if (tErr) return fail("tenant_lookup", tErr.message);
    if (!tenant || !["active", "trial"].includes(tenant.status as string)) {
      return reject("tenant_not_found", "ジムが見つかりません。予約リンクをご確認ください。");
    }
    const gymName = (tenant.gym_name as string) || "ジム";
    const gymAddress = ((tenant.address as string | null) ?? "").trim();
    const gymContactEmail = ((tenant.email as string | null) ?? "").trim();
    const gymWebsiteUrl = ((tenant.website_url as string | null) ?? "").trim();
    // 体験の料金（税込・円）。ジムごとの設定。null は「料金を書かない」で 0 とは別。
    // 列がまだ無い環境（マイグレーション未適用）では undefined になり、料金行は出ない。
    const trialPriceYen = (tenant.trial_price_yen as number | null | undefined) ?? null;
    // 確認メールに足す、店からのご案内。空/未設定ならメールにブロックごと出さない。
    // 列がまだ無い環境では undefined になり、同じく何も出ない（安全側）。
    const gymNote = ((tenant.booking_email_note as string | null | undefined) ?? "").trim() || null;
    // 「キャンセル・変更」欄の文章。設定されていればこの文章だけが出る（固定文もリンクも出ない）。
    // 空/未設定・列がまだ無い環境では null → テンプレートは従来の固定文（安全側）。
    const cancelNote = ((tenant.trial_email_cancel_note as string | null | undefined) ?? "").trim() || null;
    const sessionMinutes = (tenant.slot_duration_minutes as number | null) ?? 60;

    // ===== メニューの体験（担当・開始日・シフト）=====
    // DB（apply_trial_menu）も同じことを見る。ここで先に見るのは、お客様に分かる言葉で断るため。
    let menu: { id: string; name: string; staff_user_id: string; starts_on: string | null; trial_price_yen: number | null } | null = null;
    let shifts: ShiftRow[] = [];
    if (menuId) {
      const { data: m, error: mErr } = await admin
        .from("booking_menus")
        .select("id, tenant_id, name, staff_user_id, is_active, starts_on, trial_enabled, trial_price_yen")
        .eq("id", menuId)
        .maybeSingle();
      if (mErr) return fail("menu_lookup", mErr.message);
      if (!m || m.tenant_id !== tenantId || !m.is_active || m.trial_enabled !== true || !m.staff_user_id) {
        return reject("menu_unavailable", "このメニューの体験予約は受け付けていません。");
      }
      menu = {
        id: m.id as string,
        name: m.name as string,
        staff_user_id: m.staff_user_id as string,
        starts_on: (m.starts_on as string | null) ?? null,
        trial_price_yen: (m.trial_price_yen as number | null) ?? null,
      };
      const { data: rows, error: sErr } = await admin
        .from("staff_schedules")
        .select("weekday, start_time, end_time")
        .eq("tenant_id", tenantId)
        .eq("user_id", menu.staff_user_id);
      if (sErr) return fail("shift_lookup", sErr.message);
      shifts = (rows ?? []) as ShiftRow[];
      if (menu.starts_on && jstDateKey(bookingInstant.getTime()) < menu.starts_on) {
        const [, mo, d] = menu.starts_on.split("-").map(Number);
        return reject("too_soon", `${menu.name}の体験は${mo}/${d}からご予約いただけます。別の日をお選びください。`);
      }
    }

    // ===== 何日先まで =====
    // ジムが決めた日数（未設定は10日）。メニューの開始日がまだ先なら、開始日の前日から数える。
    const windowDays = normalizeWindowDays(tenant.booking_window_days) ?? LEGACY_GUEST_WINDOW_DAYS;
    const anchorMs = trialWindowAnchorMs(Date.now(), menu?.starts_on);
    if (bookingInstant.getTime() - anchorMs > trialMaxAheadMs(windowDays)) {
      return reject("too_far", `ご予約は${windowDays}日先まで承っています。別の日時をお選びください。`);
    }

    // ===== 開始時刻（公開ページに並ぶ枠と同じ）=====
    const hours = (tenant.operating_hours as OperatingHours | null) ?? null;
    const weekday = jst.getUTCDay();
    const day = menu ? shiftDayMinutes(hours, weekday, shifts) : resolveDayBusinessMinutes(hours, weekday);
    if (!isListedStart(day, startMin, sessionMinutes)) {
      return reject("validation", "選択できない時間帯です。表示された空き枠からお選びください。");
    }

    // ===== 連続予約ガード =====
    // (1) 同一メール 24時間で3件まで (ジム側でキャンセルして取り直すケースは数えない)
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: contactCount, error: rlErr } = await admin
      .from("trial_bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("guest_contact", guestContact)
      .neq("status", CANCELLED)
      .gte("created_at", since24h);
    if (rlErr) return fail("rate_limit_contact", rlErr.message);
    if ((contactCount ?? 0) >= RATE_LIMIT_PER_CONTACT_24H) {
      return reject("rate_limited", "短時間に複数のご予約をいただいたため受付を制限しています。お手数ですがジムへ直接ご連絡ください。");
    }
    // (2) テナント全体で 1時間に20件まで (メールアドレス差し替えでの (1) 回避に対する防御)
    const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: tenantCount, error: tlErr } = await admin
      .from("trial_bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", since1h);
    if (tlErr) return fail("rate_limit_tenant", tlErr.message);
    if ((tenantCount ?? 0) >= RATE_LIMIT_PER_TENANT_1H) {
      return reject("rate_limited", "ただいま予約が集中しています。しばらく時間をおいてから再度お試しいただくか、ジムへ直接ご連絡ください。");
    }

    // ===== 予約作成 (重複は check_booking_overlap トリガーが拒否する) =====
    const { data: inserted, error: insErr } = await admin
      .from("trial_bookings")
      .insert({
        tenant_id: tenantId,
        guest_name: guestName,
        guest_contact: guestContact,
        booking_date: bookingDateRaw,
        ...(customAnswers ? { custom_answers: customAnswers } : {}),
        // 担当（staff_user_id）は DB の apply_trial_menu がメニューから入れる（ここからは送らない）
        ...(menu ? { menu_id: menu.id } : {}),
        // booking_type / status は DB デフォルト ('初回無料体験' / '予約済み')。
        // '予約済み' で入れることで send-trial-reminders の前日リマインドも対象になる。
      })
      .select("id, booking_date, cancel_token")
      .single();

    if (insErr) {
      const msg = insErr.message ?? "";
      const code = (insErr as { code?: string }).code ?? "";
      if (code === "GB012") {
        return reject("menu_unavailable", "このメニューの体験予約は受け付けていません。");
      }
      // GB001 = 担当（先生）がその時間に別の予約を持っている。GB002 = 担当のシフトが変わった。
      // どちらも「その枠はもう取れない」なので満枠と同じく枠を取り直してもらう（slot_taken）
      if (code === "GB001" || code === "GB002" || msg.includes("この時間帯") || /overlap/i.test(msg)) {
        return reject("slot_taken", "この時間帯はすでに予約が入っています。別の時間をお選びください。");
      }
      return fail("insert", msg);
    }
    const trialBookingId = inserted.id as string;
    // 確認メールにはセルフキャンセルのボタンは出さない（オーナーの意向でメール連絡に一本化）。
    // テンプレートは cancelUrl 未指定なら「登録したジムのアカウントのメールアドレス
    // (tenants.email) へご連絡ください」の案内へフォールバックする（下記 gymContactEmail）。
    // cancel_token / エッジ関数 trial-cancel は既送信メールの旧リンク互換のため存置し、
    // レスポンスにも残す（メール本文には載せない）。
    const cancelToken = inserted.cancel_token as string;
    const cancelUrl = `${SUPABASE_URL}/functions/v1/trial-cancel?token=${cancelToken}`;

    // ===== 表示用の日時文字列 (JST) =====
    const dowChars = ["日", "月", "火", "水", "木", "金", "土"];
    const dateStr = `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日（${dowChars[jst.getUTCDay()]}）`;
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const timeStr = `${fmt(startMin)}〜${fmt(startMin + sessionMinutes)}`;
    // 店宛ての通知のラベル。メニューの体験は「マシンピラティスの体験予約」
    const bookingLabel = trialBookingLabel(menu?.name);

    // ===== 通知 (失敗しても予約自体は成立。結果を notify に記録) =====
    const serviceHeaders = {
      "Content-Type": "application/json",
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
    };
    const invokeFn = async (name: string, payload: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
          method: "POST",
          headers: serviceHeaders,
          body: JSON.stringify(payload),
          // 下流が固まっても予約成功レスポンスを人質に取らない
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        console.log(`[trial-book] ${name} status=${res.status} body=${text.slice(0, 160)}`);
        return res.ok;
      } catch (e) {
        console.error(`[trial-book] ${name} failed:`, e instanceof Error ? e.message : String(e));
        return false;
      }
    };

    const safeContact = guestContact.replace(/[^A-Za-z0-9._@+-]/g, "_");
    const notifyKey = `${bookingDateRaw}-${safeContact}`;

    // 宛先スタッフの解決: このテナントの trainer を優先、居なければ owner。
    // (tenant_members は joined_at 列。get_trainer_ids はテナント横断のため使わない)
    let trainerId: string | null = null;
    const { data: staff, error: staffErr } = await admin
      .from("tenant_members")
      .select("user_id, role")
      .eq("tenant_id", tenantId)
      .in("role", ["trainer", "owner"])
      .eq("status", "active")
      .neq("staff_access", "limited") // インストラクター（staff_access = limited）は店宛ての通知の宛先にしない（2026-10-28・src/lib/staffAccess.ts）
      .order("joined_at", { ascending: true });
    if (staffErr) console.error("[trial-book] staff lookup failed:", staffErr.message);
    const staffRows = staff ?? [];
    trainerId = (staffRows.find((m) => m.role === "owner") ?? staffRows[0])?.user_id ?? null; // 代表はオーナー（2026-10-28・宗本さん「オーナーは全ての通知を受け取る」）

    const notify: Record<string, boolean | string> = {};
    const tasks: Array<Promise<void>> = [];

    // 1) お客様宛 確認メール。ジムの名前・住所・連絡先・サイトURLを差し込むため全ジムで送信できる。
    tasks.push(
      invokeFn("send-transactional-email", {
        templateName: "trial-booking-confirmation",
        tenantId,
        recipientEmail: guestContact,
        idempotencyKey: `trial-confirm-${notifyKey}`,
        templateData: {
          customerName: guestName,
          bookingDate: dateStr,
          bookingTime: timeStr,
          gymName,
          gymAddress,
          gymContactEmail,
          gymWebsiteUrl,
          // 呼称は全ジム共通「体験トレーニング」。メニューの体験はメニューの名前で呼ぶ（「マシンピラティスの体験」）。
          menuName: menu?.name ?? null,
          // 金額はジムごとの設定。メニューの体験はメニューの料金（トレーニングの体験の料金は使わない）
          trialPriceYen: menu ? menu.trial_price_yen : trialPriceYen,
          gymNote,
          cancelNote,
          // cancelUrl は渡さない。テンプレートは cancelNote（店の設定した文章）があればそれだけを、
          // 無ければ gymContactEmail（＝登録したジムのアカウントのメールアドレス tenants.email）への
          // メール連絡案内をフォールバック表示する。
        },
      }).then((ok) => { notify.customer_email = ok; }),
    );

    if (trainerId) {
      // 2) トレーナー宛 メール
      tasks.push(
        invokeFn("send-transactional-email", {
          templateName: "new-booking-notification",
          tenantId,
          recipientEmail: "_resolve_trainer_",
          idempotencyKey: `trial-notify-${notifyKey}`,
          templateData: {
            customerName: `${guestName}（体験予約）`,
            bookingDate: dateStr,
            bookingTime: timeStr,
            planName: bookingLabel,
            gymName,
            // 本番Webドメインに統一（2026-07）。通常予約(bookingNotification=getWebOrigin)と
            // 経路で遷移先が食い違わないよう揃える。
            dashboardUrl: "https://app.kyoto-salute.com",
            trainerUserId: trainerId,
          },
        }).then((ok) => { notify.trainer_email = ok; }),
      );

      // 3) トレーナー宛 LINE (未連携なら送信側が無視する)
      tasks.push(
        invokeFn("send-line-message", {
          user_id: trainerId,
          message: `【${gymName}】新規の${bookingLabel}が入りました。\n\n・お名前：${guestName} 様\n・日時：${dateStr} ${timeStr}\n\nアプリの予約管理画面から詳細を確認してください。`,
        }).then((ok) => { notify.trainer_line = ok; }),
      );
    } else {
      notify.trainer_email = "skipped_no_trainer";
      notify.trainer_line = "skipped_no_trainer";
    }

    // 2') メニューの体験は担当（先生）にもメール（代表と同じ人なら送らない）。
    //     宗本さん「先生には担当のマシンピラティスの予約に関する通知だけ」（mem/features/instructor-staff.md）。
    //     キーは代表と別（-staff）。代表のキー（trial-notify-…）を先生に使わない
    if (menu && menu.staff_user_id !== trainerId) {
      tasks.push(
        invokeFn("send-transactional-email", {
          templateName: "new-booking-notification",
          tenantId,
          recipientEmail: "_resolve_trainer_",
          idempotencyKey: `trial-notify-${notifyKey}-staff`,
          templateData: {
            customerName: `${guestName}（体験予約）`,
            bookingDate: dateStr,
            bookingTime: timeStr,
            planName: bookingLabel,
            gymName,
            dashboardUrl: "https://app.kyoto-salute.com",
            trainerUserId: menu.staff_user_id,
          },
        }).then((ok) => { notify.staff_email = ok; }),
      );
    }

    // 4) トレーナー宛 push (宛先はテナント内のスタッフを push 側が解決する。メニューの体験は担当の先生にも)
    tasks.push(
      invokeFn("send-push-notification", {
        purpose: "trial_booking",
        trial_booking_id: trialBookingId,
      }).then((ok) => { notify.trainer_push = ok; }),
    );

    // 5) トレーナーの Google カレンダーへ登録 (連携済みの場合のみ成功する)
    tasks.push(
      invokeFn("google-calendar-sync", {
        action: "create",
        booking_id: trialBookingId,
        booking_date: bookingDateRaw,
        // カレンダー表示ラベル（DBの booking_type 値は据え置き、is_trial で識別）
        booking_type: bookingLabel,
        client_name: `🆕 ${guestName}`,
        is_trial: true,
      }).then((ok) => { notify.google_calendar = ok; }),
    );

    // invokeFn は例外を握りつぶして boolean を返すため、ここで失敗が伝播することはない
    await Promise.all(tasks);

    return json({
      ok: true,
      trial_booking_id: trialBookingId,
      cancel_token: cancelToken,
      cancel_url: cancelUrl,
      tenant_id: tenantId,
      booking_date: inserted.booking_date,
      notify,
    }, 200);
  } catch (e) {
    console.error("[trial-book] unexpected:", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: GENERIC_ERROR }, 500);
  }
});
