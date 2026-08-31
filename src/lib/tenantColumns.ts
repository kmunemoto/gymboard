/**
 * tenants テーブルの取得カラムと、列が無いときの既定値を1箇所にまとめる。
 *
 * なぜ必要か:
 *   マイグレーションはコミットしても即座に本番DBへ反映されるとは限らない。
 *   未適用の列を select に入れるとクエリ全体が "column does not exist" で落ち、
 *   tenant が読めずアプリ全体（プラン管理・ホーム画面など）が壊れる。
 *   そのため「新しいカラム群から順に諦めて再取得する」フォールバックを持っている。
 *
 *   以前はこのフォールバックを useTenant.ts に手書きの10段配列として持っていたため、
 *   カラムを1つ足すたびに10行を手で書き換える必要があり、書き漏らすと
 *   「設定画面には出るのに読めない」というズレが静かに入る状態だった。
 *   ここでは「追加した順のグループ配列」だけを正とし、フォールバック段は機械生成する。
 *
 *   なお「そもそも未適用のマイグレーションが無いか」は src/test/schemaDrift.test.ts が
 *   types.ts（本番DB由来の自動生成ファイル）と突き合わせて検出する。
 *   このフォールバックは、その検出をすり抜けた場合の最後の保険。
 */

/** 初期からある基本カラム。ここが引けなければ tenant は諦めるしかない */
export const TENANT_BASE_COLS =
  "id, gym_name, gym_name_short, business_type, logo_url, primary_color, address, phone, email, website_url, operating_hours, slot_duration_minutes, booking_cutoff_type, booking_cutoff_hours, status, gymboard_plan, max_customers, subscription_status, trial_ends_at";

/** ダッシュボード上部の統計カード4枚の表示可否 */
const DASHBOARD_STAT_COLS =
  "show_stat_today_sessions, show_stat_active_clients, show_stat_month_sessions, show_stat_month_revenue";

/** ホーム画面の各セクション + メニューの各タブの表示可否 */
const GYM_DISPLAY_COLS =
  "show_today_schedule, show_trial_followup_alert, show_renewal_alerts, show_counseling_responses, show_revenue_chart, show_utilization_heatmap, show_nav_messages, show_nav_exercises, show_nav_counseling, show_nav_announcements, show_nav_notifications, show_nav_trial_followups";

/**
 * 後から追加したカラム群を **追加した順（古い→新しい）** に並べたもの。
 * 新しいカラムを足すときは、この配列の末尾に1行足して既定値（下の3つのいずれか）に
 * 登録するだけでよい。フォールバック段は自動で1段増える。
 */
export const TENANT_OPTIONAL_COL_GROUPS: readonly string[] = [
  "same_day_cancel_penalty_enabled",
  "trial_info_title, trial_info_body",
  "line_url",
  "show_retention_alerts",
  "booking_buffer_minutes",
  "daily_summary_enabled",
  "google_review_url",
  DASHBOARD_STAT_COLS,
  GYM_DISPLAY_COLS,
  "booking_capacity",
  // 「同時に受けられる予約数を店に確認したか」。値そのものではなく確認の有無。
  // ⚠️ TENANT_VALUE_DEFAULTS には**入れない**。列が読めない環境では undefined のままにして、
  //    「未確認(null)」と区別できるようにする（保存できない環境で聞き続けないため）。
  "booking_capacity_confirmed_at",
  // 体験トレーニングの料金（税込・円）。ジムごとの設定で、コードに金額を書かない。
  // NULL = 料金を表示しない（従来どおり）。0 は「¥0 と明示する」で NULL とは違うため、
  // TENANT_VALUE_DEFAULTS では null を既定にしている。
  "trial_price_yen",
  // お客様に見せるキャンセルについての案内。NULL/空なら何も出さない。
  "cancel_policy_body",
  // 何日先まで予約を受け付けるか。NULL = 未設定で、画面ごとの従来の上限に従う
  // （src/lib/bookingWindow.ts）。0 を「当日のみ」と解釈しないこと。
  "booking_window_days",
  // 予約確認メール／リマインドメールに足す、店からの案内。NULL/空なら何も足さない。
  "booking_email_note, reminder_email_note",
  // 体験メールの「キャンセル・変更」欄の文章。NULL/空なら従来の固定文。
  "trial_email_cancel_note",
  // メニューに「動画」を出すか。既定 true（TENANT_DEFAULT_TRUE_COLS 側）。
  "show_nav_videos",
];

