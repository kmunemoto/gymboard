// 体験予約の前日リマインド（毎晩 21:10 JST の cron「send-trial-reminders-daily」から呼ばれる）。
//
// 🔴 2026-11-10 まで、一度も送れていなかった。送信を supabase.functions.invoke で頼んでいたが、本番の service_role の
//    鍵（sb_secret_… の形式）を新しい supabase-js が Authorization に載せないので、send-transactional-email が
//    401 で断り、送信履歴にも何も残らなかった（../_shared/invokeAsService.ts）。いまは fetch で鍵を付けて頼む。
//
// 守り（2026-11-10 定期点検 send-trial-reminders-1・send-trial-reminders-log-1）:
// - 宛先・日時は予約を作ったときの値（trial_bookings の門番 guard_trial_booking_update が、画面からの書き換えを止める。
//   以前はオーナーが API で宛先・日時を書き換えて、このリマインドを好きなアドレスへの中継に使えた）
// - 1回（＝1日）に1つのジムから60通・同じ宛先へ3通まで（送る時にも数える）
// - trial-booking-reminder は「必ず届けるメール」から外した（配信停止した人には送らない）
// - ログにお客様の連絡先を平文で出さない（maskEmail と予約の id だけ）
// - 明日の体験予約を1000件ずつに区切って全部読む（1回で読める上限の外に、他のジムの予約が落ちない）

import { createClient } from 'npm:@supabase/supabase-js@2'
import { verifyCaller } from '../_shared/auth.ts'
import { invokeAsService } from '../_shared/invokeAsService.ts'
import { maskEmail } from '../_shared/logSafety.ts'
import { canonicalEmail } from '../_shared/emailQuota.ts'

// どの版が動いているかを外から確かめるための印（全部の応答に付く。中身は日付だけ）。mem/ops/edge-function-deploy.md
const BUILD = '2026-11-10-reminder-fix'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'x-gymboard-build': BUILD,
}

