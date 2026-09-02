import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section, Link, Button,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { GymNoteSection } from './gym-note.tsx'

/**
 * 店が既にある予約のオプション（例: トレーニング後の30分ストレッチ）を
 * 追加・変更・削除したときに、**お客様へ**出すお知らせ。
 *
 * ## なぜ要るか
 *
 * 追加は店側からの操作なので、何も出さないと**お客様は終了時刻が変わったことを
 * 知らないまま**になる。逆に「勝手に付けられた」とも見える。
 * どちらも困るので、変わった内容と新しい時間帯をそのまま出す。
 *
 * 🔴 プッシュだけにしない。プッシュを許可していないお客様には何も届かないので、
 *    メールが唯一の控えになる（キャンセル通知と同じ考え方）。
 *
 * 外したときは `options` が空で届く。そのときは「オプションはございません」ではなく
 * **「オプションの予約を取り消しました」**と、何が起きたかを書く。
 */

const SITE_NAME = 'ジムボード'
const APP_URL = 'https://app.kyoto-salute.com'
const SITE_URL = 'https://gymboard.app'

interface BookingOptionChangedProps {
  customerName?: string
  bookingDate?: string
  /** 変更後の時間帯（例: 10:00〜11:30）。オプションを足したぶんだけ後ろに伸びる。 */
  bookingTime?: string
  planName?: string
  /** 変更後に付いているオプション。空＝すべて外した。 */
  options?: { name?: string; duration_minutes?: number; price_yen?: number }[]
  gymName?: string
  gymNote?: string | null
}

const BookingOptionChangedEmail = ({
  customerName = 'お客様',
  bookingDate = '',
  bookingTime = '',
  planName = '',
  options = [],
  gymNote = null,
}: BookingOptionChangedProps) => {
  const removed = options.length === 0
  const heading = removed
    ? 'ご予約のオプションを取り消しました'
    : 'ご予約のオプションが変わりました'

  return (
    <Html lang="ja" dir="ltr">
      <Head>
        <meta charSet="UTF-8" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      </Head>
      <Preview>{heading} — {SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{heading}</Heading>
          <Hr style={hr} />
          <Text style={text}>
            {`${customerName} 様\n\n以下のとおり、ご予約の内容を変更いたしました。`}
          </Text>
          <Section style={detailSection}>
            <Text style={label}>日時</Text>
            <Text style={value}>{bookingDate} {bookingTime}</Text>
            {planName && (
              <>
                <Text style={label}>プラン</Text>
                <Text style={value}>{planName}</Text>
              </>
            )}
            <Text style={label}>オプション</Text>
            {removed ? (
              <Text style={value}>取り消しました</Text>
            ) : (
              options.map((o, i) => (
                <Text key={i} style={value}>
                  {o.name}
                  {typeof o.duration_minutes === 'number' && o.duration_minutes > 0
                    ? `（+${o.duration_minutes}分）` : ''}
                  {typeof o.price_yen === 'number' && o.price_yen > 0
                    ? ` ¥${o.price_yen.toLocaleString('ja-JP')}` : ''}
                </Text>
              ))
            )}
          </Section>
          {!removed && (
            <Section style={detailSection}>
              <Text style={noticeText}>
                ※オプションのお時間はトレーニングに続けて行うため、終了時刻が変わっています。
              </Text>
            </Section>
          )}
          <GymNoteSection note={gymNote} />
          <Section style={detailSection}>
            <Text style={text}>{'ご不明な点はお店までお問い合わせください。'}</Text>
            <Button href={APP_URL} style={button}>▼ アプリを開く</Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>ジムボード</Text>
          <Link href={SITE_URL} style={footerLink}>{SITE_URL}</Link>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: BookingOptionChangedEmail,
  subject: (data: Record<string, any>) =>
    (Array.isArray(data?.options) && data.options.length === 0)
      ? '【ジムボード】ご予約のオプションを取り消しました'
      : '【ジムボード】ご予約のオプションが変わりました',
  displayName: '予約オプションの変更通知',
  previewData: {
    customerName: '山田 太郎',
    bookingDate: '4月15日（火）',
    bookingTime: '14:00〜15:30',
    planName: '月4回プラン',
    options: [{ name: 'ストレッチ', duration_minutes: 30, price_yen: 3000 }],
    gymNote: null,
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', 'Hiragino Sans', sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#000000', margin: '0 0 16px' }
const hr = { borderColor: 'rgba(10, 186, 181, 0.3)', borderTopWidth: '1px', margin: '16px 0' }
const text = { fontSize: '14px', color: '#000000', lineHeight: '1.6', margin: '0 0 12px', whiteSpace: 'pre-line' as const }
const detailSection = { margin: '8px 0' }
const label = { fontSize: '11px', fontWeight: '600' as const, color: '#0ABAB5', textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '12px 0 2px' }
const value = { fontSize: '15px', color: '#000000', margin: '0 0 4px', fontWeight: '500' as const }
const noticeText = { fontSize: '13px', color: '#997404', backgroundColor: '#fff8e6', borderRadius: '6px', padding: '10px 12px', margin: '0', lineHeight: '1.6' }
const footer = { fontSize: '11px', color: '#999999', margin: '28px 0 0', lineHeight: '1.5' }
const footerLink = { fontSize: '12px', color: '#0ABAB5', textAlign: 'center' as const, display: 'block' }
const button = { backgroundColor: '#0ABAB5', color: '#ffffff', padding: '12px 20px', borderRadius: '6px', textDecoration: 'none', display: 'inline-block', fontSize: '14px', fontWeight: '600' as const, marginTop: '8px' }
