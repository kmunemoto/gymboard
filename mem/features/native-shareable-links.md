# ネイティブアプリ内で生成する共有用リンク（招待リンク・体験予約リンクなど）

## 問題
Capacitorのネイティブアプリ（iOS/Android）内では `window.location.origin` が
`capacitor://localhost` に解決される（WebViewが読み込んでいる内部アドレスのため）。
これに気づかず `${window.location.origin}/join/xxx` のようにコピー・共有用のリンクを
組み立てると、コピーした本人以外は誰も開けないリンクになる（`capacitor://` はブラウザが
解決できるスキームではない）。

トレーナー設定画面の「体験予約リンク」でこの状態のリンクが表示・コピーされる不具合として
発覚した（2026-07）。同じパターンで招待リンク（`InviteCodeCard.tsx` / オンボーディング完了画面
`Onboarding.tsx`）も同様に壊れていた。

## 対処
`src/lib/nativeBridge.ts` の `getWebOrigin()` を使う。ネイティブ実行時
（`Capacitor.isNativePlatform()`）は本番Webドメイン（`https://app.kyoto-salute.com`、
`PRODUCTION_WEB_ORIGIN`定数）にフォールバックし、それ以外（Web/PWA）は従来どおり
`window.location.origin` を返す。

**2026-07の訂正**: 導入時、`PRODUCTION_WEB_ORIGIN` に設定した `https://app.gymboard.app` が
**DNS未設定で実在しないドメイン**だった（`nslookup`/外部fetchでENOTFOUND確認）。つまり
capacitor://localhost の不具合を直したつもりが、別の壊れたドメインに置き換えていただけで、
ネイティブアプリからコピーした共有リンクは引き続き開けない状態だった。実際に生きている
本番ドメインは `app.kyoto-salute.com`（今のところ唯一の生存確認済み・Salute御所南の
カスタムドメインだが本番全体で流用中。`gymboard.app`(appなし) も生存確認済みで、将来
多ジムSaaS用に正式ドメインを分離する場合はそちらへの切り替えも検討の余地あり）。
同じ間違ったドメインが以下にもハードコードされており、まとめて修正した:
- `line-login-callback` / `google-calendar-callback`（OAuth完了後の302リダイレクト先。
  LINE/Google側に登録する `redirect_uri` は Edge Function自身のURLで別物のため、
  ここを直しても外部サービス側の再設定は不要）
- `send-push-notification` の `ALLOWED_URL_HOSTS`（通知クリック時の遷移先許可リスト）
- `booking-cancellation.tsx` / `booking-confirmation.tsx` の `APP_URL`（`SITE_URL`は
  `gymboard.app` のままで生存確認済みのため変更不要）
- `new-booking-notification.tsx` の `previewData.dashboardUrl`（プレビュー表示专用の値。
  実運用は常に `bookingNotification.ts` が `getWebOrigin()` を渡すため実害は無かった）

**教訓**: 「ドメイン文字列を決め打ちする」対処をしたら、実際にそのドメインが生きているか
（DNS解決できるか）を確認すること。特にOAuthリダイレクト先のように失敗が分かりにくい
（サーバー側の連携自体は成立するが、ブラウザの着地画面だけ壊れる）箇所は要注意。

**続き（2026-07、本番ドメイン整合の追い込み）**: 上記調査で、本番Webオリジンが
`app.kyoto-salute.com`（#155で寄せた）と `gymboard.lovable.app`（プレビュー用サブドメイン）の
2本に割れていたため、後者の実運用箇所も本番ドメインへ寄せた:
- `auth-email-hook` の `APP_URL`（パスワード再設定/確認メールのリンク先）→ `app.kyoto-salute.com`。
  **前提**: このドメインが `/reset-password`・`/auth/callback` を配信し、Supabase Auth の
  Redirect URLs に `https://app.kyoto-salute.com/auth/callback` が登録済みであること。
- `trial-book` の トレーナー通知 `dashboardUrl` → `app.kyoto-salute.com`（通常予約の
  `bookingNotification=getWebOrigin()` と経路差で食い違わないよう統一）。
- Stripe本番判定 `gymboardPlans.detectStripeEnvironment`: `gymboard.lovable.app` のみ live
  だったのを `STRIPE_LIVE_HOSTS`（+`app.kyoto-salute.com`）に拡張。カスタムドメインから
  課金しても sandbox に落ちない。

