import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Text, Hr, Section, Link,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

// trial-booking-confirmation.tsx と同じ理由でエンティティエンコードする。英語本文でも
// ¥ 記号や住所内の日本語地名はマルチバイトのため、同じストリーミング分断対策が要る。
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

const splitAddressLines = (address: string): string[] =>
  address.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)

const AddressBlock = ({ style, lines }: { style: React.CSSProperties; lines: string[] }) => (
  <>
    {lines.map((line, i) => (
      <SafeText key={i} style={style}>{line}</SafeText>
    ))}
  </>
)

interface DropInBookingConfirmationProps {
  customerName?: string
  bookingDate?: string
  bookingTime?: string
  gymName?: string
  gymAddress?: string
  gymContactEmail?: string
  gymWebsiteUrl?: string
}

const DropInBookingConfirmationEmail = ({
  customerName = 'Guest',
  bookingDate = '',
  bookingTime = '',
  gymName = 'the gym',
  gymAddress = '',
  gymContactEmail = '',
  gymWebsiteUrl = '',
}: DropInBookingConfirmationProps) => {
  const addressLines = splitAddressLines(gymAddress)
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta charSet="UTF-8" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      </Head>
      <Body style={main}>
        <Container style={container}>
          <SafeHeading style={h1}>Your Drop-in Session is Confirmed</SafeHeading>
          <Hr style={hr} />
          <SafeText style={greeting}>{`Hi ${customerName},`}</SafeText>
          <SafeText style={text}>{`Thank you for booking a drop-in session at ${gymName}! Here are your booking details:`}</SafeText>

          <Section style={detailSection}>
            <SafeText style={sectionTitle}>Booking Details</SafeText>
            <SafeText style={label}>Date &amp; Time</SafeText>
            <SafeText style={value}>{`${bookingDate}, ${bookingTime}`.trim()}</SafeText>
            <SafeText style={label}>Session</SafeText>
            <SafeText style={value}>Drop-in Session (single visit, no membership required)</SafeText>
            <SafeText style={label}>Price</SafeText>
            <SafeText style={value}>¥8,000 per session — payable on-site (cash or credit card)</SafeText>
            <SafeText style={value}>Workout wear, shoes and water are provided free of charge.</SafeText>
            {addressLines.length > 0 && (
              <>
                <SafeText style={label}>Location</SafeText>
                <AddressBlock style={value} lines={addressLines} />
              </>
            )}
          </Section>

          <Section style={detailSection}>
            <SafeText style={sectionTitle}>Need to Cancel or Reschedule?</SafeText>
            {gymContactEmail ? (
              <>
                <SafeText style={text}>If your plans change, please email the gym at least one day before your session.</SafeText>
                <Text style={text}>
                  <Link href={`mailto:${gymContactEmail}`} style={inlineLink}>{gymContactEmail}</Link>
                </Text>
              </>
            ) : (
              <SafeText style={text}>If your plans change, please contact the gym at least one day before your session.</SafeText>
            )}
          </Section>

          <Hr style={hr} />
          <SafeText style={text}>We look forward to seeing you!</SafeText>
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
  component: DropInBookingConfirmationEmail,
  subject: (data: Record<string, any>) =>
    `[${(data?.gymName as string) || 'the gym'}] Your Drop-in Session is Confirmed`,
  displayName: 'ドロップイン予約 確認（顧客向け・英語）',
  previewData: {
    customerName: 'John Smith',
    bookingDate: 'Jul 25 (Sat)',
    bookingTime: '2:00 PM - 3:00 PM',
    gymName: 'Personal Gym Salute Goshominami',
    gymAddress: '533-1 Bishamoncho\nPlaza Goshominami 2F\nNakagyo-ku, Kyoto',
    gymContactEmail: 'k.munemoto@kyoto-salute.com',
    gymWebsiteUrl: 'https://app.kyoto-salute.com',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" }
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
