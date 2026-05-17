/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="ja" dir="ltr">
    <Head />
    <Preview>パーソナルジムSalute御所南 - パスワードの再設定</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>パスワードの再設定</Heading>
        <Text style={text}>
          パーソナルジムSalute御所南のパスワード再設定のリクエストを受け付けました。
        </Text>
        <Text style={text}>
          以下のボタンをクリックして、新しいパスワードを設定してください。
        </Text>
        <Button style={button} href={confirmationUrl}>
          パスワードを再設定する
        </Button>
        <Text style={footer}>
          ※ このリクエストにお心当たりがない場合は、無視していただいて問題ございません。パスワードは変更されません。
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = { backgroundColor: '#ffffff', fontFamily: '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: 'hsl(36, 40%, 42%)',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.8',
  margin: '0 0 25px',
}
const button = {
  backgroundColor: 'hsl(36, 40%, 42%)',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '12px',
  padding: '12px 24px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', lineHeight: '1.6' }
