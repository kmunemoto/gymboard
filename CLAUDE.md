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
- **iOS のリリースは GitHub Actions**（.github/workflows/ios-build.yml、workflow_dispatch）。
  バージョンは同ファイルの MARKETING_VERSION を書き換える。
- **Android のリリースは Windows + Android Studio で手作業**（2026-08-03 に現状維持と決定）。
  `scripts\build-android.bat` → Android Studio で署名付きAAB → Play Console へアップロード。
  versionCode / versionName は `android/app/build.gradle` を手で更新する。
  **android/ は .gitignore 済みなので、この2つの値はリポジトリから読めない。**
  リリースしたら `mem/features/android-ci.md` の「リリース実績」に記録すること。
- `.github/workflows/android-build.yml` は作ってあるが**使っていない**
  （Secrets 6種の準備コストが見合わないため見送り。workflow_dispatch なので放置しても動かない）。
  再開するときの手順は mem/features/android-ci.md。
  クラウドセッションではネイティブビルドを実行・検証できない。
- Lovable と GitHub 同期しているプロジェクト。変更はブランチで行い PR を作る（main を直接壊さない）。

## セキュリティ
- 秘密情報（サービスアカウントJSON、署名鍵など）はコミットしない。

## 業種特化の兄弟アプリ（セッコツボード等）について
**2026-08-03 に、上流・下流の運用（兄弟が `git merge upstream/main` で追従する仕組み）は
終了しました。** 以後、各アプリはそれぞれ独立して進みます。
このリポジトリを「上流」として扱う必要はなく、`upstream-changelog.md` への追記も不要です。
コード（`featureFlags.ts` / `brand.ts` / `vertical.ja.json` / `test/helpers/upstream.ts`）は
そのまま残してあります。経緯は `mem/ops/vertical-fork.md` の冒頭。

## 参照
- 機能・実装メモ: `mem/`（例: `mem/auth/session-management.md`, `mem/features/workout-share.md`）
- セットアップ・スクリプト・環境変数: `README.md`
- 一時的な表示切替フラグ: `src/lib/featureFlags.ts`
