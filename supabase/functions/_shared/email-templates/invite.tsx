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

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="ja" dir="ltr">
    <Head />
    <Preview>パーソナルジムSalute御所南への招待</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>パーソナルジムSalute御所南への招待</Heading>
        <Text style={text}>
          パーソナルジムSalute御所南にご招待されました。以下のボタンをクリックして、アカウントを作成してください。
        </Text>
        <Button style={button} href={confirmationUrl}>
          招待を承認する
        </Button>
        <Text style={footer}>
          ※ この招待にお心当たりがない場合は、無視していただいて問題ございません。
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

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
