import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'
import { escapeNonAsciiToEntities } from '../_shared/email-encoding.ts'

// Configuration baked in at scaffold time — do NOT change these manually.
// To update, re-run the email domain setup flow.
const SITE_NAME = "パーソナルジムSalute御所南"
// SENDER_DOMAIN is the verified sender subdomain FQDN (e.g., "notify.example.com").
// It MUST match the subdomain delegated to Lovable's nameservers — never the root domain.
// The email API looks up this exact domain; a mismatch causes "No email domain record found".
const SENDER_DOMAIN = "notify.kyoto-salute.com"
// FROM_DOMAIN is the domain shown in the From: header (e.g., "example.com").
// When display_from_root is enabled, this can be the root domain for cleaner branding,
// even though actual sending uses the subdomain above.
const FROM_DOMAIN = "kyoto-salute.com"

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
import { verifyCaller, hasRole } from '../_shared/auth.ts'

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

  // Trainers and service role may invoke any template. Authenticated customers
  // may only invoke booking-related templates, and only when the target is
  // either themselves or a verified trainer (prevents spam/phishing via
  // arbitrary recipient or _resolve_*_ placeholders).
  const callerIsTrainer = caller.userId ? await hasRole(caller.userId, 'trainer') : false
  const CUSTOMER_ALLOWED_TEMPLATES = new Set([
    'booking-confirmation',
    'booking-cancellation',
    'new-booking-notification',
  ])
  let peekedBody: any = null
  if (!caller.isServiceRole && !callerIsTrainer) {
    try { peekedBody = await req.clone().json() } catch { /* ignore */ }
    const tn: string = peekedBody?.templateName || peekedBody?.template_name || ''
    const td: any = peekedBody?.templateData || {}
    const recip: string = peekedBody?.recipientEmail || peekedBody?.recipient_email || ''
    let ok = false
    if (CUSTOMER_ALLOWED_TEMPLATES.has(tn)) {
      if (tn === 'new-booking-notification') {
        ok = recip === '_resolve_trainer_'
          && typeof td.trainerUserId === 'string'
          && await hasRole(td.trainerUserId, 'trainer')
      } else if (recip === '_resolve_trainer_') {
        // Customers may notify a verified trainer on booking-confirmation /
        // booking-cancellation (e.g. customer-initiated cancellation).
        ok = typeof td.trainerUserId === 'string'
          && await hasRole(td.trainerUserId, 'trainer')
      } else {
        const callerEmail = (caller as any).email as string | undefined
        ok = (typeof td.resolveUserId === 'string' && td.resolveUserId === caller.userId)
          || (typeof recip === 'string' && !!callerEmail && recip.toLowerCase() === callerEmail.toLowerCase())
      }
    }
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
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

  // Parse request body
  let templateName: string
  let recipientEmail: string
  let idempotencyKey: string
  let messageId: string
  let templateData: Record<string, any> = {}
  try {
    const body = await req.json()
    templateName = body.templateName || body.template_name
    recipientEmail = body.recipientEmail || body.recipient_email
    messageId = crypto.randomUUID()
    idempotencyKey = body.idempotencyKey || body.idempotency_key || messageId
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
      return new Response(
        JSON.stringify({ error: 'Could not resolve user email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  if (!effectiveRecipient || effectiveRecipient === '_resolve_trainer_' || effectiveRecipient === '_resolve_user_') {
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

  // 4. Render React Email template to HTML and plain text
  // pretty:true で改行を入れて、SMTPの固定バイト幅折り返しが
  // マルチバイトUTF-8文字の途中に入り文字化けする問題を回避する。
  // さらに非ASCII文字をHTML数値文字参照に変換して二重に保護する
  // （auth-email-hook と同等）。
  const rawHtml = await renderAsync(
    React.createElement(template.component, templateData),
    { pretty: true }
  )
  const html = escapeNonAsciiToEntities(rawHtml)
  const plainText = await renderAsync(
    React.createElement(template.component, templateData),
    { plainText: true }
  )


  // Resolve subject — supports static string or dynamic function
  const resolvedSubject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  // 5. Enqueue the pre-rendered email for async processing by the dispatcher.
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
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
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
