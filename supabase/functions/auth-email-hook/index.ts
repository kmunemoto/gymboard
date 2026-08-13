import { parseEmailWebhookPayload } from 'npm:@lovable.dev/email-js@0.1.2'
import { WebhookError, verifyWebhookRequest } from 'npm:@lovable.dev/webhooks-js@0.0.2'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { wrapEmailHtml } from '../_shared/email-encoding.ts'
// ⚠️ 認証メールは6種別すべて素の文字列で組み立てる。React・ストリーミング描画は通さない。
//    種別ごとに逃がすと必ず取りこぼす（2026-06 recovery → 2026-08 signup で再発）。
//    理由は auth-plain.ts の冒頭。
import { renderAuthHtml, renderAuthText, type AuthEmailType } from '../_shared/email-templates/auth-plain.ts'


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-lovable-signature, x-lovable-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: '【ジムボード】メールアドレスの確認',
  invite: '【ジムボード】ご招待のお知らせ',
  magiclink: '【ジムボード】ログイン用リンク',
  recovery: '【ジムボード】パスワード再設定',
  email_change: '【ジムボード】新しいメールアドレスの確認',
  reauthentication: '【ジムボード】認証コード',
}

// 扱う認証メールの種別。描画は auth-plain.ts が担う。
const AUTH_EMAIL_TYPES: readonly AuthEmailType[] = [
  'signup', 'invite', 'magiclink', 'recovery', 'email_change', 'reauthentication',
]
const isAuthEmailType = (t: string): t is AuthEmailType =>
  (AUTH_EMAIL_TYPES as readonly string[]).includes(t)

// Configuration
const SITE_NAME = "ジムボード"
const SENDER_DOMAIN = "notify.kyoto-salute.com"
const ROOT_DOMAIN = "kyoto-salute.com"
const FROM_DOMAIN = "notify.kyoto-salute.com" // Domain shown in From address (may be root or sender subdomain)

// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder (RFC 6761 .test TLD) so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = "https://gymboard.lovable.app"
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: {
    token: '123456',
  },
}

