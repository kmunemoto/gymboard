import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section, Link, Button,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const APP_URL = "https://app.kyoto-salute.com"
const SITE_URL = "https://kyoto-salute.com"

interface BookingConfirmationProps {
  customerName?: string
  bookingDate?: string
  bookingTime?: string
  planName?: string
}

const BookingConfirmationEmail = ({
  customerName = 'お客様',
  bookingDate = '',
  bookingTime = '',
  planName = '',
}: BookingConfirmationProps) => (
  <Html lang="ja" dir="ltr">
    <Head />
    <Preview>ご予約を承りました — パーソナルジムSalute御所南</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>ご予約を承りました</Heading>
        <Hr style={hr} />
        <Text style={greeting}>{customerName} 様</Text>
        <Text style={text}>ご予約を承りました。</Text>
        <Section style={detailSection}>
          <Text style={sectionTitle}>📅 ご予約内容</Text>
          <Text style={label}>日時</Text>
          <Text style={value}>{bookingDate} {bookingTime}</Text>
          <Text style={label}>プラン</Text>
          <Text style={value}>{planName}</Text>
        </Section>
        <Section style={detailSection}>
          <Text style={sectionTitle}>キャンセル・変更について</Text>
          <Text style={text}>アプリからキャンセル・変更が可能です。</Text>
          <Button href={APP_URL} style={button}>▼ アプリを開く</Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>パーソナルジムSalute御所南</Text>
        <Text style={footer}>〒604-0862 京都市中京区毘沙門町533-1 プラザ御所南2階</Text>
        <Link href={SITE_URL} style={footerLink}>🌐 {SITE_URL}</Link>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: BookingConfirmationEmail,
  subject: '【パーソナルジムSalute御所南】ご予約を承りました',
  displayName: 'ご予約を承りました（顧客向け）',
  previewData: {
    customerName: '山田 太郎',
    bookingDate: '4月15日（火）',
    bookingTime: '14:00〜15:00',
    planName: '月4回プラン',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', 'Hiragino Sans', sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#000000', margin: '0 0 16px' }
const hr = { borderColor: 'rgba(10, 186, 181, 0.3)', borderTopWidth: '1px', margin: '16px 0' }
const greeting = { fontSize: '15px', color: '#000000', fontWeight: '600' as const, margin: '0 0 8px' }
const text = { fontSize: '14px', color: '#000000', lineHeight: '1.6', margin: '0 0 12px' }
const noteText = { fontSize: '12px', color: '#666666', lineHeight: '1.5', margin: '0 0 8px' }
const detailSection = { margin: '16px 0', padding: '16px', backgroundColor: '#f0fbfb', borderRadius: '8px' }
const sectionTitle = { fontSize: '14px', fontWeight: '700' as const, color: '#0ABAB5', margin: '0 0 12px' }
const label = { fontSize: '11px', fontWeight: '600' as const, color: '#0ABAB5', textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '8px 0 2px' }
const value = { fontSize: '15px', color: '#000000', margin: '0 0 4px', fontWeight: '500' as const }
const footer = { fontSize: '12px', color: '#999999', margin: '16px 0 4px', lineHeight: '1.5', textAlign: 'center' as const }
const footerLink = { fontSize: '12px', color: '#0ABAB5', textAlign: 'center' as const, display: 'block' }
const button = { backgroundColor: '#0ABAB5', color: '#ffffff', padding: '12px 20px', borderRadius: '6px', textDecoration: 'none', display: 'inline-block', fontSize: '14px', fontWeight: '600' as const, marginTop: '8px' }
