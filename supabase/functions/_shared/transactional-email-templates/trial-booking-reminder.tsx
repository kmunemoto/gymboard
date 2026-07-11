import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Text, Hr, Section, Link, Button,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "パーソナルジムSalute御所南"
const SITE_URL = "https://app.kyoto-salute.com"

// react-email の renderAsync が UTF-8 チャンク境界でマルチバイト文字を分断し
// U+FFFD 化する既知の症状を回避するため、住所と店舗名は ASCII 数値文字参照で描画する。
const toHtmlEntities = (s: string): string =>
  Array.from(s).map((ch) => {
    const cp = ch.codePointAt(0)!
    return cp > 0x7f ? `&#${cp};` : ch
  }).join('')

const SITE_NAME_HTML = toHtmlEntities(SITE_NAME)
const ADDRESS_LINES_HTML = [
  '\u4EAC\u90FD\u5E02\u4E2D\u4EAC\u533A',        // 京都市中京区
  '\u6BD8\u6C99\u9580\u753A533-1',                // 毘沙門町533-1
  '\u30D7\u30E9\u30B6\u5FA1\u6240\u5357 2\u968E', // プラザ御所南 2階
].map(toHtmlEntities)

const AddressBlock = ({ style }: { style: React.CSSProperties }) => (
  <>
    {ADDRESS_LINES_HTML.map((line, i) => (
      <Text key={i} style={style} dangerouslySetInnerHTML={{ __html: line }} />
    ))}
  </>
)


interface Props {
  guestName?: string
  bookingDate?: string
  bookingTime?: string
  cancelUrl?: string
}

const TrialBookingReminderEmail = ({
  guestName = 'お客様',
  bookingDate = '',
  bookingTime = '',
  cancelUrl = '',
}: Props) => (
  <Html lang="ja" dir="ltr">
    <Head>
      <meta charSet="UTF-8" />
      <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
    </Head>
    
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>明日のご予約のお知らせ</Heading>
        <Hr style={hr} />
        <Text style={greeting}>{guestName} 様</Text>
        <Text style={text}>
          明日の初回無料体験のご予約をお知らせいたします。
        </Text>

        <Section style={detailSection}>
          <Text style={sectionTitle}>ご予約内容</Text>
          <Text style={label}>日時</Text>
          <Text style={value}>{bookingDate} {bookingTime}</Text>
          <Text style={label}>内容</Text>
          <Text style={value}>カウンセリング＋トレーニング体験（計60分）</Text>
          <Text style={label}>場所</Text>
          <AddressBlock style={value} />
        </Section>

        <Section style={detailSection}>
          <Text style={sectionTitle}>当日のご案内</Text>
          <Text style={text}>・手ぶらでOK！ウェア・シューズは無料でレンタルできます</Text>
          <Text style={text}>・お水はこちらでご用意しております</Text>
        </Section>

        <Section style={detailSection}>
          <Text style={sectionTitle}>キャンセル・変更</Text>
          {cancelUrl ? (
            <>
              <Text style={text}>ご都合が悪くなった場合は、下記のボタンからキャンセルできます。</Text>
              <Button href={cancelUrl} style={cancelButton}>予約をキャンセルする</Button>
              <Text style={fallbackText}>
                ボタンが押せない場合は、こちらのリンクをブラウザで開いてください。
              </Text>
              <Text style={fallbackText}>
                <Link href={cancelUrl} style={inlineLink}>{cancelUrl}</Link>
              </Text>
            </>
          ) : (
            <>
              <Text style={text}>下記メールへご連絡ください。</Text>
              <Text style={text}>
                <Link href="mailto:k.munemoto@gymboard.app" style={inlineLink}>k.munemoto@gymboard.app</Link>
              </Text>
            </>
          )}
        </Section>

        <Hr style={hr} />
        <Text style={text}>お会いできることを楽しみにしております！</Text>
        <Hr style={hr} />
        <Text style={footer} dangerouslySetInnerHTML={{ __html: SITE_NAME_HTML }} />
        <Text style={footer}>〒604-0981</Text>
        <AddressBlock style={footer} />
        <Link href={SITE_URL} style={footerLink}>{SITE_URL}</Link>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TrialBookingReminderEmail,
  subject: '【明日のご予約】無料体験のリマインド',
  displayName: '初回無料体験 前日リマインド',
  previewData: {
    guestName: '山田 太郎',
    bookingDate: '5月18日（月）',
    bookingTime: '15:00',
    cancelUrl: 'https://app.kyoto-salute.com/trial-cancel/00000000-0000-0000-0000-000000000000',
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
const cancelButton = { backgroundColor: '#40E0D0', color: '#0A3D3B', fontSize: '15px', fontWeight: '700' as const, borderRadius: '8px', padding: '13px 20px', textDecoration: 'none', textAlign: 'center' as const, display: 'block', margin: '8px 0' }
const fallbackText = { fontSize: '12px', color: '#999999', lineHeight: '1.5', margin: '4px 0', wordBreak: 'break-all' as const }