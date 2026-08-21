import * as React from 'npm:react@18.3.1'
import { render } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'
import { makeEmailHtmlAsciiSafe } from '../_shared/email-encoding.ts'

// この関数は _shared/transactional-email-templates のメールテンプレートを
// デプロイ時にバンドルする。テンプレートを更新したら、必ず本関数を再デプロイして
// 再バンドルすること（共有ファイルだけ変えても本関数の再デプロイが無いと反映されない）。
// 2026-07: 体験予約メールにお客様セルフキャンセルのボタンを追加（cancelUrl）→ 同月中に廃止し、
// ジムのメールアドレス（tenants.email）への連絡案内に一本化した。テンプレート側の分岐は残置。

// 差出人名のフォールバック（製品名）。
// 以前はここが "パーソナルジムSalute御所南" 固定で、どのジムのお客様に送るメールでも
// 差出人が Salute になってしまっていた（本文のジム名は正しいのに受信箱の一覧だけ別のジム）。
// 現在は templateData.gymName があればそれを差出人名に使い、無い場合だけこの製品名に落とす。
const BRAND_NAME = "ジムボード"
// SENDER_DOMAIN is the verified sender subdomain FQDN (e.g., "notify.example.com").
// It MUST match the subdomain delegated to Lovable's nameservers — never the root domain.
// The email API looks up this exact domain; a mismatch causes "No email domain record found".
const SENDER_DOMAIN = "notify.kyoto-salute.com"
// FROM_DOMAIN is the domain shown in the From: header. Kept identical to SENDER_DOMAIN
// (matches auth-email-hook.ts's convention) — the root domain (kyoto-salute.com) has no
// SPF/DKIM alignment of its own, only the notify. subdomain is verified with Mailgun.
// Using the root here would cause DMARC misalignment and silent rejection at the
// receiving mail server (accepted by Mailgun, dropped by Gmail/etc with no visible error).
const FROM_DOMAIN = "notify.kyoto-salute.com"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}



// Generate a cryptographically random 32-byte hex token
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Auth: require either a valid user JWT or the service-role key. The default
// Supabase gateway only validates that *some* JWT is present (anon key passes),
// so we re-verify in code to prevent unauthenticated visitors from triggering
// template emails to arbitrary recipients (spam / phishing vector).
//
// hasRole（user_roles ベース）はここでは使わない。`trainer` は
// **テナントの概念を持たない全社共通のロール**で、しかも新規登録画面の
// 「トレーナー」タブから誰でも自分で取れる（signup-trainer）。
// 「トレーナーだから信用する」は認可の根拠にならない。所属は tenant_members で見る。
// 同じ形の穴を send-push-notification でも塞いだ（PR #246）。
import { verifyCaller } from '../_shared/auth.ts'

/** クライアント（お客様・ジムのスタッフの両方）が呼べるテンプレート。 */
// 残り5種（trial-booking-confirmation / drop-in-booking-confirmation /
// new-account-notification / trial-booking-reminder / booking-reminder）は
// service_role 専用。実際に呼んでいるのも Edge Function だけであることを
// 2026-08-04 に全走査して確認済み（src/ と supabase/functions/ の両方）。
const CLIENT_ALLOWED_TEMPLATES = new Set([
  'booking-confirmation',
  'booking-cancellation',
  'new-booking-notification',
])

interface Membership { tenantId: string; isStaff: boolean }

/**
 * そのユーザーが在籍しているテナント（active のみ）。
 *
 * ⚠️ get_my_tenant_id() / shares_tenant_with_me() は auth.uid() に依存するため、
 * service_role のクライアントから呼ぶと**エラー無しで NULL / false** を返す。
 * Edge Function からは tenant_members を直接引くこと。
 */
