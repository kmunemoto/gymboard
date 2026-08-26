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

  // 以前は trial-booking-reminder テンプレートに Salute御所南の住所が固定で入っていたため、
  // 誤った住所を送らないようテナントを限定していた。その結果、他ジムのお客様には前日リマインドが
  // 一切届いていなかった。テンプレートをジム情報の差し込み式にしたので、全ジムへ送る（2026-07）。
  //
  // ⚠️ このIDは**設備案内（手ぶらOK・ウェア無料レンタル・お水）を出すかどうか**だけに使う。
  //    その設備は Salute御所南のもので、他ジムに当てはまるとは限らないため。
  //    2026-08-08 まで「初回無料体験」の呼称の出し分けも兼ねていたが、
  //    **体験の有料化で呼称の分岐は廃止した**（金額は tenants.trial_price_yen から出す）。
  //    将来ジムごとに設定させるなら tenants.trial_info_body の流用が候補。
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
    .eq('status', '予約済み')
    // ドロップイン予約(booking_kind='drop_in')はこの日本語・無料体験向けリマインドの対象外。
    // 英語圏の観光客に無関係な文面が届くのを防ぐ(drop-in-book はリマインドを別途送らない)。
    .eq('booking_kind', 'trial')
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

  // 予約に紐づくジムの情報（名前・住所・連絡先・サイト）をまとめて1回で引き、
  // メール本文にそのジムの情報を差し込む。予約1件ごとに問い合わせない。
  const tenantIds = [...new Set((bookings ?? []).map((b: any) => b.tenant_id).filter(Boolean))]
  const tenantMap = new Map<string, { gym_name: string | null; address: string | null; email: string | null; website_url: string | null; trial_price_yen: number | null }>()
  if (tenantIds.length > 0) {
    const { data: tenantRows, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, gym_name, address, email, website_url, trial_price_yen, reminder_email_note, trial_email_cancel_note')
      .in('id', tenantIds)
    if (tenantErr) console.error('Failed to fetch tenants for reminder:', tenantErr)
    for (const row of tenantRows ?? []) {
      tenantMap.set((row as any).id, row as any)
    }
  }

  let sentCount = 0
  const dowChars = ['日', '月', '火', '水', '木', '金', '土']

  for (const booking of bookings ?? []) {
    const contact = String(booking.guest_contact || '').trim()
    if (!contact.includes('@')) {
      console.log(`Skip non-email contact: ${contact}`)
      continue
    }

    const tenant = tenantMap.get(booking.tenant_id as string)

    const bd = new Date(booking.booking_date)
    const jstBd = new Date(bd.getTime() + jstOffset)
    const dateStr = `${jstBd.getUTCFullYear()}年${jstBd.getUTCMonth() + 1}月${jstBd.getUTCDate()}日（${dowChars[jstBd.getUTCDay()]}）`
    const timeStr = `${String(jstBd.getUTCHours()).padStart(2, '0')}:${String(jstBd.getUTCMinutes()).padStart(2, '0')}`

    const { error: emailError } = await supabase.functions.invoke('send-transactional-email', {
      body: {
        templateName: 'trial-booking-reminder',
        recipientEmail: contact,
        tenantId: booking.tenant_id,
        idempotencyKey: `trial-reminder-${booking.id}-${tomorrowStr}`,
        templateData: {
          guestName: booking.guest_name,
          bookingDate: dateStr,
          bookingTime: timeStr,
          gymName: tenant?.gym_name || 'ジム',
          gymAddress: (tenant?.address ?? '').trim(),
          gymContactEmail: (tenant?.email ?? '').trim(),
          gymWebsiteUrl: (tenant?.website_url ?? '').trim(),
          // 金額はジムごとの設定。未設定なら料金行は出ない。
          trialPriceYen: tenant?.trial_price_yen ?? null,
          // 設備案内（手ぶらOK）は Salute の設備なのでこのジムだけ。呼称・料金とは無関係。
          showAmenities: booking.tenant_id === SALUTE_TENANT_ID,
          // リマインドに足す、店からのご案内。空/未設定ならブロックごと出さない。
          gymNote: ((tenant?.reminder_email_note as string | null | undefined) ?? '').trim() || null,
          // 「キャンセル・変更」欄の文章（確認メールと共用）。設定されていればこの文章だけが出る。
          cancelNote: ((tenant?.trial_email_cancel_note as string | null | undefined) ?? '').trim() || null,
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