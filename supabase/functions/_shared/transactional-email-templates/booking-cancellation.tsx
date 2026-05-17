import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section, Link, Button,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "パーソナルジムSalute御所南"
const APP_URL = "https://app.kyoto-salute.com"
const SITE_URL = "https://kyoto-salute.com"
const NEW_BOOKING_GUIDANCE = "新しいご予約\u306Fアプリから承っております。"

interface BookingCancellationProps {
  customerName?: string
  bookingDate?: string
  bookingTime?: string
  planName?: string
  recipientRole?: 'trainer' | 'customer'
  cancelledByTrainer?: boolean
  isTrial?: boolean
}

const BookingCancellationEmail = ({
  customerName = 'お客様',
  bookingDate = '',
  bookingTime = '',
  planName = '',
  recipientRole = 'trainer',
  cancelledByTrainer = false,
  isTrial = false,
}: BookingCancellationProps) => {
  const heading = recipientRole === 'trainer'
    ? (isTrial ? '初回無料体験の予約がキャンセルされました' : '予約がキャンセルされました')
    : 'キャンセルを受け付けました'

  const intro = recipientRole === 'trainer'
    ? (cancelledByTrainer
        ? '以下の予約をキャンセルしました。'
        : `${customerName}様より、以下のご予約のキャンセルがありました。`)
    : `${customerName} 様\n\n以下のご予約のキャンセルを受け付けました。`

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
          <Text style={text}>{intro}</Text>
          <Section style={detailSection}>
            {recipientRole === 'customer' && (
              <Text style={sectionTitle}>📅 キャンセルした予約</Text>
            )}
            <Text style={label}>お名前</Text>
            <Text style={value}>{customerName}</Text>
            <Text style={label}>日時</Text>
            <Text style={value}>{bookingDate} {bookingTime}</Text>
            {planName && (
              <>
                <Text style={label}>プラン</Text>
                <Text style={value}>{planName}</Text>
              </>
            )}
          </Section>
          {recipientRole === 'customer' && (
            <Section style={detailSection}>
              <Text style={text}>{NEW_BOOKING_GUIDANCE}</Text>
              <Button href={APP_URL} style={button}>▼ アプリを開く</Button>
            </Section>
          )}
          <Hr style={hr} />
          {recipientRole === 'customer' ? (
            <>
              <Text style={footer}>パーソナルジムSalute御所南</Text>
              <Text style={footer}>〒604-0862 京都市中京区毘沙門町533-1 プラザ御所南2階</Text>
              <Link href={SITE_URL} style={footerLink}>🌐 {SITE_URL}</Link>
            </>
          ) : (
            <Text style={footer}>
              このメールは{SITE_NAME}の予約システムから自動送信されています。
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: BookingCancellationEmail,
  subject: (data: Record<string, any>) =>
    data?.recipientRole === 'customer'
      ? '【パーソナルジムSalute御所南】キャンセルを受け付けました'
      : (data?.isTrial
          ? '【パーソナルジムSalute御所南】初回無料体験の予約がキャンセルされました'
          : '【パーソナルジムSalute御所南】予約がキャンセルされました'),
  displayName: '予約キャンセル通知',
  previewData: {
    customerName: '山田 太郎',
    bookingDate: '4月15日（火）',
    bookingTime: '14:00〜15:00',
    planName: '月4回プラン',
    recipientRole: 'trainer',
    cancelledByTrainer: false,
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', 'Hiragino Sans', sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#000000', margin: '0 0 16px' }
const hr = { borderColor: 'rgba(10, 186, 181, 0.3)', borderTopWidth: '1px', margin: '16px 0' }
const text = { fontSize: '14px', color: '#000000', lineHeight: '1.6', margin: '0 0 12px', whiteSpace: 'pre-line' as const }
const detailSection = { margin: '8px 0' }
const sectionTitle = { fontSize: '14px', fontWeight: '700' as const, color: '#0ABAB5', margin: '0 0 12px' }
const label = { fontSize: '11px', fontWeight: '600' as const, color: '#0ABAB5', textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '12px 0 2px' }
const value = { fontSize: '15px', color: '#000000', margin: '0 0 4px', fontWeight: '500' as const }
const footer = { fontSize: '11px', color: '#999999', margin: '28px 0 0', lineHeight: '1.5' }
const footerLink = { fontSize: '12px', color: '#0ABAB5', textAlign: 'center' as const, display: 'block' }
const button = { backgroundColor: '#0ABAB5', color: '#ffffff', padding: '12px 20px', borderRadius: '6px', textDecoration: 'none', display: 'inline-block', fontSize: '14px', fontWeight: '600' as const, marginTop: '8px' }