export const STREAK_ENABLED = false;         // 連続来店記録（ストリーク）
export const MONTHLY_REPORT_ENABLED = false; // 月次レポート画面

// 外部連携の有効/無効フラグ。
// App Store / Google OAuth 審査の都合で一時的に非表示にしているセクションを
// ここで一元管理する。外部設定が整い次第、対象フラグを true に戻すだけで再有効化できる。
// 連携済みユーザーのデータ・通知ロジックには影響しない。
export const LINE_INTEGRATION_ENABLED = true;  // LINE連携セクション
export const GOOGLE_CALENDAR_ENABLED = false;  // Googleカレンダー連携セクション（Google OAuth審査中）
export const APPLE_CONNECTION_ENABLED = false; // Apple連携セクション（App Store審査中）
