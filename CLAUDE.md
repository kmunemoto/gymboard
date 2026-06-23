# GymBoard（Claude Code 用メモ）

## 概要
マルチテナントのジム管理アプリ。React + TypeScript + Capacitor（iOS/Android ネイティブ）
+ Supabase（Lovable Cloud）。UI は Tailwind / shadcn/ui。

## コーディング規約
- アイコンは Lucide React のみ。絵文字は使わない。
- 既存のコンポーネントとパターンに合わせる。お客様向けUIテキストは日本語。
- 既存の挙動を壊さない。変更時はコードレビュー＋ユニット/統合/システムテストの観点を意識する。

## マルチテナントの注意
- テナントごとに挙動が変わる。特定テナント専用の変更を全テナントに適用しない。
- 自社ジム Salute御所南: tenant_id = ceda19b0-d5e0-4928-ab2e-996a0b823af4
- Supabase project ref = rrbfwitprzuevzytykrq

## ビルド/リポジトリの前提
- ios/ と GoogleService-Info.plist / google-services.json は .gitignore 済み。
  ネイティブ設定はビルド時に注入されるため、リポジトリ内に無くても正常。
- iOS は GitHub Actions（.github/workflows/ios-build.yml）、Android は Windows + Android Studio。
  クラウドセッションではネイティブビルドは実行できない。
- Lovable と GitHub 同期しているプロジェクト。変更はブランチで行い PR を作る（main を直接壊さない）。

## セキュリティ
- 秘密情報（サービスアカウントJSON、署名鍵など）はコミットしない。

## 参照
- 機能・実装メモ: `mem/`（例: `mem/auth/session-management.md`, `mem/features/workout-share.md`）
- セットアップ・スクリプト・環境変数: `README.md`
- 一時的な表示切替フラグ: `src/lib/featureFlags.ts`
