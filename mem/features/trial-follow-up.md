# 体験フォロー管理（体験CRM）

## 概要（2026-07〜）
体験予約は今まで「予約が入る→当日を迎える」で終わりで、その後「来店したか／入会したか／
見送りか」を記録する場所が無かった。`trial_bookings` にフォロー状況を追加し、トレーナーが
体験後にステータス・メモを記録できるようにした。

- `trial_bookings.follow_up_status`: `未対応`/`来店した`/`入会した`/`見送り`（既定`未対応`、
  `bookings.status` と同じ方針でCHECK制約なしの自由文字列）。
- `trial_bookings.follow_up_note`: トレーナーの自由記入メモ（任意）。
- 新規タブ「体験フォロー」（`TrainerTrialFollowUps.tsx`、`TrainerTab = "trial-followups"`）:
  - 「フォロー待ち」= `follow_up_status === "未対応"` かつ予約日時が過去のもの、を上部に表示。
  - 「体験→入会率」= `入会した` / (`入会した` + `見送り`)（両方0件のときは `—` 表示）。
  - 各カードでステータス変更（Select、変更時に即保存）とメモ編集ができる。
- ダッシュボード（`TrainerDashboard.tsx`）にフォロー待ち件数のバナーを追加。0件なら非表示。
  タップで体験フォロータブへ遷移（`TrainerView.tsx` の `handleNavigateFollowUps`）。

## 実装メモ
- マイグレーション未適用環境（Lovable適用前）でも壊れないよう、`trial_bookings` への
  select/update はいずれも `as any` キャスト、または取得失敗時に0件/空配列へ静かにフォール
  バックする（`useTenant.ts` の新カラム未適用フォールバック方針と同じ）。
- i18n キーは `trialFollowUp.status.{pending|visited|joined|declined}` の英語キーで統一し、
  DB値（日本語）とはコンポーネント内の `STATUS_I18N_KEY` 対応表で変換する
  （i18nキーに日本語を直接使わない、という既存の暗黙の規約に合わせた）。
- モバイル下部ナビには追加していない（既存の「カウンセリング」タブと同様、7項目で埋まって
  いるため）。モバイルではダッシュボードのバナー経由でのみ到達できる。

## デプロイに関する注意
- `supabase/migrations/20260721020000_trial_follow_up_status.sql` はLovable経由での適用が
  必要。適用前はフォロー待ちバナー・体験フォロータブとも「0件/取得エラー」で静かに空表示になる
  （エラーにはならない）。
