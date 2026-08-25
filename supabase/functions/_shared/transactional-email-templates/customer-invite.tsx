/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section, Button,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "ジムボード"

/**
 * 取り込んだ顧客への招待メール（invite-customer 専用）。
 *
 * 🔴 CLIENT_ALLOWED_TEMPLATES に入れないこと。宛先が自由入力（店が打ったアドレス）なので、
 *    クライアントから直接呼べると任意の宛先にジム名入りのメールを撒ける口になる。
 *    呼び出しは service_role（invite-customer）からだけ。
 *
 * 本文の約束:
 *   - リンク先はパスワード設定（/reset-password?flow=invite）。開いた人がそのまま本人になる
 *   - 🔴 「心当たりが無い場合は破棄」を必ず入れる。店が宛先を打ち間違えたときの唯一の防波堤
 *   - 期限切れでもアプリの「パスワードをお忘れの方」から自分でやり直せる旨を書く
 *     （リンクの寿命は GoTrue の OTP 期限に従う。再送を店に頼まなくても本人が復帰できる）
 */

interface CustomerInviteProps {
  gymName?: string
  customerName?: string
  inviteUrl?: string
}

const CustomerInviteEmail = ({
  gymName = '',
  customerName = '',
  inviteUrl = '',
}: CustomerInviteProps) => (
  <Html lang="ja" dir="ltr">
    <Head />
    <Preview>{gymName || SITE_NAME}からのご招待</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{SITE_NAME}へのご招待</Heading>
        <Hr style={hr} />
        <Text style={text}>{customerName ? `${customerName}様` : 'お客様'}</Text>
        <Text style={text}>
          {gymName ? `${gymName}が` : 'ご利用中のジムが'}あなたの会員情報を{SITE_NAME}に登録しました。
          下のボタンからパスワードを設定すると、予約やトレーニング記録をアプリでご利用いただけます。
        </Text>
        <Section style={buttonSection}>
          <Button href={inviteUrl} style={button}>▼ パスワードを設定してはじめる</Button>
        </Section>
        <Text style={note}>
          リンクの有効期限が切れていた場合は、アプリのログイン画面にある
          「パスワードをお忘れの方」から、このメールアドレスでやり直せます。
        </Text>
        <Hr style={hr} />
        <Text style={footer}>
          このメールに心当たりが無い場合は、お手数ですがこのまま破棄してください。
          破棄していただければ何も起こりません。
        </Text>
        <Text style={footer}>
          このメールは{SITE_NAME}のシステムから自動送信されています。
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: CustomerInviteEmail,
  subject: (data: Record<string, any>) =>
    data.gymName ? `【${SITE_NAME}】${data.gymName}からのご招待` : `【${SITE_NAME}】ご招待のお知らせ`,
  displayName: '取り込んだ顧客への招待（アカウントの引き渡し）',
  previewData: {
    gymName: 'サンプルジム',
    customerName: '山田 太郎',
    inviteUrl: 'https://app.kyoto-salute.com/reset-password?token_hash=sample&type=recovery&flow=invite',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', 'Hiragino Sans', sans-serif" }
const container = { padding: '32px 28px', maxWidth: '480px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#000000', margin: '0 0 16px' }
const hr = { borderColor: 'rgba(10, 186, 181, 0.3)', borderTopWidth: '1px', margin: '16px 0' }
const text = { fontSize: '14px', color: '#000000', lineHeight: '1.6', margin: '0 0 12px' }
const buttonSection = { margin: '20px 0' }
const button = {
  backgroundColor: '#0ABAB5', color: '#ffffff', fontSize: '14px', fontWeight: '700' as const,
  padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', display: 'inline-block',
}
const note = { fontSize: '12px', color: '#666666', lineHeight: '1.6', margin: '0 0 12px' }
const footer = { fontSize: '11px', color: '#999999', margin: '12px 0 0', lineHeight: '1.5' }
