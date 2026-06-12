/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
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
        <Button style={button} href={confirmationUrl}>
          メールアドレス変更を確定する
        </Button>
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
const button = { backgroundColor: '#000000', color: '#ffffff', fontSize: '14px', borderRadius: '8px', padding: '12px 20px', textDecoration: 'none' }
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
