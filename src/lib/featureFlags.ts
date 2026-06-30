export const STREAK_ENABLED = false;         // 連続来店記録（ストリーク）
export const MONTHLY_REPORT_ENABLED = false; // 月次レポート画面

// 外部連携の有効/無効フラグ。
// App Store / Google OAuth 審査の都合で一時的に非表示にしているセクションを
// ここで一元管理する。外部設定が整い次第、対象フラグを true に戻すだけで再有効化できる。
// 連携済みユーザーのデータ・通知ロジックには影響しない。
export const LINE_INTEGRATION_ENABLED = true;  // LINE連携セクション
// Googleカレンダー連携は Salute に合わせて表示範囲を分離する。
//  - ジム（トレーナー）設定: 自分の Google アカウントを連携する用途。Salute 同様に表示。
//  - お客様向け: Google OAuth 審査通過まで非表示（審査中）。審査後 true に戻すと再表示される。
export const GOOGLE_CALENDAR_TRAINER_ENABLED = true;   // ジム（トレーナー）設定の連携セクション（Salute 同様に表示）
export const GOOGLE_CALENDAR_CUSTOMER_ENABLED = false; // お客様設定の連携セクション（Google OAuth審査中のため非表示）
export const APPLE_CONNECTION_ENABLED = false; // Apple連携セクション（App Store審査中）

// キャンセル待ち（満枠スロットへの登録）。
// 既定 OFF。DBマイグレーション(booking_waitlist + RLS)を適用・検証してから true にする。
// OFF の間は予約フローの挙動は一切変わらない。
export const WAITLIST_ENABLED = false;

// ソーシャルログイン（Appleでサインイン / Googleでログイン）のボタン表示。
// 既定 OFF。Supabase の Authentication → Providers で Apple / Google を
// 有効化し OAuth 認証情報（クライアントID/シークレット・リダイレクトURL等）を
// 設定するまでは、ボタンを押すと Supabase が
// "Unsupported provider: provider is not enabled" を返し、生のエラー画面へ
// 遷移してしまう（Web では SDK が認可URLへ遷移するためコード側で抑止できない）。
// プロバイダー設定が完了したら true に戻すだけでログイン画面に再表示される。
export const SOCIAL_LOGIN_ENABLED = false;
