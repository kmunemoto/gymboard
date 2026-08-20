# 予約時のカスタム質問（事前アンケート）と メール文言の追記（2026-08-20）

エアリザーブの「アンケート」「メール管理（文言のカスタマイズ）」に当たる2件。

---

## 1. 予約時のカスタム質問（`booking_questions`）

### 何が無かったか

カウンセリング（`counseling_responses`）は**項目がコードに固定**されていて、
入会時にしか使えない。「店が自分で質問を作って、予約のときに聞く」が無かった。

業種で聞きたいことは違う（ジム=目標/既往歴、整骨=痛む部位、ピラティス=経験）ので、
**コードではなく店ごとの設定**として持つのが正しい置き場所になる。

### 🔴 回答は参照ではなく「スナップショット」

回答は `booking_questions` への外部キーではなく、**そのとき聞いた文言ごと**
`bookings.custom_answers` / `trial_bookings.custom_answers`（jsonb）に焼き付ける。

```json
[{ "question_id": "…", "label": "本日の体調", "value": "良い" }]
```

参照にすると、店が質問を消した瞬間に過去の回答が意味不明になる
（「はい」とだけ残って何に対する「はい」か分からない）。
予約の付随データという性質上、正規化より「後から読める」ほうが価値が高い。

**だから回答テーブルは作らない。join も要らない**（予定表の一覧が速い）。

### 聞く場所は質問ごとに選ぶ

| フラグ | 出る画面 |
|---|---|
| `ask_on_member` | お客様の予約（CustomerBooking）・店側の代理予約 |
| `ask_on_trial` | 体験予約（/trial）・ドロップイン（/drop-in） |

両方 false は「下書き」（どこにも出ない）。`is_active = false` も同じ。
入力欄は4画面すべてで `BookingQuestionFields` を共有する
（画面ごとに書くと、入力欄の種類を足したときに必ず取りこぼす）。

### 🔴 anon はテーブルではなく RPC 経由で読む

体験・ドロップインは未ログインで開く。RLS で anon に SELECT を許すのではなく、
`get_tenant_booking_questions(uuid)`（SECURITY DEFINER）を1本足した。

テーブルに anon の口を開けると、**列を足したときに何が公開されるか読み切れなくなる**。
関数なら返す列を明示でき、公開範囲が関数定義そのものになる
（`get_tenant_public` と同じ考え方）。この関数は
`is_active AND ask_on_trial` のものだけを返すので、**会員専用の質問は漏れない**。

### 🔴 未ログインから来た回答をそのまま信用しない

`trial-book` / `drop-in-book` の `sanitizeCustomAnswers()` が、
形・件数（10件）・長さ（120/500文字）を**サーバー側で削ってから**保存する。
DB 側にも CHECK があるが、そこで落ちると**予約自体が失敗する**。
「回答が壊れているせいで予約が取れない」のは筋が悪いので、黙って捨てる。

### 制限値は DB とクライアントで一致させる

| 値 | 場所 |
|---|---|
| 質問文 120文字 / 補足 200文字 / 選択肢20個 | `bookingQuestions.ts` と DB の CHECK |
| 回答 500文字 / 1予約10件 / jsonb 8000文字 | 同上 |
| 1テナント10問 | `MAX_QUESTIONS_PER_TENANT` |

`src/test/bookingQuestions.test.ts` が **`input_type` の集合まで含めて**一致を見張る
（片方だけ増やすと、保存できない種類が設定画面に出る）。

---

## 2. メールに足す店からの案内

`tenants.booking_email_note`（確認メール）/ `reminder_email_note`（リマインド）。

### テンプレート全体を編集させない理由

本文まるごとを店に編集させると、
- 日時・キャンセルリンクなど**必須の情報を消せてしまう**
- HTML を書けてしまう（メールの XSS ／レイアウト崩れ）
- 5言語・全テンプレートぶんの編集画面が要る

**「決まった位置に1ブロック足せる」だけ**にすれば、実務上の要望
（案内を1〜2行足したい）はほぼ満たせて、上の危険が全部消える。

### 🔴 本文は必ずエスケープ→エンティティ化を通す

**店の自由入力がメール本文に入る初めての経路。** 順序が命:

1. `&` → `&amp;`（最初にやらないと、後から作った実体参照まで壊す）
2. `<` `>` `"` `'` を実体参照へ
3. 残りの非ASCII文字を `&#N;` へ

こうすると本文は純ASCIIになり、送信時の quoted-printable でも壊れない。

⚠️ **本文に文字を挿入しないこと。** 折り返しのつもりで入れた HTML コメント
（`<!--\n-->`）をメールクライアントが `??` として描画し「キ??ンセル」になった
（2026-08-18）。挿入していいのは `_shared/email-encoding.ts` が入れる
**行末のソフト改行だけ**。`src/test/emailNotes.test.ts` がこの機構の再侵入を見張る。

### 共通部品にした理由

出す先は**5枚**（確認3種＋リマインド2種）。各テンプレートに書き写すと、
次に文字化け対策を直すときに5箇所を直すことになる
（2026-08-18 の `<!--` 混入は、同じ実装が4箇所に複製されていたせいで直しが4倍になった）。
`_shared/transactional-email-templates/gym-note.tsx` に1つ置いて全部から使う。

### 空なら何も出さない

既定文は持たない（`cancel_policy_body` と同じ方針）。NULL/空なら `<Section>` ごと
出さないので、**設定していない店のメールは1ピクセルも変わらない**。

### 送信元と列の対応（取り違えると「予約したのに前日案内が届く」）

| 送信元 | テンプレート | 読む列 |
|---|---|---|
| `src/lib/bookingNotification.ts` | booking-confirmation | `booking_email_note` |
| `trial-book` | trial-booking-confirmation | `booking_email_note` |
| `drop-in-book` | drop-in-booking-confirmation | `booking_email_note` |
| `push-booking-reminder` | booking-reminder | `reminder_email_note` |
| `send-trial-reminders` | trial-booking-reminder | `reminder_email_note` |

---

## 🔴 Edge Function は push でも Publish でも本番に出ない

このPRは `trial-book` / `drop-in-book` / `send-trial-reminders` /
`push-booking-reminder` / `send-transactional-email`（テンプレート同梱）を触っている。

**マージしただけでは本番に反映されない。** Lovable のエージェントに
`send_message` でデプロイを依頼し、**そのあと必ず自分で叩いて確かめる**
（詳細は `mem/ops/edge-function-deploy.md`）。

DB マイグレーション（質問・回答列・RPC）は適用済みなので、
**設定画面での質問の作成と、会員予約での質問表示・保存は先に動く**。
体験・ドロップインの回答保存とメールの追記だけが、デプロイ後に有効になる。

## 本番適用（2026-08-20）

DB は適用済み。3段構えで検証:
- anon から `get_tenant_booking_questions` が呼べる／**テーブル直読みは `insufficient_privilege`**
- オーナーを演じて自店に質問・シフトを作れる／**他店には作れない**
- 適用後、`booking_questions` は 0件・`booking_email_note` 等も全店 NULL
  （＝どの店の挙動も変わっていない）