## Edge Function の自動デプロイ（デプロイ漏れの根治）
`.github/workflows/deploy-functions.yml` は main への push で Edge Function を `supabase
functions deploy` する。**GitHubマージだけでは Lovable は Edge Function を再デプロイしない**
ため、リダイレクト/通知の着地に関わる JWT不要関数はここで自動デプロイする:
`google-calendar-*` に加え `line-login-callback` / `send-push-notification` を追加（2026-07）。
- 前提: GitHub Secrets に `SUPABASE_ACCESS_TOKEN`（未設定なら無言スキップ＝緑）。
- **必須ルール**: ここに関数を足す前に、その関数の `verify_jwt` を `supabase/config.toml` に
  明記すること。未記載の関数を `deploy` すると `verify_jwt` が既定 `true` に戻り、
  `line-login-callback` のような JWT不要関数が壊れる。そのため `line-login-callback` を
  config.toml に追記した。**メールテンプレを束ねる `send-transactional-email` は config.toml
  未記載のためここには足さず、Lovable の Publish に任せる**（verify_jwt を確定できないため）。

```ts
import { getWebOrigin } from "@/lib/nativeBridge";
const link = `${getWebOrigin()}/join/${code}`;
```

「開く」ボタンのように別タブ/外部ブラウザで開く操作も、通常の
`<a href={link} target="_blank">` はネイティブWebView内では期待通り動かないため、
同ファイルの `openExternalUrl(url)`（Capacitor `Browser.open`、ネイティブ以外は
`window.open` にフォールバック）を使う。`TrainerBilling.tsx` に既存の使用例あり。

## 適用済み箇所
- `TrialLinkCard.tsx`（体験予約リンクのコピー・開く）
- `InviteCodeCard.tsx`（招待リンクのコピー、ジム設定画面）
- `Onboarding.tsx`（招待リンクのコピー、初回オンボーディング完了画面）
- `bookingNotification.ts`（代理予約のトレーナー宛メールの dashboardUrl。メール内リンクも
  「他人・別環境で開くリンク」なので同じ扱い）

---

# （関連）テナント横断 `get_trainer_ids()` による誤ルーティング

`get_trainer_ids()` は `SELECT user_id FROM user_roles WHERE role='trainer'` で**全テナント横断**。
その先頭 `[0]` は別ジムのトレーナーになりうる。単一テナント時代の名残で各所に残っている。

- **修正済み（2026-07）**: `CustomerChat.tsx` のお客様→ジムのメッセージ送信先。
  `get_trainer_ids()[0]` だとお客様のメッセージが別ジムに飛び、自ジムのオーナーに
  届かなかった。`tenantHelper.fetchMyTenantTrainerId()`（自テナントの trainer優先→owner を
  tenant_members から解決。SELECT RLS「Members can view same tenant members」で読める）に置換。
- **修正済み（2026-07・続き）**: 予約/キャンセル/リスケの**トレーナー通知**も同様に置換。
  `tenantHelper.fetchMyTenantStaffIds()`（自テナントの trainer→owner 全員、joined_at順・
  先頭が代表）を追加し、以下を移行した:
  - `CustomerBooking.tsx` 予約push（スタッフ全員＋本人）
  - `useBookings.ts` `sendRescheduleToTrainer`（push=スタッフ全員＋本人 / LINE=代表1名）、
    `sendNewBookingLineToTrainer`・`sendCancelLineNotification`・
    `sendCancelEmailNotification`（代表1名）、`sendCancelPushNotification`（スタッフ全員）
  - `bookingNotification.ts` `sendBookingNotification`（メール宛先の trainerUserId）
  これで src 内の `get_trainer_ids` 実呼び出しはゼロ（コメントと生成型のみ）。
  **今後クライアントから「ジム側スタッフ宛」に何か送るときは必ず
  `fetchMyTenantStaffIds()` / `fetchMyTenantTrainerId()` を使うこと。**
  （サーバー側は `trial-book` の tenant_members 解決パターンを踏襲する）

## 今後の注意
新しく「コピーして他人（お客様・別ジム等）に共有するリンク」を生成する機能を追加する際は、
`window.location.origin` を直書きせず必ず `getWebOrigin()` を使うこと。逆に、Stripe
チェックアウトの `success_url`/`cancel_url`（`TrainerBilling.tsx`）や認証コールバック
（`getAuthCallbackUrl()`）のように「このアプリ自身に戻ってくる」URLは対象外
（それぞれ別の仕組みでネイティブに対応済み・意味が異なる）。
