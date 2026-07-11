import { createClient } from 'npm:@supabase/supabase-js@2'
import { verifyCaller } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Scheduled function: require either the project's service-role key OR the
  // pre-shared CRON_SECRET header so anonymous visitors with the public anon
  // key cannot trigger a mass-email sweep.
  const caller = await verifyCaller(req)
  const cronSecret = Deno.env.get('CRON_SECRET')
  const headerSecret = req.headers.get('x-cron-secret')
  const cronAuthorized = !!cronSecret && headerSecret === cronSecret
  if (!caller?.isServiceRole && !cronAuthorized) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // trial-booking-reminder テンプレートは Salute御所南の住所を本文に固定で含むため、
  // 他テナントのお客様へ誤った住所のリマインドを送らないよう、当面 Salute テナントに限定する
  // (テナント別住所の差し込み対応まで)。
  const SALUTE_TENANT_ID = 'ceda19b0-d5e0-4928-ab2e-996a0b823af4'

  // Compute tomorrow's date in JST
  const jstOffset = 9 * 60 * 60 * 1000
  const jstNow = new Date(Date.now() + jstOffset)
  const tomorrow = new Date(jstNow)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const y = tomorrow.getUTCFullYear()
  const m = String(tomorrow.getUTCMonth() + 1).padStart(2, '0')
  const d = String(tomorrow.getUTCDate()).padStart(2, '0')
  const tomorrowStr = `${y}-${m}-${d}`

  console.log('Checking trial bookings for JST date:', tomorrowStr)

  const { data: bookings, error } = await supabase
    .from('trial_bookings')
    .select('*')
    .eq('tenant_id', SALUTE_TENANT_ID)
    .eq('status', '予約済み')
    .gte('booking_date', `${tomorrowStr}T00:00:00+09:00`)
    .lt('booking_date', `${tomorrowStr}T23:59:59+09:00`)

  if (error) {
    console.error('Failed to fetch trial bookings:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log(`Found ${bookings?.length || 0} trial bookings for tomorrow`)

  let sentCount = 0
  const dowChars = ['日', '月', '火', '水', '木', '金', '土']

  for (const booking of bookings ?? []) {
    const contact = String(booking.guest_contact || '').trim()
    if (!contact.includes('@')) {
      console.log(`Skip non-email contact: ${contact}`)
      continue
    }

    const bd = new Date(booking.booking_date)
    const jstBd = new Date(bd.getTime() + jstOffset)
    const dateStr = `${jstBd.getUTCFullYear()}年${jstBd.getUTCMonth() + 1}月${jstBd.getUTCDate()}日（${dowChars[jstBd.getUTCDay()]}）`
    const timeStr = `${String(jstBd.getUTCHours()).padStart(2, '0')}:${String(jstBd.getUTCMinutes()).padStart(2, '0')}`

    const { error: emailError } = await supabase.functions.invoke('send-transactional-email', {
      body: {
        templateName: 'trial-booking-reminder',
        recipientEmail: contact,
        idempotencyKey: `trial-reminder-${booking.id}-${tomorrowStr}`,
        templateData: {
          guestName: booking.guest_name,
          bookingDate: dateStr,
          bookingTime: timeStr,
          // セルフキャンセルは廃止（メール連絡に一本化）のため cancelUrl は渡さない。
          // テンプレート側は cancelUrl が空ならメール連絡の案内にフォールバックする。
        },
      },
    })

    if (emailError) {
      console.error(`Failed to send reminder to ${contact}:`, emailError)
    } else {
      sentCount++
    }
  }

  return new Response(
    JSON.stringify({ success: true, sent: sentCount, total: bookings?.length ?? 0 }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})