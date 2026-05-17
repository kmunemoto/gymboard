import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "パーソナルジムSalute御所南"

interface NewAccountNotificationProps {
  customerEmail?: string
  displayName?: string
  signupDate?: string
}

const NewAccountNotificationEmail = ({
  customerEmail = '',
  displayName = '',
  signupDate = '',
}: NewAccountNotificationProps) => (
  <Html lang="ja" dir="ltr">
    <Head />
    <Preview>新しいアカウントが登録されました — {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>新しいアカウントが登録されました</Heading>
        <Hr style={hr} />
        <Text style={text}>新しいお客様がアカウントを登録しました。</Text>
        <Section style={detailSection}>
          {displayName && (
            <>
              <Text style={label}>お名前</Text>
              <Text style={value}>{displayName}</Text>
            </>
          )}
          <Text style={label}>メールアドレス</Text>
          <Text style={value}>{customerEmail}</Text>
          {signupDate && (
            <>
              <Text style={label}>登録日時</Text>
              <Text style={value}>{signupDate}</Text>
            </>
          )}
        </Section>
        <Hr style={hr} />
        <Text style={footer}>
          このメールは{SITE_NAME}のシステムから自動送信されています。
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: NewAccountNotificationEmail,
  subject: '【パーソナルジムSalute御所南】新しいアカウントが登録されました',
  to: 'munekan2989@gmail.com',
  displayName: '新規アカウント登録通知（トレーナー向け）',
  previewData: {
    customerEmail: 'taro@example.com',
    displayName: '山田 太郎',
    signupDate: '2026年5月7日 14:30',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', 'Hiragino Sans', sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#000000', margin: '0 0 16px' }
const hr = { borderColor: 'rgba(10, 186, 181, 0.3)', borderTopWidth: '1px', margin: '16px 0' }
const text = { fontSize: '14px', color: '#000000', lineHeight: '1.6', margin: '0 0 12px' }
const detailSection = { margin: '8px 0' }
const label = { fontSize: '11px', fontWeight: '600' as const, color: '#0ABAB5', textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '12px 0 2px' }
const value = { fontSize: '15px', color: '#000000', margin: '0 0 4px', fontWeight: '500' as const }
const footer = { fontSize: '11px', color: '#999999', margin: '28px 0 0', lineHeight: '1.5' }