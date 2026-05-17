import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "パーソナルジムSalute御所南"

interface NewBookingNotificationProps {
  customerName?: string
  bookingDate?: string
  bookingTime?: string
  planName?: string
  dashboardUrl?: string
}

const NewBookingNotificationEmail = ({
  customerName = 'お客様',
  bookingDate = '',
  bookingTime = '',
  planName = '',
  dashboardUrl = '',
}: NewBookingNotificationProps) => (
  <Html lang="ja" dir="ltr">
    <Head />
    <Preview>新しい予約が入りました — {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>新しい予約が入りました</Heading>
        <Hr style={hr} />
        <Section style={detailSection}>
          <Text style={label}>お名前</Text>
          <Text style={value}>{customerName}</Text>
          <Text style={label}>日時</Text>
          <Text style={value}>{bookingDate} {bookingTime}</Text>
          <Text style={label}>プラン</Text>
          <Text style={value}>{planName}</Text>
        </Section>
        <Hr style={hr} />
        {dashboardUrl && (
          <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
            <Button style={button} href={dashboardUrl}>
              アプリを開いて詳細を確認
            </Button>
          </Section>
        )}
        <Text style={footer}>
          このメールは{SITE_NAME}の予約システムから自動送信されています。
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: NewBookingNotificationEmail,
  subject: '【パーソナルジムSalute御所南】新しい予約が入りました',
  displayName: '新規予約通知（トレーナー向け）',
  previewData: {
    customerName: '山田 太郎',
    bookingDate: '4月15日（火）',
    bookingTime: '14:00〜15:00',
    planName: '月4回プラン',
    dashboardUrl: 'https://app.kyoto-salute.com',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', 'Hiragino Sans', sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#000000', margin: '0 0 16px' }
const hr = { borderColor: 'rgba(10, 186, 181, 0.3)', borderTopWidth: '1px', margin: '16px 0' }
const detailSection = { margin: '8px 0' }
const label = { fontSize: '11px', fontWeight: '600' as const, color: '#0ABAB5', textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '12px 0 2px' }
const value = { fontSize: '15px', color: '#000000', margin: '0 0 4px', fontWeight: '500' as const }
const button = {
  backgroundColor: '#0ABAB5',
  color: '#ffffff',
  padding: '12px 28px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: '600' as const,
  textDecoration: 'none',
}
const footer = { fontSize: '11px', color: '#999999', margin: '28px 0 0', lineHeight: '1.5' }
