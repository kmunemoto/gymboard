import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Text, Hr, Section, Link, Button,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

// 以前はジム名・住所・連絡先が Salute御所南 で固定されていたため、他ジムのお客様に
// 送ると「別のジムの住所」が書かれたメールになってしまい、送信側(send-trial-reminders)を
// Salute テナント限定にせざるを得なかった。その結果、他ジムのお客様には前日リマインドが
// 一切届いていなかった。trial-booking-confirmation と同じく、ジム情報を差し込む形にして
// 全ジムへ送れるようにしている（2026-07）。

// react-email の renderAsync が UTF-8 チャンク境界でマルチバイト文字を分断し
// U+FFFD 化する既知の症状を回避するため、本文テキストは ASCII 数値文字参照で描画する。
// ジム名・住所などの動的値も必ずこのエンコードを通す。
const toHtmlEntities = (s: string): string =>
  Array.from(s).map((ch) => {
    const cp = ch.codePointAt(0)!
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    if (ch === '"') return '&quot;'
    if (ch === "'") return '&#39;'
    return cp > 0x7f ? `&#${cp};` : ch
  }).join('')

const SafeText = ({ style, children }: { style: React.CSSProperties; children: string }) => (
  <Text style={style} dangerouslySetInnerHTML={{ __html: toHtmlEntities(children) }} />
)

const SafeHeading = ({ style, children }: { style: React.CSSProperties; children: string }) => (
  <Heading style={style} dangerouslySetInnerHTML={{ __html: toHtmlEntities(children) }} />
)

const SafeInlineText = ({ children }: { children: string }) => (
  <span dangerouslySetInnerHTML={{ __html: toHtmlEntities(children) }} />
)

// 住所テキスト（DB の tenants.address は自由文の1カラム）を行ごとに分割して表示する。
// 空なら場所ブロック自体を省く。
const splitAddressLines = (address: string): string[] =>
  address.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)

const AddressBlock = ({ style, lines }: { style: React.CSSProperties; lines: string[] }) => (
  <>
    {lines.map((line, i) => (
      <SafeText key={i} style={style}>{line}</SafeText>
    ))}
  </>
)

interface Props {
  guestName?: string
  bookingDate?: string
  bookingTime?: string
  cancelUrl?: string
  gymName?: string
  gymAddress?: string
  gymContactEmail?: string
  gymWebsiteUrl?: string
  // 「初回無料体験」の名称で運用するジム（Salute御所南）だけ true。呼び出し側が渡す。
  // 確認メール(trial-booking-confirmation)と同じ判定・同じ表記に揃えている。
  isFreeTrial?: boolean
}

const TrialBookingReminderEmail = ({
  guestName = 'お客様',
  bookingDate = '',
  bookingTime = '',
  cancelUrl = '',
  gymName = 'ジム',
  gymAddress = '',
  gymContactEmail = '',
  gymWebsiteUrl = '',
  isFreeTrial = false,
}: Props) => {
  const addressLines = splitAddressLines(gymAddress)
  const trialName = isFreeTrial ? '初回無料体験' : '体験'
  const contentValue = isFreeTrial
    ? '初回無料体験（カウンセリング＋トレーニング 計60分）'
    : 'カウンセリング＋トレーニング体験（計60分）'
  return (
    <Html lang="ja" dir="ltr">
      <Head>
        <meta charSet="UTF-8" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      </Head>

      <Body style={main}>
        <Container style={container}>
          <SafeHeading style={h1}>明日のご予約のお知らせ</SafeHeading>
          <Hr style={hr} />
          <SafeText style={greeting}>{`${guestName} 様`}</SafeText>
          <SafeText style={text}>{`明日の${trialName}のご予約をお知らせいたします。`}</SafeText>

          <Section style={detailSection}>
            <SafeText style={sectionTitle}>ご予約内容</SafeText>
            <SafeText style={label}>日時</SafeText>
            <SafeText style={value}>{`${bookingDate} ${bookingTime}`.trim()}</SafeText>
            <SafeText style={label}>内容</SafeText>
            <SafeText style={value}>{contentValue}</SafeText>
            {addressLines.length > 0 && (
              <>
                <SafeText style={label}>場所</SafeText>
                <AddressBlock style={value} lines={addressLines} />
              </>
            )}
          </Section>

          {/* 「手ぶらでOK・ウェア無料レンタル・お水あり」は Salute御所南 の設備・サービス。
              他ジムに当てはまるとは限らないため、事実でない案内を送らないよう
              このジム（isFreeTrial）のときだけ出す。
              将来ジムごとに設定させるなら tenants.trial_info_body の流用が候補。 */}
          {isFreeTrial && (
            <Section style={detailSection}>
              <SafeText style={sectionTitle}>当日のご案内</SafeText>
              <SafeText style={text}>・手ぶらでOK！ウェア・シューズは無料でレンタルできます</SafeText>
              <SafeText style={text}>・お水はこちらでご用意しております</SafeText>
            </Section>
          )}

          <Section style={detailSection}>
            <SafeText style={sectionTitle}>キャンセル・変更</SafeText>
            {/* セルフキャンセルは廃止し、メール連絡に一本化した（send-trial-reminders は cancelUrl を渡さない）。
                分岐自体は残し、再度セルフキャンセルに戻す際にすぐ有効化できるようにしている。 */}
            {cancelUrl ? (
              <>
                <SafeText style={text}>ご都合が悪くなった場合は、下記のボタンからキャンセルできます。</SafeText>
                <Button href={cancelUrl} style={cancelButton}><SafeInlineText>予約をキャンセルする</SafeInlineText></Button>
                <SafeText style={fallbackText}>ボタンが押せない場合は、こちらのリンクをブラウザで開いてください。</SafeText>
                <Text style={fallbackText}>
                  <Link href={cancelUrl} style={inlineLink}>{cancelUrl}</Link>
                </Text>
              </>
            ) : gymContactEmail ? (
              <>
                <SafeText style={text}>下記メールへご連絡ください。</SafeText>
                <Text style={text}>
                  <Link href={`mailto:${gymContactEmail}`} style={inlineLink}>{gymContactEmail}</Link>
                </Text>
              </>
            ) : (
              <SafeText style={text}>ご都合が悪くなった場合は、ジムへご連絡ください。</SafeText>
            )}
          </Section>

          <Hr style={hr} />
          <SafeText style={text}>お会いできることを楽しみにしております！</SafeText>
          <Hr style={hr} />
          <SafeText style={footer}>{gymName}</SafeText>
          {addressLines.length > 0 && <AddressBlock style={footer} lines={addressLines} />}
          {gymWebsiteUrl && (
            <Link href={gymWebsiteUrl} style={footerLink}>{gymWebsiteUrl}</Link>
          )}
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: TrialBookingReminderEmail,
  subject: (data: Record<string, any>) =>
    `【明日のご予約】${data?.isFreeTrial ? '初回無料体験' : '体験'}のリマインド`,
  displayName: '体験予約 前日リマインド',
  previewData: {
    guestName: '山田 太郎',
    bookingDate: '5月18日（月）',
    bookingTime: '15:00',
    gymName: 'パーソナルジムSalute御所南',
    gymAddress: '京都市中京区\n毘沙門町533-1\nプラザ御所南 2階',
    gymContactEmail: 'k.munemoto@kyoto-salute.com',
    gymWebsiteUrl: 'https://app.kyoto-salute.com',
    isFreeTrial: true,
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
