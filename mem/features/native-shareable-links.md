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
（`Capacitor.isNativePlatform()`）は本番Webドメイン（`https://app.gymboard.app`、
`PRODUCTION_WEB_ORIGIN`定数）にフォールバックし、それ以外（Web/PWA）は従来どおり
`window.location.origin` を返す。

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