async function loadMemberships(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<Membership[]> {
  const { data, error } = await admin
    .from('tenant_members')
    .select('tenant_id, role, status')
    .eq('user_id', userId)
    .eq('status', 'active')
  if (error) throw error
  const out: Membership[] = []
  for (const row of (data ?? []) as { tenant_id: string | null; role: string }[]) {
    // tenant_id が NULL の行を混ぜると「NULL 同士が一致した」判定を作ってしまう
    if (!row.tenant_id) continue
    out.push({ tenantId: row.tenant_id, isStaff: row.role === 'owner' || row.role === 'trainer' })
  }
  return out
}

/**
 * 認証済みユーザー（＝service_role ではない呼び出し）が、この送信を行ってよいか。
 *
 * 判断の軸は「呼び出し元と宛先が**同じジムに属しているか**」だけ。
 * ロールでゲートを丸ごと開けない（それが今回塞いだ穴）。
 */
async function authorizeClientCall(
  admin: ReturnType<typeof createClient>,
  caller: { userId: string; email?: string | null },
  body: {
    templateName: string
    recipientEmail: string
    templateData: { trainerUserId?: unknown; resolveUserId?: unknown }
  },
): Promise<boolean> {
  if (!CLIENT_ALLOWED_TEMPLATES.has(body.templateName)) return false

  const mine = await loadMemberships(admin, caller.userId)
  if (mine.length === 0) return false // どのジムにも属していない＝送る相手がいない
  const myTenants = new Set(mine.map((m) => m.tenantId))
  const myStaffTenants = new Set(mine.filter((m) => m.isStaff).map((m) => m.tenantId))

  // (1) ジムのスタッフ宛（お客様→自分のジム、スタッフ→自分のジム）。
  //     宛先は「呼び出し元と同じジムの、現役スタッフ」でなければならない。
  if (body.recipientEmail === '_resolve_trainer_') {
    const target = body.templateData.trainerUserId
    if (typeof target !== 'string') return false
    const theirs = await loadMemberships(admin, target)
    return theirs.some((m) => m.isStaff && myTenants.has(m.tenantId))
  }

  // (2) 個人宛（メールアドレスは Edge Function 側で解決する）。
  //     自分自身か、「自分がスタッフをしているジムの在籍者」なら送ってよい
  //     （ジム側の代理予約・代理キャンセルがこの経路）。
  if (body.recipientEmail === '_resolve_user_') {
    const target = body.templateData.resolveUserId
    if (typeof target !== 'string') return false
    if (target === caller.userId) return true
    if (myStaffTenants.size === 0) return false
    const theirs = await loadMemberships(admin, target)
    return theirs.some((m) => myStaffTenants.has(m.tenantId))
  }

  // (3) 生のメールアドレス指定。**自分宛だけ**に限る。
  //     ここを緩めると、正規ドメイン（SPF/DKIM 済み）から任意の宛先へ
  //     それらしいメールを送れる＝フィッシングの踏み台になる。
  //     ジム側が他人に送りたい場合は (2) の _resolve_user_ を使う。
  const callerEmail = caller.email
  return typeof body.recipientEmail === 'string'
    && !!callerEmail
    && body.recipientEmail.toLowerCase() === callerEmail.toLowerCase()
}

/**
 * 早期 return（認可 403・宛先解決の失敗・テンプレート404）でも email_send_log に
 * 痕跡を残す（status='rejected'）。以前はこれらの経路が**1行も残さず**消えていたため、
 * 「クライアントが呼ばなかった」と「呼んだが弾かれた」をログから区別できなかった
 * （2026-08-21 の予約通知の沈黙故障の調査で判明）。
 * 未認証の 401 では書かない（anon キーだけで叩ける入口なので、書くと無制限の
 * 書き込み経路になる）。記録の失敗はレスポンスに影響させない。
 */
async function logRejected(
  templateName: string | undefined,
  recipientEmail: string | undefined,
  reason: string,
) {
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) return
    await createClient(url, key).from('email_send_log').insert({
      message_id: crypto.randomUUID(),
      template_name: templateName || 'unknown',
      recipient_email: recipientEmail || 'unknown',
      status: 'rejected',
      error_message: reason,
    })
  } catch (e) {
    console.error('logRejected failed', e)
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const caller = await verifyCaller(req)
  if (!caller || (!caller.isServiceRole && !caller.userId)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // service_role（Edge Function 同士の呼び出し）は従来どおり全テンプレートを送れる。
  // 認証済みユーザーからの呼び出しは「同じジムに属しているか」で判断する。
  if (!caller.isServiceRole) {
    // 本体は下で改めて req.json() で読む。ここは判定のための覗き見なので clone する
    // （Request の body は一度しか読めない）。同じバッファなので内容は必ず一致する。
    let peekedBody: any = null
    try { peekedBody = await req.clone().json() } catch { /* ignore */ }
    let ok = false
    try {
      ok = await authorizeClientCall(
        createClient(supabaseUrl, supabaseServiceKey),
        { userId: caller.userId!, email: caller.email },
        {
          templateName: peekedBody?.templateName || peekedBody?.template_name || '',
          recipientEmail: peekedBody?.recipientEmail || peekedBody?.recipient_email || '',
          templateData: peekedBody?.templateData || {},
        },
      )
    } catch (e) {
      // 所属が引けなかったときは**送らない**。ここで握りつぶして通すと、
      // DB が一時的に落ちている間だけ誰でも送れる関数になる。
      console.error('authorizeClientCall failed', e)
      ok = false
    }
    if (!ok) {
      await logRejected(
        peekedBody?.templateName || peekedBody?.template_name,
        peekedBody?.recipientEmail || peekedBody?.recipient_email,
        `authorization failed (caller ${caller.userId})`,
      )
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  // Parse request body
  let templateName: string
  let recipientEmail: string
  let idempotencyKey: string
  // 呼び出し元が明示した冪等キー（fallback の messageId と区別する。
  // 明示されたキーだけが下の重複排除の対象になる）。
  let explicitIdempotencyKey: string | null = null
  let messageId: string
  let templateData: Record<string, any> = {}
  try {
    const body = await req.json()
    templateName = body.templateName || body.template_name
    recipientEmail = body.recipientEmail || body.recipient_email
    messageId = crypto.randomUUID()
    explicitIdempotencyKey = body.idempotencyKey || body.idempotency_key || null
    idempotencyKey = explicitIdempotencyKey || messageId
    if (body.templateData && typeof body.templateData === 'object') {
      templateData = body.templateData
    }
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON in request body' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (!templateName) {
    return new Response(
      JSON.stringify({ error: 'templateName is required' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 1. Look up template from registry (early — needed to resolve recipient)
  const template = TEMPLATES[templateName]

  if (!template) {
    console.error('Template not found in registry', { templateName })
    await logRejected(templateName, recipientEmail, 'template not found')
    return new Response(
      JSON.stringify({
        error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`,
      }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Resolve effective recipient: template-level `to` takes precedence over
  // the caller-provided recipientEmail. This allows notification templates
  // to always send to a fixed address (e.g., site owner from env var).
  let effectiveRecipient = template.to || recipientEmail

  // Special: resolve trainer email from DB when placeholder is used
  if (effectiveRecipient === '_resolve_trainer_' && templateData.trainerUserId) {
    const supabaseForAuth = createClient(supabaseUrl, supabaseServiceKey)
    const { data: authUser } = await supabaseForAuth.auth.admin.getUserById(templateData.trainerUserId)
    if (authUser?.user?.email) {
      effectiveRecipient = authUser.user.email
    } else {
      console.error('Could not resolve trainer email', { trainerUserId: templateData.trainerUserId })
      await logRejected(templateName, recipientEmail, `could not resolve trainer email (${templateData.trainerUserId})`)
      return new Response(
        JSON.stringify({ error: 'Could not resolve trainer email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  // Special: resolve any user email from DB by user_id
  if (effectiveRecipient === '_resolve_user_' && templateData.resolveUserId) {
    const supabaseForAuth = createClient(supabaseUrl, supabaseServiceKey)
    const { data: authUser } = await supabaseForAuth.auth.admin.getUserById(templateData.resolveUserId)
    if (authUser?.user?.email) {
      effectiveRecipient = authUser.user.email
    } else {
      console.error('Could not resolve user email', { resolveUserId: templateData.resolveUserId })
      await logRejected(templateName, recipientEmail, `could not resolve user email (${templateData.resolveUserId})`)
      return new Response(
        JSON.stringify({ error: 'Could not resolve user email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  if (!effectiveRecipient || effectiveRecipient === '_resolve_trainer_' || effectiveRecipient === '_resolve_user_') {
    await logRejected(templateName, recipientEmail, 'recipient missing or unresolved')
    return new Response(
      JSON.stringify({
        error: 'recipientEmail is required (unless the template defines a fixed recipient)',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Create Supabase client with service role (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Critical booking templates always deliver — they are essential app emails
  // that the user must receive. They bypass the suppression list, but the
  // email API still requires an unsubscribe token for runtime app emails.
  const MUST_DELIVER_TEMPLATES = new Set([
    'booking-confirmation',
    'booking-cancellation',
    'new-booking-notification',
    'trial-booking-confirmation',
    'new-account-notification',
    'trial-booking-reminder',
  ])
  const mustDeliver = MUST_DELIVER_TEMPLATES.has(templateName)
  console.log('Preparing transactional email', {
    templateName,
    effectiveRecipient,
    mustDeliver,
  })

  // 2. Check suppression list (fail-closed: if we can't verify, don't send)
  // Skipped entirely for must-deliver templates.
  if (!mustDeliver) {
  const { data: suppressed, error: suppressionError } = await supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', effectiveRecipient.toLowerCase())
    .maybeSingle()

  if (suppressionError) {
    console.error('Suppression check failed — refusing to send', {
      error: suppressionError,
      effectiveRecipient,
    })
    return new Response(
      JSON.stringify({ error: 'Failed to verify suppression status' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (suppressed) {
    // Log the suppressed attempt
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })

    console.log('Email suppressed', { effectiveRecipient, templateName })
    return new Response(
      JSON.stringify({ success: false, reason: 'email_suppressed' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
  }

  // 3. Get or create unsubscribe token (one token per email address).
  // Must-deliver templates still include a token because the email API requires
  // it, but they do NOT honor suppression or used tokens as a delivery blocker.
  const normalizedEmail = effectiveRecipient.toLowerCase()
  let unsubscribeToken: string | undefined

  // Check for existing token for this email
  const { data: existingToken, error: tokenLookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (tokenLookupError) {
    console.error('Token lookup failed', {
      error: tokenLookupError,
      email: normalizedEmail,
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to look up unsubscribe token',
    })
    return new Response(
      JSON.stringify({ error: 'Failed to prepare email' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (existingToken && (mustDeliver || !existingToken.used_at)) {
    // Reuse existing token. For must-deliver templates, even a used token must
    // not block booking-related delivery.
    unsubscribeToken = existingToken.token
  } else if (!existingToken) {
    // Create new token — upsert handles concurrent inserts gracefully
    unsubscribeToken = generateToken()
    const { error: tokenError } = await supabase
      .from('email_unsubscribe_tokens')
      .upsert(
        { token: unsubscribeToken, email: normalizedEmail },
        { onConflict: 'email', ignoreDuplicates: true }
      )

    if (tokenError) {
      console.error('Failed to create unsubscribe token', {
        error: tokenError,
      })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to create unsubscribe token',
      })
      return new Response(
        JSON.stringify({ error: 'Failed to prepare email' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // If another request raced us, our upsert was silently ignored.
    // Re-read to get the actual stored token.
    const { data: storedToken, error: reReadError } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (reReadError || !storedToken) {
      console.error('Failed to read back unsubscribe token after upsert', {
        error: reReadError,
        email: normalizedEmail,
      })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to confirm unsubscribe token storage',
      })
      return new Response(
        JSON.stringify({ error: 'Failed to prepare email' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    unsubscribeToken = storedToken.token
  } else {
    // Token exists but is already used — email should have been caught by suppression check above.
    // This is a safety fallback; log and skip sending.
    console.warn('Unsubscribe token already used but email not suppressed', {
      email: normalizedEmail,
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
      error_message:
        'Unsubscribe token used but email missing from suppressed list',
    })
    return new Response(
      JSON.stringify({ success: false, reason: 'email_suppressed' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 4. テンプレートを HTML とプレーンテキストに描画する。
  //
  // 🔴 **`renderAsync` を使わないこと。**
  //
  // `@react-email/render@0.0.17` の browser ビルド（Deno が引く方）は
  // `readStream` で `decoder.decode(chunk)` を **`{ stream: true }` 無し**で呼ぶ。
  // 各チャンクを独立した完結UTF-8列として復号するため、**境界をまたいだ
  // 多バイト文字が U+FFFD に化ける。** Deno は必ずこの経路に入る
  // （Node は別経路なので**手元では再現しない**）。
  //
  // 実測（2026-08-06・実 Deno）: 予約確認メールの宛名を1〜60文字で振ると
  //   renderAsync … **3件で化けた**（宛名が1〜3文字のとき。「アプ?からキャンセル」）
  //   render      … **0件**
  // **入力の長さ次第**なので、1通試して無事でも何も保証されない。
  //
  // 同期の `render` は `renderToStaticMarkup` を使いストリームを通らない。
  //
  // その後の makeEmailHtmlAsciiSafe は**送信経路**（quoted-printable の
  // 76バイト折り返し）に対する第2層。描画側が壊した文字は直せないので、
  // 上の `render` が第1層として要る。
  //
  // 🔴 以前はここで wrapEmailHtml も通していたが、それが本文に挿入する
  //    `<!--\n-->` が一部のメールクライアントで可視化された
  //    （2026-08-18「アプリからキ??ンセル」）。ASCII 化すれば QP は本文を
  //    壊せないので、折り返し自体が不要だった。
  const rawHtml = render(
    React.createElement(template.component, templateData),
    { pretty: true }
  )
  const html = makeEmailHtmlAsciiSafe(rawHtml)
  const plainText = render(
    React.createElement(template.component, templateData),
    { plainText: true }
  )


  // 差出人名: そのジムの名前を優先（テンプレートに gymName が渡っている場合）。
  const senderName =
    String((templateData as Record<string, unknown>)?.gymName ?? '').trim() || BRAND_NAME

  // Resolve subject — supports static string or dynamic function
  const resolvedSubject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  // 5. 冪等キーの重複排除（2026-08-21）。
  //
  // 予約の通知はサーバー側（notify-new-booking）へ移したが、公開済みの旧クライアントは
  // 今までどおり端末からも同じメールを送ってくる。両者は**同じ冪等キー**
  // （booking-notify-<id> 等）を名乗るので、ここで先勝ちにすれば1通に畳まれる。
  // 以前は idempotency_key を配送APIへ渡すだけで、**この関数を2回呼べば2通届いていた**。
  //
  // - notification_dedupe への INSERT が直列化点。23505 になった側が重複 →
  //   status='duplicate' を記録して 200 で返す
  // - dedupe 基盤自体のエラーでは**送信を止めない**（fail-open。予約メールは
  //   二重に届くほうが、届かないより害が小さい）
  // - 🔴 予約（INSERT）は enqueue の**直前**に置く。前段（宛先解決・配信停止トークン）の
  //   失敗パスが予約の後に残っていると、一時エラーでキーだけ焼けて
  //   「その予約のメールは再試行しても永久に duplicate」になる
  // - enqueue に失敗したら予約を取り消す（同じ理由）
  //
  // 🔴 対象は下の DEDUPE_KEY_PREFIXES で始まるキー**だけ**に限る。
  //    notification_dedupe に期限は無く、一度焼けたキーは二度と送れない。
  //    体験・ドロップイン予約の冪等キーは `trial-confirm-<日時>-<連絡先>` のように
  //    **予約行ではなく「枠×連絡先」で決まる**ため、全キーを対象にすると
  //    「キャンセル → 同じ枠を取り直す」で確認メールが永久に消える
  //    （体験のお客様はアプリを持たず、メールが唯一の連絡手段）。
  //    ここに足すキーは、必ず予約行の id を含む（＝二度と再利用されない）ものに限ること。
  const DEDUPE_KEY_PREFIXES = ['booking-notify-', 'booking-confirm-customer-']
  const dedupable = !!explicitIdempotencyKey
    && DEDUPE_KEY_PREFIXES.some((p) => explicitIdempotencyKey!.startsWith(p))
  let dedupeReserved = false
  if (dedupable) {
    const { error: dedupeErr } = await supabase
      .from('notification_dedupe')
      .insert({ idempotency_key: `email:${explicitIdempotencyKey}` })
    if (!dedupeErr) {
      dedupeReserved = true
    } else if (dedupeErr.code === '23505') {
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'duplicate',
        error_message: `idempotency key already used: ${explicitIdempotencyKey}`,
      })
      console.log('Duplicate send suppressed', { templateName, idempotencyKey: explicitIdempotencyKey })
      return new Response(
        JSON.stringify({ success: true, deduped: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    } else {
      console.error('Dedupe reservation failed — sending anyway', { error: dedupeErr })
    }
  }

  // 6. Enqueue the pre-rendered email for async processing by the dispatcher.
  // The dispatcher (process-email-queue) handles sending, retries, and rate-limit backoff.

  // Log pending BEFORE enqueue so we have a record even if enqueue crashes
  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: effectiveRecipient,
      // 差出人名はそのジムの名前にする（templateData.gymName）。渡ってこないテンプレートは
      // 製品名にフォールバックし、特定のジム名が他ジムのメールに出ないようにする。
      from: `${senderName} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: resolvedSubject,
      html,
      text: plainText,
      purpose: 'transactional',
      label: templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue email', {
      error: enqueueError,
      templateName,
      effectiveRecipient,
    })

    // 冪等キーの予約を取り消す（残すと、この予約の再試行が永久に duplicate 扱いになる）
    if (dedupeReserved && explicitIdempotencyKey) {
      const { error: releaseErr } = await supabase
        .from('notification_dedupe')
        .delete()
        .eq('idempotency_key', `email:${explicitIdempotencyKey}`)
      // 解放に失敗するとキーだけ焼けて、この予約のメールは再試行しても永久に
      // duplicate になる。復旧は手作業なので、気づけるようにログへ明示する。
      if (releaseErr) {
        console.error('CRITICAL: dedupe key stuck — delete it manually', {
          key: `email:${explicitIdempotencyKey}`,
          error: releaseErr,
        })
      }
    }

    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })

    return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Transactional email enqueued', {
    templateName,
    effectiveRecipient,
    mustDeliver,
    hasUnsubscribeToken: Boolean(unsubscribeToken),
  })

  return new Response(
    JSON.stringify({ success: true, queued: true }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})
