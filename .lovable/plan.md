## 目的
「トレーナーのホームタブで『画面の読み込みに失敗しました』が出続ける」障害について、**新規に作った空テナントでも再現するか** を実機で確認し、コードバグか既存テナント固有データ起因かを切り分ける。コードは一切変更しない（調査のみ）。

## 前提として確定済みの事実
- `https://gymboard.lovable.app/` と `https://app.kyoto-salute.com/` は同一ビルドを配信中（`assets/index-nghBznDj.js`）。`gymboard.lovable.app` はカスタムドメインへ 302 でリダイレクト。→ **デプロイ鮮度の問題ではない**。

## 実施ステップ（ビルドモードで実行）

1. **新規オーナーアカウント作成**（Playwright, headless Chromium, viewport 1280x1800）
   - `https://app.kyoto-salute.com/auth` を開く → "Gym Owner" タブ → "Sign up here"
   - `trainer-test-<epoch>@testmail.app` / `TestPass123!` / 表示名 `TestOwner<epoch>` でサインアップ
   - メール確認が必須なので、**確認完了は `supabase--migration` で直接 `auth.users.email_confirmed_at = now()` を打つ**（他フィールドは触らない）。これは今回のみの検証目的の1レコード更新で、既存ユーザーには影響しない。

2. **ログイン → ダッシュボード遷移**
   - 同アカウントで `/auth` にログイン
   - 初回サインイン時に `signup-trainer` Edge Function が呼ばれて `tenants` と `tenant_members` (role=owner) と `user_roles` (role=trainer) が作られる想定
   - ホーム（dashboard タブ）を開き、以下を捕捉:
     - `page.on("pageerror")` / `page.on("console")` の全ログ
     - スクリーンショット
     - ネットワークで 4xx/5xx を返したリクエスト（URL + ステータス + レスポンス冒頭）

3. **分岐**
   - **再現する（真っさらでも「読み込みに失敗しました」）** → コードバグ確定。`[LazyBoundary] chunk/render error:` の全スタックトレースとネットワーク失敗を丸ごとユーザーへ報告。
   - **再現しない（新規テナントでは正常表示）** → 既存テナント固有データ依存確定。作成したテストアカウント認証情報を報告し、次ターンで既存テナントのどのクエリ／レコードが刺さっているかを個別に切り分け。

4. **後片付け**
   - どちらの結論でも作成した検証用ユーザー・テナント（`user_roles`, `tenant_members`, `tenants`, `profiles`, `auth.users` の該当行）を削除する SQL を最後に実行し、DB を汚さない。

## 技術メモ
- `.workspace/skills/` は使わない。プレーンな Playwright スクリプトを `/tmp/browser/dash/` に置いて `python3` で走らせる。
- 認証済みセッションはローカルストレージへ Supabase JS が書き込むので、Playwright 側で追加の cookie 注入は不要（ブラウザで実際にログイン操作を行うため）。
- `email_confirmed_at` の直接 UPDATE は `auth` スキーマへの書き込みだが、既存ポリシー上 `service_role` として `supabase--migration` で実行可能。トリガーは張らない。
- 変更するファイルは **無し**。DB への一時的な書き込みのみで、最後に revert。

## 承認をお願いしたい点
- 新規テストアカウント作成と、`auth.users.email_confirmed_at` の直接更新（1行、テストアカウントのみ、後で削除）を実施してよいか。承認いただければすぐに実行します。
