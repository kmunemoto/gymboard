// テナント（ジム）の型。
//
// 🔴 lib に置くのは、**lib が hooks に依存しないため**。
//    もともと `useTenant.ts` にあり、`gymDisplaySettings.ts` /
//    `subscriptionStatus.ts` がそこから import していた。
//    向きが逆だと、lib を型検査するだけで hooks とコンポーネントの木が
//    丸ごと引きずり込まれる（tsconfig.strict.json を入れたときに判明）。
//
// 取得やキャッシュの仕組みは `@/hooks/useTenant` のまま。ここは形だけ。

export interface Tenant {
  id: string;
  gym_name: string;
  gym_name_short: string | null;
  business_type: string;
  logo_url: string | null;
  primary_color: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  /**
   * 営業時間。曜日別（`days`）と定休日を持てる。解釈は `src/lib/businessHours.ts`。
   * `start`/`end` は**開いている曜日全体を包む包絡線**（`days` を知らない古いアプリ版が
   * 端末に残るため、そこを狭めると取れるはずの枠が消える）。
   */
  operating_hours: import("@/lib/businessHours").OperatingHours;
  slot_duration_minutes: number;
  /** 予約と予約の間に必ず空ける時間（分）。既定15分。予約の重複判定に使う（60分セッション+この値）*/
  booking_buffer_minutes: number;
  /**
   * 同じ時間帯に受けられる予約の数（ベッド数・施術者数など）。既定1＝同時1件のみ。
   * ブロック枠はこの数に関係なく店全体を塞ぐ（mem/features/booking-capacity.md）。
   */
  booking_capacity: number;
  booking_cutoff_type: string;
  /** 同時受入数を店が確認済みか。null=未確認 / undefined=列が読めない */
  booking_capacity_confirmed_at?: string | null;
  booking_cutoff_hours: number;
  same_day_cancel_penalty_enabled: boolean;
  /** トレーナーのホーム画面に「フォローが必要な顧客」を表示するか。既定true */
  show_retention_alerts: boolean;
  /** 毎朝、その日の予約一覧をオーナー/トレーナーへプッシュ通知するか。既定true */
  daily_summary_enabled: boolean;
  /** ジムのLINE連絡先URL。null/空なら「LINEで連絡」ボタンを表示しない */
  line_url: string | null;
  /** Googleの口コミ投稿ページURL。null/空なら口コミ依頼バナーを表示しない */
  google_review_url: string | null;
  /** ダッシュボード上部の統計カード表示可否（各既定true） */
  show_stat_today_sessions: boolean;
  show_stat_active_clients: boolean;
  show_stat_month_sessions: boolean;
  show_stat_month_revenue: boolean;
  /** トレーナーのホーム画面の各セクション表示可否（各既定true） */
  show_today_schedule: boolean;
  show_trial_followup_alert: boolean;
  show_renewal_alerts: boolean;
  show_counseling_responses: boolean;
  show_revenue_chart: boolean;
  show_utilization_heatmap: boolean;
  /**
   * メニュー（サイドバー/モバイル下部ナビ）の各タブ表示可否（各既定true）。
   * ホーム・顧客・予約・設定は隠すと操作不能になり得るため対象外。
   * 非表示はメニューから消えるだけで、機能自体や他画面からの遷移は生きている。
   */
  show_nav_messages: boolean;
  show_nav_exercises: boolean;
  show_nav_counseling: boolean;
  show_nav_announcements: boolean;
  show_nav_notifications: boolean;
  show_nav_trial_followups: boolean;
  /** 体験予約ページの案内カード見出し。null/空なら既定文言を表示 */
  trial_info_title: string | null;
  /** 体験予約ページの案内カード説明文。null/空なら既定文言を表示 */
  trial_info_body: string | null;
  /**
   * 体験トレーニングの料金（税込・円）。
   * null は「料金を表示しない」。**0（無料と明示する）とは別**。
   */
  trial_price_yen: number | null;
  /**
   * お客様に見せるキャンセルについての案内。
   * null/空なら**何も表示しない**（既定文は持たない。店ごとに方針が違うため）。
   */
  cancel_policy_body: string | null;
  /**
   * 何日先まで予約を受け付けるか。null = 未設定で、画面ごとの従来の上限に従う
   * （会員は1ヶ月・公開ページは10日）。解釈は `src/lib/bookingWindow.ts`。
   */
  booking_window_days: number | null;
  /** 予約確認メールに足す、店からの案内。null/空なら何も足さない。 */
  booking_email_note: string | null;
  /** 前日リマインドメールに足す、店からの案内。null/空なら何も足さない。 */
  reminder_email_note: string | null;
  /**
   * 体験の確認・リマインドメールの「キャンセル・変更」欄の文章。
   * null/空なら従来の固定文（ジムのメールアドレスへの案内）。
   * 🔴 設定時は**この文章だけ**を出す（アドレスのリンクも自動では足さない）。
   */
  trial_email_cancel_note: string | null;
  invite_code?: string;
  status: string;
  gymboard_plan: string;
  max_customers: number | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
}
