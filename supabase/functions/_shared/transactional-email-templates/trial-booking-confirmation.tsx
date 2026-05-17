import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section, Link,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "パーソナルジムSalute御所南"
const SITE_URL = "https://kyoto-salute.com"
const ADDRESS_LINE_1 = '\u4EAC\u90FD\u5E02\u4E2D\u4EAC\u533A\u6BD8\u6C99\u9580\u753A533-1'
const ADDRESS_LINE_2 = '\u30D7\u30E9\u30B6\u5FA1\u6240\u5357' + '2' + '\u968E'

const AddressLine = ({ style }: { style: React.CSSProperties }) => (
  <Text style={style}>{ADDRESS_LINE_1}</Text>
)

interface TrialBookingConfirmationProps {
  customerName?: string
  bookingDate?: string
  bookingTime?: string
}

const TrialBookingConfirmationEmail = ({
  customerName = 'お客様',
  bookingDate = '',
  bookingTime = '',
}: TrialBookingConfirmationProps) => (
  <Html lang="ja" dir="ltr">
    <Head>
      <meta charSet="UTF-8" />
      <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
    </Head>
    <Preview>初回無料体験のご予約を承りました — {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>初回無料体験のご予約を承りました</Heading>
        <Hr style={hr} />
        <Text style={greeting}>{customerName} 様</Text>
        <Text style={text}>
          この度はパーソナルジム{SITE_NAME}の初回無料体験にご予約いただき、誠にありがとうございます。
        </Text>

        <Section style={detailSection}>
          <Text style={sectionTitle}>ご予約内容</Text>
          <Text style={label}>日時</Text>
          <Text style={value}>{bookingDate} {bookingTime}</Text>
          <Text style={label}>内容</Text>
          <Text style={value}>カウンセリング＋トレーニング体験（計60分）</Text>
          <Text style={label}>場所</Text>
          <AddressLine style={value} />
          <Text style={value}>{ADDRESS_LINE_2}</Text>
        </Section>

        <Section style={detailSection}>
          <Text style={sectionTitle}>当日のご案内</Text>
          <Text style={text}>・動きやすい服装でお越しください</Text>
          <Text style={text}>・室内シューズをご持参ください</Text>
          <Text style={text}>・お水はこちらでご用意しております</Text>
        </Section>

        <Section style={detailSection}>
          <Text style={sectionTitle}>キャンセル・変更</Text>
          <Text style={text}>
            前日までに下記メールへご連絡ください。
          </Text>
          <Text style={text}>
            <Link href="mailto:k.munemoto@kyoto-salute.com" style={inlineLink}>k.munemoto@kyoto-salute.com</Link>
          </Text>
        </Section>

        <Hr style={hr} />
        <Text style={text}>お会いできることを楽しみにしております！</Text>
        <Hr style={hr} />
        <Text style={footer}>パーソナルジム {SITE_NAME}</Text>
        <Text style={footer}>〒604-0862</Text>
        <AddressLine style={footer} />
        <Text style={footer}>{ADDRESS_LINE_2}</Text>
        <Link href={SITE_URL} style={footerLink}>{SITE_URL}</Link>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TrialBookingConfirmationEmail,
  subject: '【パーソナルジムSalute御所南】初回無料体験のご予約を承りました',
  displayName: '初回無料体験 予約確認（顧客向け）',
  previewData: {
    customerName: '山田 太郎',
    bookingDate: '4月15日（火）',
    bookingTime: '14:00〜15:00',
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
const footerLink = { fontSize: '12px', color: '#0ABAB5', textAlign: 'center' as const, display: 'block' }
const inlineLink = { color: '#0ABAB5', textDecoration: 'underline' }