import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { GymNoteSection } from './gym-note.tsx'

const SITE_NAME = "ジムボード"

interface Props {
  customerName?: string
  bookingDate?: string
  bookingTimes?: string
  planName?: string
  gymName?: string
  /** リマインドメールに足す、店からのご案内（tenants.reminder_email_note）。空なら何も出さない。 */
  gymNote?: string | null
}

const BookingReminderEmail = ({
  customerName = 'お客様',
  bookingDate = '',
  bookingTimes = '',
  planName = '',
  gymName = '',
  gymNote = null,
}: Props) => (
  <Html lang="ja" dir="ltr">
    <Head>
      <meta charSet="UTF-8" />
      <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
    </Head>
    <Preview>明日のご予約のリマインド — {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>明日のご予約のリマインド</Heading>
        <Hr style={hr} />
        <Text style={greeting}>{customerName} 様</Text>
        <Text style={text}>
          いつもご利用いただきありがとうございます。
        </Text>
        <Text style={text}>
          明日のトレーニングのご予約をお知らせいたします。
        </Text>

        <Section style={detailSection}>
          <Text style={sectionTitle}>ご予約内容</Text>
          <Text style={label}>日付</Text>
          <Text style={value}>{bookingDate}</Text>
          <Text style={label}>時刻</Text>
          <Text style={value}>{bookingTimes}</Text>
          {planName ? (
            <>
              <Text style={label}>プラン</Text>
              <Text style={value}>{planName}</Text>
            </>
          ) : null}
          {gymName ? (
            <>
              <Text style={label}>店舗</Text>
              <Text style={value}>{gymName}</Text>
            </>
          ) : null}
        </Section>

        <Text style={text}>
          お気をつけてお越しください。お会いできることを楽しみにしております。
        </Text>

        <GymNoteSection note={gymNote} />
        <Hr style={hr} />
        <Text style={footer}>{SITE_NAME}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: BookingReminderEmail,
  subject: '【明日のご予約】トレーニングのリマインド',
  displayName: '通常予約 前日リマインド',
  to: '_resolve_user_',
  previewData: {
    gymNote: 'お飲み物はこちらでご用意しています。',
    customerName: '山田 太郎',
    bookingDate: '5月30日（土）',
    bookingTimes: '10:00、14:00',
    planName: '月4回プラン',
    gymName: 'サンプルジム',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', 'Hiragino Sans', sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#000000', margin: '0 0 16px' }
const hr = { borderColor: 'rgba(10, 186, 181, 0.3)', borderTopWidth: '1px', margin: '16px 0' }
const greeting = { fontSize: '15px', color: '#000000', fontWeight: '600' as const, margin: '0 0 8px' }
const text = { fontSize: '14px', color: '#000000', lineHeight: '1.6', margin: '0 0 8px' }
const detailSection = { margin: '16px 0', padding: '16px', backgroundColor: '#f0fbfb', borderRadius: '8px' }
const sectionTitle = { fontSize: '14px', fontWeight: '700' as const, color: '#0ABAB5', margin: '0 0 12px' }
const label = { fontSize: '11px', fontWeight: '600' as const, color: '#0ABAB5', textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '8px 0 2px' }
const value = { fontSize: '15px', color: '#000000', margin: '0 0 4px', fontWeight: '500' as const }
const footer = { fontSize: '12px', color: '#999999', margin: '4px 0', lineHeight: '1.5', textAlign: 'center' as const }
