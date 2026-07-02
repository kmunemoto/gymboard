export const STREAK_ENABLED = false;         // 連続来店記録（ストリーク）
export const MONTHLY_REPORT_ENABLED = false; // 月次レポート画面

// 外部連携の有効/無効フラグ。
// App Store / Google OAuth 審査の都合で一時的に非表示にしているセクションを
// ここで一元管理する。外部設定が整い次第、対象フラグを true に戻すだけで再有効化できる。
// 連携済みユーザーのデータ・通知ロジックには影響しない。
export const LINE_INTEGRATION_ENABLED = true;  // LINE連携セクション
// Googleカレンダー連携の表示フラグ。Salute プロジェクトの OAuth クライアントを流用。
//  - ジム（トレーナー）設定: 自分の Google アカウントを連携する用途。
//  - お客様向け: 全テナントで表示。OAuth 同意画面は審査通過済みのため、一般のお客様も
//    警告なしで連携できる（calendar.events は機密スコープ）。
export const GOOGLE_CALENDAR_TRAINER_ENABLED = true;  // ジム（トレーナー）設定の連携セクション
export const GOOGLE_CALENDAR_CUSTOMER_ENABLED = true; // お客様設定の連携セクション（全テナントで表示）
export const APPLE_CONNECTION_ENABLED = false; // Apple連携セクション（App Store審査中）

// キャンセル待ち（満枠スロットへの登録）。
// ON: 満枠スロットにキャンセル待ち登録でき、キャンセルで枠が空くと
// その枠の待機者へプッシュ通知が届く（send-push-notification の
// waitlist_slot_freed。受信者解決・文言生成はサーバー側）。
// 予約成立時は自分の該当待機を自動解除する。
// 前提: DBマイグレーション booking_waitlist（20260624120000）と
// send-push-notification の再デプロイが適用済みであること。
export const WAITLIST_ENABLED = true;

// ソーシャルログイン（Appleでサインイン / Googleでログイン）のボタン表示。
// 既定 OFF。Supabase の Authentication → Providers で Apple / Google を
// 有効化し OAuth 認証情報（クライアントID/シークレット・リダイレクトURL等）を
// 設定するまでは、ボタンを押すと Supabase が
// "Unsupported provider: provider is not enabled" を返し、生のエラー画面へ
// 遷移してしまう（Web では SDK が認可URLへ遷移するためコード側で抑止できない）。
// プロバイダー設定が完了したら true に戻すだけでログイン画面に再表示される。
export const SOCIAL_LOGIN_ENABLED = false;

// ジムボードの課金システム（GymBoard SaaS の料金・トライアル・席数上限・延滞ブロック）。
// false にすると課金まわりを一括で無効化し、ジムは無料・無制限で利用できる。
//   - 課金UI（設定の「プラン・お支払い」= TrainerBilling）を非表示
//   - 席数超過/延滞の警告バナー（PlanLimitBanner / SubscriptionBlockedBanner）を非表示
//   - クライアントの延滞判定 isTenantSubscriptionBlocked を常に false に
// ※ サーバー側の実強制（DBトリガー enforce_tenant_plan_limit）は別マイグレーション
//    （supabase/migrations/..._disable_billing_enforcement.sql）で無効化する。
// 復活方法: この値を true に戻し、上記マイグレーションを差し戻すだけ。
// コードは一切削除しないため、課金機能はそのまま温存される。
export const BILLING_ENABLED = true;