/**
 * select に渡すカラム指定を、新しいグループから順に1つずつ落としながら並べたもの。
 * 先頭（全部入り）から試し、失敗したら次へ。最後は基本カラムのみ。
 *
 * 段階的に落とすのは、例えば GYM_DISPLAY_COLS だけ未適用の環境で、
 * 適用済みの same_day_cancel_penalty_enabled まで巻き添えで既定値に落ちるのを防ぐため。
 */
export const TENANT_COL_VARIANTS: readonly string[] = Array.from(
  { length: TENANT_OPTIONAL_COL_GROUPS.length + 1 },
  (_, i) => TENANT_OPTIONAL_COL_GROUPS.length - i,
).map((keep) => [TENANT_BASE_COLS, ...TENANT_OPTIONAL_COL_GROUPS.slice(0, keep)].join(", "));

/**
 * 列が無い/未適用のとき **表示・有効** に倒す boolean 列。
 * 判定は `!== false`（＝明示的に false のときだけOFF）。
 * 新しい表示トグルは原則こちら側に入れる。列が読めない環境でも従来どおり全部出るため、
 * 「マイグレーション適用前に機能が消える」事故が起きない。
 */
export const TENANT_DEFAULT_TRUE_COLS: readonly string[] = [
  "show_retention_alerts",
  "daily_summary_enabled",
  "show_stat_today_sessions",
  "show_stat_active_clients",
  "show_stat_month_sessions",
  "show_stat_month_revenue",
  "show_today_schedule",
  "show_trial_followup_alert",
  "show_renewal_alerts",
  "show_counseling_responses",
  "show_revenue_chart",
  "show_utilization_heatmap",
  "show_nav_messages",
  "show_nav_exercises",
  "show_nav_counseling",
  "show_nav_announcements",
  "show_nav_videos",
  "show_nav_notifications",
  "show_nav_trial_followups",
];

/**
 * 列が無い/未適用のとき **無効** に倒す boolean 列。判定は `=== true`。
 * お客様に不利益が及ぶ挙動（同日キャンセルの自動消化など）は、
 * ジムが明示的にONにしたときだけ有効にする。
 */
export const TENANT_DEFAULT_FALSE_COLS: readonly string[] = [
  "same_day_cancel_penalty_enabled",
];

/** boolean 以外の列の既定値（null は「未設定」＝関連UIを出さない、の意味で使われる） */
export const TENANT_VALUE_DEFAULTS: Readonly<Record<string, unknown>> = {
  // 列が無い環境では従来どおり15分（60分セッション + 15分 = 75分フットプリント）
  booking_buffer_minutes: 15,
  // 列が無い環境では従来どおり「同時に1件だけ」。安全側（少なく見積もる）に倒す
  booking_capacity: 1,
  line_url: null,
  google_review_url: null,
  trial_info_title: null,
  trial_info_body: null,
  // 列が読めない環境では「料金を表示しない」に倒す。
  // ⚠️ 0 を既定にしないこと。0 は「¥0 と明示する」の意味になり、
  //    未適用の環境で全ジムの体験ページに「¥0」と出てしまう。
  trial_price_yen: null,
  // 既定文は持たせない。ペナルティの有無は店ごとに違うので、上流が代弁しない。
  cancel_policy_body: null,
  // 未適用の環境では「未設定」＝画面ごとの従来の上限（会員1ヶ月・公開ページ10日）。
  // ここに数字を置くと、列が読めない環境で全店の受付範囲が勝手に変わる。
  booking_window_days: null,
  // 既定文は持たせない（cancel_policy_body と同じ理由）。
  booking_email_note: null,
  reminder_email_note: null,
  // 列が読めない環境では「従来の固定文」に倒す（＝何も変わらない）。
  trial_email_cancel_note: null,
};

/**
 * select の結果（読めた列だけが入っている）を、全カラムが揃った形に整える。
 * どの段のフォールバックで取れたかに関わらず、呼び出し側は同じ形を見られる。
 */
export function normalizeTenantRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const col of TENANT_DEFAULT_TRUE_COLS) out[col] = raw[col] !== false;
  for (const col of TENANT_DEFAULT_FALSE_COLS) out[col] = raw[col] === true;
  for (const [col, fallback] of Object.entries(TENANT_VALUE_DEFAULTS)) {
    out[col] = raw[col] ?? fallback;
  }
  return out;
}

/** TENANT_OPTIONAL_COL_GROUPS に現れる個々のカラム名（テスト・検証用） */
export const tenantOptionalColumnNames = (): string[] =>
  TENANT_OPTIONAL_COL_GROUPS.flatMap((g) => g.split(",").map((c) => c.trim())).filter(Boolean);
