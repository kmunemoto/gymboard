# 口コミ依頼の自動化

## 概要（2026-07〜）
来店が節目（累計10回目）に達したお客様のホーム画面に、Google口コミ投稿を促すバナーを
一度だけ表示する。

- `tenants.google_review_url`（任意）: 設定するだけで機能が有効になる。専用のON/OFFトグルは
  設けていない（`line_url`/`website_url` と同じ、値の有無自体がゲートになる方式）。
  設定画面: `TrainerGymSettings.tsx`「Google口コミ依頼」セクション。
- `profiles.review_prompted_at`（timestamptz）: バナーを表示済み（クリック・スキップいずれも）
  になったら記録し、二度と表示しない。
- 判定: `CustomerHome.tsx` で `totalSessions >= 10 && tenant.google_review_url && !review_prompted_at`。
  `totalSessions` は既存の「累計トレーニング回数」（過去の非キャンセル・非消化予約数）を
  そのまま流用（新たなカウントロジックは作っていない）。
- 「口コミを書く」タップで `google_review_url` を外部ブラウザで開き、同時に
  `review_prompted_at` を記録。「後で」・右上の閉じるボタンも同様に記録する
  （control-once方式。再度表示させたい場合は該当ユーザーの `review_prompted_at` を
  DB側でnullに戻す必要がある）。

## デプロイに関する注意
`supabase/migrations/20260721050000_add_google_review_prompt.sql` はLovable経由での適用が
必要。適用前は `google_review_url` が常にnull扱いになり、バナーは表示されない（安全に
デグレードする、既存の新カラム未適用フォールバック方針と同じ）。
