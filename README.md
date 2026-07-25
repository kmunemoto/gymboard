# GymBoard

パーソナルジム向けの会員・トレーナー管理アプリ。Web（PWA）と iOS/Android（Capacitor）で動作する。

## 技術スタック

- **フロントエンド**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui (Radix UI) + lucide-react
- **状態管理 / データ取得**: TanStack Query
- **バックエンド**: Supabase（Auth / Postgres / Storage / Edge Functions）
- **決済**: Stripe
- **多言語化**: i18next（日本語 / 英語 / 韓国語 / 繁体字 / 簡体字）
- **ネイティブ**: Capacitor 7（iOS / Android、Push 通知、Haptics ほか）
- **姿勢分析**: TensorFlow.js + pose-detection（必要時に動的 import）
- **テスト**: Vitest（ユニット）+ Playwright（E2E）

## セットアップ

依存パッケージのインストール（ローカル開発は bun、CI は npm を使用）:

```bash
bun install   # もしくは: npm install --legacy-peer-deps
```

開発サーバー起動:

```bash
bun run dev   # http://localhost:8080
```

## 主なスクリプト

| コマンド | 説明 |
| --- | --- |
| `bun run dev` | 開発サーバー起動 |
| `bun run dev:fixtures` | 開発サーバー起動（**ログイン不要・ダミーデータ**。Supabase に繋がない） |
| `bun run build` | 本番ビルド |
| `bun run build:dev` | development モードでビルド |
| `bun run lint` | ESLint 実行 |
| `bun run test` | Vitest 実行 |
| `bun run translate` | ロケールファイルの翻訳生成 |

### ログインせずに画面を確認する

トレーナー側の画面はログイン必須で、`.env` は本番プロジェクトを指しているため、
そのままでは開発中に画面を目視確認できない。次のコマンドで、架空のジムのダミーデータを
使い、ログインなしにトレーナーとしてアプリを開ける（Supabase には接続しない）。

```bash
bun run dev:fixtures   # もしくは: npm run dev:fixtures
```

データは `src/dev/fixtures.ts`。本番ビルドには含まれない（`vite.config.ts` の alias で
差し替え）。詳細は `mem/ops/dev-fixtures.md`。

## 環境変数

ビルド時に以下の `VITE_` 変数が必要（`.env` / `.env.development` / `.env.production` で管理）。
いずれもクライアントに公開される前提の公開鍵のみで、秘密鍵は含めない。

| 変数 | 用途 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase プロジェクト URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon（公開）キー |
| `VITE_SUPABASE_PROJECT_ID` | Supabase プロジェクト ID |
| `VITE_PAYMENTS_CLIENT_TOKEN` | Stripe publishable キー（`pk_...`） |
| `VITE_DEV_FIXTURES` | `true` で開発用ダミーデータに差し替え（`.env.fixtures` / `dev:fixtures` 専用。本番では無視される） |

> Supabase の service_role キーや Stripe secret キーなどの秘密情報は
> Edge Functions の環境変数（`Deno.env.get`）でのみ扱い、クライアントには含めない。

## ディレクトリ構成

```
src/
  components/   UI コンポーネント（customer / trainer / ui）
  hooks/        データ取得・ドメインロジックのフック
  lib/          ユーティリティ・ドメインロジック・featureFlags
  pages/        ルートごとのページ（App.tsx で lazy 読み込み）
  locales/      i18next 翻訳リソース
  integrations/supabase/  Supabase クライアントと自動生成型
supabase/functions/       Deno 製 Edge Functions
```

## フィーチャーフラグ

審査などの都合で一時的に表示を切り替える機能は `src/lib/featureFlags.ts` に集約している。
個別コンポーネントへ条件を直書きせず、フラグを参照すること。

## Supabase 型の再生成

`src/integrations/supabase/types.ts` は DB スキーマから自動生成される。
スキーマ変更後は次のコマンドで再生成する（コード中の `as any` 回避策を減らせる）:

```bash
supabase gen types typescript --project-id <project-id> > src/integrations/supabase/types.ts
```
