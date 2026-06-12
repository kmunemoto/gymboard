/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface EmailChangeEmailProps {
  siteName: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="ja" dir="ltr">
    <Head />
    <Preview>{siteName}のメールアドレス変更確認</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>メールアドレス変更の確認</Heading>
        <Text style={text}>
          {siteName}のメールアドレスを{' '}
          <Link href={`mailto:${oldEmail}`} style={link}>{oldEmail}</Link>{' '}から{' '}
          <Link href={`mailto:${newEmail}`} style={link}>{newEmail}</Link>{' '}へ変更するリクエストを受け付けました。
        </Text>
        <Text style={text}>
          下のボタンをクリックして変更を確定してください。
        </Text>
        <table role="presentation" cellPadding={0} cellSpacing={0} style={{ margin: '0 0 25px' }}>
          <tbody>
            <tr>
              <td style={buttonCell}>
                <a href={confirmationUrl} target="_blank" style={buttonLink}>
                  メールアドレス変更を確定する
                </a>
              </td>
            </tr>
          </tbody>
        </table>
        <Text style={footer}>
          このメールにお心当たりがない場合は、速やかにアカウントの安全を確認してください。
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail

const main = { backgroundColor: '#ffffff', fontFamily: '"Hiragino Sans", "Yu Gothic", Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#000000', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#55575d', lineHeight: '1.7', margin: '0 0 25px' }
const link = { color: 'inherit', textDecoration: 'underline' }
const buttonCell = {
  backgroundColor: 'hsl(36, 40%, 42%)',
  borderRadius: '12px',
  textAlign: 'center' as const,
}

const buttonLink = {
  display: 'inline-block',
  padding: '14px 32px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: 'bold' as const,
  textDecoration: 'none',
}

const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