/** 1回（＝1日）に1つのジムから送るリマインドの上限（体験予約の受付も1つのジムで24時間60件まで） */
const MAX_PER_TENANT_PER_RUN = 60
/** 1回（＝1日）に同じ宛先へ送るリマインドの上限（同じ日に2つの体験を取る人はいる） */
const MAX_PER_RECIPIENT_PER_RUN = 3
/** 一度に読む行数（PostgREST の既定の上限 1000 より小さく） */
const PAGE = 500

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

  // 明日の体験予約を全部読む（並びを決めて区切る。区切らないと1000件で切れ、並びも決まらない）
  // deno-lint-ignore no-explicit-any
  const bookings: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('trial_bookings')
      .select('*')
      .eq('status', '予約済み')
      // ドロップイン予約(booking_kind='drop_in')はこの日本語・無料体験向けリマインドの対象外。
      // 英語圏の観光客に無関係な文面が届くのを防ぐ(drop-in-book はリマインドを別途送らない)。
      .eq('booking_kind', 'trial')
      .gte('booking_date', `${tomorrowStr}T00:00:00+09:00`)
      .lt('booking_date', `${tomorrowStr}T23:59:59+09:00`)
      .order('booking_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) {
      console.error('Failed to fetch trial bookings:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    bookings.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  console.log(`Found ${bookings.length} trial bookings for tomorrow`)

  // 予約に紐づくジムの情報（名前・住所・連絡先・サイト）をまとめて1回で引き、
  // メール本文にそのジムの情報を差し込む。予約1件ごとに問い合わせない。
  const tenantIds = [...new Set(bookings.map((b: any) => b.tenant_id).filter(Boolean))]
  const tenantMap = new Map<string, { gym_name: string | null; address: string | null; email: string | null; website_url: string | null; trial_price_yen: number | null; reminder_email_note: string | null; trial_email_cancel_note: string | null }>()
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

  // メニューの体験（例: マシンピラティス）は、メニューの名前と料金で書く（2026-10-31・trial-book と同じ）
  const menuIds = [...new Set(bookings.map((b: any) => b.menu_id).filter(Boolean))]
  const menuMap = new Map<string, { name: string; trial_price_yen: number | null }>()
  if (menuIds.length > 0) {
    const { data: menuRows, error: menuErr } = await supabase
      .from('booking_menus')
      .select('id, name, trial_price_yen')
      .in('id', menuIds)
    if (menuErr) console.error('Failed to fetch menus for reminder:', menuErr)
    for (const row of menuRows ?? []) {
      menuMap.set((row as any).id, row as any)
    }
  }

  let sentCount = 0
  let suppressedCount = 0
  let failedCount = 0
  const skipped = { nonEmail: 0, tenantCap: 0, recipientCap: 0 }
  const perTenant = new Map<string, number>()
  const perRecipient = new Map<string, number>()
  const dowChars = ['日', '月', '火', '水', '木', '金', '土']

  for (const booking of bookings) {
    const contact = String(booking.guest_contact || '').trim()
    if (!contact.includes('@')) {
      // 連絡先の中身は出さない（予約の id だけ）
      skipped.nonEmail++
      console.log(`Skip non-email contact (booking ${booking.id})`)
      continue
    }
    // 送る時にも数える（1つのジムから・同じ宛先へ、1日に送りすぎない）
    const tenantKey = String(booking.tenant_id ?? '')
    const tenantSent = perTenant.get(tenantKey) ?? 0
    if (tenantSent >= MAX_PER_TENANT_PER_RUN) {
      skipped.tenantCap++
      continue
    }
    const recipient = canonicalEmail(contact)
    const recipientSent = perRecipient.get(recipient) ?? 0
    if (recipientSent >= MAX_PER_RECIPIENT_PER_RUN) {
      skipped.recipientCap++
      continue
    }
    perTenant.set(tenantKey, tenantSent + 1)
    perRecipient.set(recipient, recipientSent + 1)

    const tenant = tenantMap.get(booking.tenant_id as string)
    const menu = booking.menu_id ? menuMap.get(booking.menu_id as string) ?? null : null

    const bd = new Date(booking.booking_date)
    const jstBd = new Date(bd.getTime() + jstOffset)
    const dateStr = `${jstBd.getUTCFullYear()}年${jstBd.getUTCMonth() + 1}月${jstBd.getUTCDate()}日（${dowChars[jstBd.getUTCDay()]}）`
    const timeStr = `${String(jstBd.getUTCHours()).padStart(2, '0')}:${String(jstBd.getUTCMinutes()).padStart(2, '0')}`

    // 🔴 supabase.functions.invoke は使わない（鍵が載らず 401 になる。../_shared/invokeAsService.ts）
    const result = await invokeAsService('send-transactional-email', {
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
        // 金額はジムごとの設定。未設定なら料金行は出ない。メニューの体験はメニューの料金
        trialPriceYen: booking.menu_id ? (menu?.trial_price_yen ?? null) : (tenant?.trial_price_yen ?? null),
        // メニューの体験はメニューの名前で呼ぶ（「マシンピラティスの体験」）。null はトレーニングの体験
        menuName: menu?.name ?? null,
        // 設備案内（手ぶらOK）は Salute の設備なのでこのジムだけ。呼称・料金とは無関係。
        showAmenities: booking.tenant_id === SALUTE_TENANT_ID,
        // リマインドに足す、店からのご案内。空/未設定ならブロックごと出さない。
        gymNote: ((tenant?.reminder_email_note as string | null | undefined) ?? '').trim() || null,
        // 「キャンセル・変更」欄の文章（確認メールと共用）。設定されていればこの文章だけが出る。
        cancelNote: ((tenant?.trial_email_cancel_note as string | null | undefined) ?? '').trim() || null,
        // セルフキャンセルは廃止（メール連絡に一本化）のため cancelUrl は渡さない。
        // テンプレート側は cancelUrl が空ならメール連絡の案内にフォールバックする。
      },
    })

    const payload = result.data as { success?: boolean; reason?: string } | null
    if (result.error) {
      failedCount++
      console.error(`Failed to send reminder (booking ${booking.id}, to ${maskEmail(contact)}): ${result.error}`)
    } else if (payload?.success === false) {
      // 配信停止の宛先（リマインドは必ず届けるメールではない）
      suppressedCount++
    } else {
      sentCount++
    }
  }

  if (skipped.nonEmail + skipped.tenantCap + skipped.recipientCap > 0) {
    console.warn('Skipped trial reminders', skipped)
  }

  return new Response(
    JSON.stringify({
      success: true,
      sent: sentCount,
      suppressed: suppressedCount,
      failed: failedCount,
      skipped,
      total: bookings.length,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})