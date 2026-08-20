import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Text, Hr, Section, Link, Button,
} from 'npm:@react-email/components@0.0.22'
import { trialPriceLine } from '../trial-pricing.ts'
import type { TemplateEntry } from './registry.ts'
import { GymNoteSection } from './gym-note.tsx'

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
  /**
   * 体験の料金（税込・円）。ジムごとの設定（tenants.trial_price_yen）。
   * null/未指定は「料金を書かない」。**0 は「¥0」と明示する**ので別物。
   */
  trialPriceYen?: number | null
  /**
   * 「手ぶらでOK・ウェア無料レンタル・お水あり」を出すか。
   *
   * ⚠️ 2026-08-08 まで、この案内は `isFreeTrial`（＝Salute御所南か）で出し分けていた。
   *    そのフラグは「無料と呼ぶ」と「Saluteの設備案内を出す」の**二役を兼ねていた**ので、
   *    体験を有料化したときに素直に消すと**設備案内まで消える**ところだった。
   *    料金と設備は無関係なので分けてある。
   */
  showAmenities?: boolean
  /** リマインドメールに足す、店からのご案内（tenants.reminder_email_note）。空なら何も出さない。 */
  gymNote?: string | null
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
  trialPriceYen = null,
  showAmenities = false,
  gymNote = null,
}: Props) => {
  const addressLines = splitAddressLines(gymAddress)
  // 呼称は全ジム共通。**料金を含めないこと**（金額はジムごとに違う）。
  const trialName = '体験トレーニング'
  const contentValue = '体験トレーニング（カウンセリング＋トレーニング 計60分）'
  const priceLine = trialPriceLine(trialPriceYen)
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
            {/* 料金はジムが設定したときだけ出す。未設定のジムは行ごと出ない。 */}
            {priceLine && (
              <>
                <SafeText style={label}>料金</SafeText>
                <SafeText style={value}>{priceLine}</SafeText>
              </>
            )}
            {addressLines.length > 0 && (
              <>
                <SafeText style={label}>場所</SafeText>
                <AddressBlock style={value} lines={addressLines} />
              </>
            )}
          </Section>

          {/* 「手ぶらでOK・ウェア無料レンタル・お水あり」は Salute御所南 の設備・サービス。
              他ジムに当てはまるとは限らないため、事実でない案内を送らないよう
              このジム（showAmenities）のときだけ出す。
              将来ジムごとに設定させるなら tenants.trial_info_body の流用が候補。 */}
          {showAmenities && (
            <Section style={detailSection}>
              <SafeText style={sectionTitle}>当日のご案内</SafeText>
              <SafeText style={text}>・手ぶらでOK！ウェア・シューズ・タオルは無料でレンタルできます</SafeText>
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
          <GymNoteSection note={gymNote} />
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
    '【明日のご予約】体験トレーニングのリマインド',
  displayName: '体験予約 前日リマインド',
  previewData: {
    gymNote: 'お飲み物はこちらでご用意しています。',
    guestName: '山田 太郎',
    bookingDate: '5月18日（月）',
    bookingTime: '15:00',
    gymName: 'パーソナルジムSalute御所南',
    gymAddress: '京都市中京区\n毘沙門町533-1\nプラザ御所南 2階',
    gymContactEmail: 'k.munemoto@kyoto-salute.com',
    gymWebsiteUrl: 'https://app.kyoto-salute.com',
    trialPriceYen: 3000,
    showAmenities: true,
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
