/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Section, Text } from 'npm:@react-email/components@0.0.22'

/**
 * 店ごとの「ひとこと」ブロック（tenants.booking_email_note / reminder_email_note）。
 *
 * ## なぜ共通部品にするか
 *
 * 予約確認3種（会員・体験・ドロップイン）とリマインド2種（会員・体験）の**5枚**に
 * 同じ物を出す。各テンプレートに書き写すと、次に文字化け対策を直すときに
 * 5箇所を直すことになる（2026-08-18 の `<!--` 混入は、同じ実装が4箇所に
 * 複製されていたせいで直しが4倍になった）。
 *
 * ## 🔴 エスケープしてからエンティティ化する
 *
 * これは**店の自由入力が本文に入る初めての経路**。順序が命:
 *   1. `&` → `&amp;`（最初にやらないと、後から作った実体参照まで壊す）
 *   2. `<` `>` `"` `'` を実体参照へ
 *   3. 残りの非ASCII文字を `&#N;` へ
 * こうすると本文は純ASCIIになり、送信時の quoted-printable でも壊れない。
 *
 * ⚠️ **本文に文字を挿入しないこと。** 折り返しのつもりで HTML コメント
 * （`<!--\n-->`）を入れた結果、メールクライアントがそれを `??` として描画し
 * 「キ??ンセル」になった（2026-08-18）。挿入していいのは
 * `_shared/email-encoding.ts` が入れる**行末のソフト改行だけ**。
 *
 * ## 空なら何も描かない
 *
 * 既定文は持たない（cancel_policy_body と同じ方針）。NULL/空文字なら
 * `<Section>` ごと出さない＝メールの見た目は今までと1ピクセルも変わらない。
 */

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

/** 自由入力を行ごとに割る。空行は落とす（`<br>` を店の文字から作らない）。 */
export const splitNoteLines = (note: string | null | undefined): string[] =>
  (note ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)

interface Props {
  /** tenants.booking_email_note / reminder_email_note の値。null/空なら何も描かない。 */
  note?: string | null
  /** 見出し。省略すると見出し無しで本文だけ出す。 */
  title?: string
}

export const GymNoteSection = ({ note, title = 'お店からのご案内' }: Props) => {
  const lines = splitNoteLines(note)
  if (lines.length === 0) return null
  return (
    <Section style={section}>
      <Text style={heading} dangerouslySetInnerHTML={{ __html: toHtmlEntities(title) }} />
      {lines.map((line, i) => (
        <Text key={i} style={body} dangerouslySetInnerHTML={{ __html: toHtmlEntities(line) }} />
      ))}
    </Section>
  )
}

const section = { margin: '16px 0', padding: '14px 16px', backgroundColor: '#fbfbf7', borderRadius: '8px', borderLeft: '3px solid #0ABAB5' }
const heading = { fontSize: '12px', fontWeight: '700' as const, color: '#0ABAB5', margin: '0 0 6px' }
const body = { fontSize: '14px', color: '#000000', lineHeight: '1.6', margin: '0 0 4px' }
