export const STREAK_ENABLED = false;         // 連続来店記録（ストリーク）
export const MONTHLY_REPORT_ENABLED = false; // 月次レポート画面

// 外部連携の有効/無効フラグ。
// App Store / Google OAuth 審査の都合で一時的に非表示にしているセクションを
// ここで一元管理する。外部設定が整い次第、対象フラグを true に戻すだけで再有効化できる。
// 連携済みユーザーのデータ・通知ロジックには影響しない。
export const LINE_INTEGRATION_ENABLED = true;  // LINE連携セクション
export const GOOGLE_CALENDAR_ENABLED = false;  // Googleカレンダー連携セクション（Google OAuth審査中）
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