// Preview endpoint handler - returns rendered HTML without sending email
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewCorsHeaders })
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const authHeader = req.headers.get('Authorization')

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!isAuthEmailType(type)) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ⚠️ **プレビューと本番は同じ描画を通すこと。**
  //    別経路にすると「プレビューは綺麗なのに、届くメールだけ壊れている」という、
  //    一番気づけない状態を作る（以前はここだけ renderAsync だった）。
  const sampleData = SAMPLE_DATA[type] || {}
  const html = renderAuthHtml(type, sampleData as any)

  return new Response(html, {
    status: 200,
    headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// Webhook handler - verifies signature and sends email
async function handleWebhook(req: Request): Promise<Response> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')

  if (!apiKey) {
    console.error('LOVABLE_API_KEY not configured')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Verify signature + timestamp, then parse payload.
  let payload: any
  let run_id = ''
  try {
    const verified = await verifyWebhookRequest({
      req,
      secret: apiKey,
      parser: parseEmailWebhookPayload,
    })
    payload = verified.payload
    run_id = payload.run_id
  } catch (error) {
    if (error instanceof WebhookError) {
      switch (error.code) {
        case 'invalid_signature':
        case 'missing_timestamp':
        case 'invalid_timestamp':
        case 'stale_timestamp':
          console.error('Invalid webhook signature', { error: error.message })
          return new Response(JSON.stringify({ error: 'Invalid signature' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        case 'invalid_payload':
        case 'invalid_json':
          console.error('Invalid webhook payload', { error: error.message })
          return new Response(
            JSON.stringify({ error: 'Invalid webhook payload' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
      }
    }

    console.error('Webhook verification failed', { error })
    return new Response(
      JSON.stringify({ error: 'Invalid webhook payload' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!run_id) {
    console.error('Webhook payload missing run_id')
    return new Response(
      JSON.stringify({ error: 'Invalid webhook payload' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (payload.version !== '1') {
    console.error('Unsupported payload version', { version: payload.version, run_id })
    return new Response(
      JSON.stringify({ error: `Unsupported payload version: ${payload.version}` }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // The email action type is in payload.data.action_type (e.g., "signup", "recovery")
  // payload.type is the hook event type ("auth")
  const emailType = payload.data.action_type
  // デプロイ確認用の目印。View logs にこの文字列が出れば最新コードが本番で動いている。
  console.log('[auth-email-hook build=2026-06-27-ascii-safe-recovery] Received auth event', { emailType, email: payload.data.email, run_id })
  console.log('payload.data keys:', Object.keys(payload.data), 'url:', (payload.data as any).url)


  if (!isAuthEmailType(emailType)) {
    console.error('Unknown email type', { emailType, run_id })
    return new Response(
      JSON.stringify({ error: `Unknown email type: ${emailType}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Build confirmationUrl. For recovery, link DIRECTLY to /reset-password with
  // token_hash so the page can call verifyOtp itself — this works across
  // browsers (no code_verifier required, unlike the PKCE /auth/callback flow).
  // Other email types continue to use /auth/callback.
  let tokenHash = (payload.data as any).token_hash || (payload.data as any).tokenHash || ''
  // token_hash が直接取得できない場合、payload.data.url から抽出を試みる
  if (!tokenHash && (payload.data as any).url) {
    try {
      const parsedUrl = new URL((payload.data as any).url)
      tokenHash = parsedUrl.searchParams.get('token_hash') || parsedUrl.searchParams.get('token') || ''
      if (tokenHash) {
        console.log('token_hash extracted from payload.data.url')
      }
    } catch {
      console.warn('Failed to parse payload.data.url')
    }
  }
  if (!tokenHash) {
    console.error('token_hash not found in payload.data', {
      keys: Object.keys(payload.data),
      hasUrl: !!(payload.data as any).url,
      emailType,
      run_id,
    })
  }

  const redirectTo = (payload.data as any).redirect_to || (payload.data as any).redirectTo || ''
  // パスワード再設定/確認メールのリンク先。本番Webドメインに統一（2026-07）。
  // 従来はプレビュー用の gymboard.lovable.app を指しており本番ドメインと不整合だった。
  // ※デプロイ前提: app.kyoto-salute.com が /reset-password と /auth/callback を配信し、
  //   Supabase Auth の Redirect URLs に https://app.kyoto-salute.com/auth/callback が
  //   登録済みであること（token_hash フローは client 側 verifyOtp で処理）。
  const APP_URL = 'https://app.kyoto-salute.com'
  let confirmationUrl = ''
  if (tokenHash) {
    const params = new URLSearchParams({ token_hash: tokenHash, type: emailType })
    if (emailType === 'recovery') {
      confirmationUrl = `${APP_URL}/reset-password?${params.toString()}`
    } else {
      if (redirectTo) params.set('next', redirectTo)
      confirmationUrl = `${APP_URL}/auth/callback?${params.toString()}`
    }
  } else {
    confirmationUrl = payload.data.url || APP_URL
  }

  // Build template props from payload.data (HookData structure)
  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    recipient: payload.data.email,
    confirmationUrl: confirmationUrl,
    token: payload.data.token,
    email: payload.data.email,
    oldEmail: payload.data.old_email,
    newEmail: payload.data.new_email,
  }

  // 本文の描画。**6種別すべて素の文字列**で作る（React・ストリーミングを通さない）。
  //
  // 以前は recovery だけをここで逃がしていたが、**2026-08 に signup が同じ穴に落ちた**
  // （「お心当たり」の「当」が U+FFFD ×3 になってお客様に届いた／ピラボードが実観測）。
  // 種別ごとに逃がすと必ず取りこぼすので、分岐そのものを無くした。詳細は auth-plain.ts。
  const rawHtml = renderAuthHtml(emailType, templateProps as any)
  const text = renderAuthText(emailType, templateProps as any)
  const html = wrapEmailHtml(rawHtml)

  // Enqueue email for async processing by the dispatcher (process-email-queue).
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const messageId = crypto.randomUUID()

  // Log pending BEFORE enqueue so we have a record even if enqueue crashes
  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: emailType,
    recipient_email: payload.data.email,
    status: 'pending',
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'auth_emails',
    payload: {
      run_id,
      message_id: messageId,
      to: payload.data.email,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: EMAIL_SUBJECTS[emailType] || 'Notification',
      html,
      text,
      purpose: 'transactional',
      label: emailType,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue auth email', { error: enqueueError, run_id, emailType })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: payload.data.email,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Auth email enqueued', { emailType, email: payload.data.email, run_id })

  return new Response(
    JSON.stringify({ success: true, queued: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Handle CORS preflight for main endpoint
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Route to preview handler for /preview path
  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  // Main webhook handler
  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Webhook handler error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
