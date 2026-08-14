import type { Tenant } from "@/hooks/useTenant";
import type { TrainerTab } from "@/components/trainer/TrainerView";
import { TRIAL_BOOKING_ENABLED, WORKOUT_LOG_ENABLED } from "@/lib/featureFlags";

/**
 * ジム側（トレーナー画面）の表示ON/OFF設定の定義を1箇所に集約する。
 * 設定画面（TrainerGymSettings）のトグル一覧と、実際に表示を出し分ける側
 * （TrainerSidebar / TrainerDashboard）が同じ定義を参照することで、
 * 「設定にはあるが効かない」「隠したのに設定に出てこない」というズレを防ぐ。
 *
 * 表示可否はすべて `!== false` 判定（＝列が無い/未適用環境では既定で表示）。
 * 既存の show_retention_alerts / show_stat_* と同じ方針。
 */

/** tenants の boolean 列のうち、表示ON/OFFに使うものだけを抜き出した型 */
export type GymDisplayColumn =
  | "show_stat_today_sessions"
  | "show_stat_active_clients"
  | "show_stat_month_sessions"
  | "show_stat_month_revenue"
  | "show_today_schedule"
  | "show_trial_followup_alert"
  | "show_retention_alerts"
  | "show_renewal_alerts"
  | "show_counseling_responses"
  | "show_revenue_chart"
  | "show_utilization_heatmap"
  | "show_nav_messages"
  | "show_nav_exercises"
  | "show_nav_counseling"
  | "show_nav_announcements"
  | "show_nav_notifications"
  | "show_nav_trial_followups";

export interface GymDisplayToggle {
  column: GymDisplayColumn;
  /** トグルの見出し。既存画面と表記を揃えるため、原則そちらのキーを再利用する */
  labelKey: string;
}

/** ホーム画面の上部にある統計カード（4枚）。全てOFFならグリッドごと非表示。 */
export const DASHBOARD_STAT_TOGGLES: GymDisplayToggle[] = [
  { column: "show_stat_today_sessions", labelKey: "dashboard.statTodaySessions" },
  { column: "show_stat_active_clients", labelKey: "dashboard.statActiveClients" },
  { column: "show_stat_month_sessions", labelKey: "dashboard.statMonthSessions" },
  { column: "show_stat_month_revenue", labelKey: "dashboard.statMonthRevenue" },
];

/**
 * ホーム画面の各セクション。
 * 「表示ON」でも、元々そのセクションが持つ表示条件（該当データが0件なら出さない等）は
 * そのまま生きる。ここはあくまで「出す/出さない」の上位スイッチ。
 */
export const DASHBOARD_SECTION_TOGGLES: GymDisplayToggle[] = [
  { column: "show_today_schedule", labelKey: "dashboard.todaySchedule" },
  { column: "show_trial_followup_alert", labelKey: "settings.trainer.displayTrialFollowUp" },
  { column: "show_retention_alerts", labelKey: "retention.title" },
  { column: "show_renewal_alerts", labelKey: "renewal.title" },
  { column: "show_counseling_responses", labelKey: "dashboard.counselingSection" },
  { column: "show_revenue_chart", labelKey: "dashboard.revenueSection" },
  { column: "show_utilization_heatmap", labelKey: "dashboard.utilizationSection" },
];

/**
 * メニュー（サイドバー / モバイル下部ナビ）の各タブ。
 * ホーム・顧客・予約・設定は、隠すとジム自身が操作不能になり得るため対象外にしている
 * （特に設定を隠すと、この設定画面自体に戻れず元に戻せなくなる）。
 */
export const NAV_TAB_TOGGLES: { column: GymDisplayColumn; tab: TrainerTab; labelKey: string }[] = [
  { column: "show_nav_messages", tab: "messages", labelKey: "trainerNav.messages" },
  { column: "show_nav_exercises", tab: "exercises", labelKey: "trainerNav.exercises" },
  { column: "show_nav_counseling", tab: "counseling", labelKey: "trainerNav.counseling" },
  { column: "show_nav_announcements", tab: "announcements", labelKey: "trainerNav.announcements" },
  { column: "show_nav_notifications", tab: "notifications", labelKey: "trainerNav.notifications" },
  { column: "show_nav_trial_followups", tab: "trial-followups", labelKey: "trainerNav.trialFollowUps" },
];

/** 表示ON/OFFの対象となる全カラム（統計カード + ホームのセクション + メニューのタブ） */
export const ALL_DISPLAY_TOGGLES: GymDisplayToggle[] = [
  ...DASHBOARD_STAT_TOGGLES,
  ...DASHBOARD_SECTION_TOGGLES,
  ...NAV_TAB_TOGGLES,
];

/**
 * 表示量のプリセット。
 *
 * ジムボードは機能を足し続けた結果、新しいジムがいきなり17項目すべて表示された状態で
 * 始まるようになっていた。パーソナルジム1人運営で「稼働率ヒートマップ」「カウンセリング」
 * 「体験フォロー」まで最初から出ているのは、率直に言って多すぎる。
 *
 * ここでは「最初に出す量」を3段階で選べるようにする。あくまで初期値と一括切替の
 * 手段であって、個別のトグルはこれまでどおり自由に触れる。
 *
 * **既存ジムの表示は変えない。** DBの既定値は今までどおり全て true のままで、
 * このプリセットが効くのは (1) 新規ジムのオンボーディング (2) 設定画面で明示的に
 * プリセットを押したとき、の2つだけ。
 */
export type GymDisplayPreset = "simple" | "standard" | "full";

/** simple で表示するもの（ここに無い項目は非表示になる） */
const SIMPLE_COLUMNS: GymDisplayColumn[] = [
  // 毎日必ず見るものだけ: 今日の予定と、今いる顧客の数
  "show_stat_today_sessions",
  "show_stat_active_clients",
  "show_today_schedule",
  // 種目管理はトレーニング記録の前提なので残す
  "show_nav_exercises",
];

/** standard で表示するもの（simple に売上・顧客フォロー・連絡手段を足したもの） */
const STANDARD_COLUMNS: GymDisplayColumn[] = [
  ...SIMPLE_COLUMNS,
  "show_stat_month_sessions",
  "show_stat_month_revenue",
  "show_retention_alerts",
  "show_renewal_alerts",
  "show_revenue_chart",
  "show_nav_messages",
  "show_nav_announcements",
];

const PRESET_COLUMNS: Record<GymDisplayPreset, GymDisplayColumn[] | "all"> = {
  simple: SIMPLE_COLUMNS,
  standard: STANDARD_COLUMNS,
  full: "all",
};

export const GYM_DISPLAY_PRESETS: GymDisplayPreset[] = ["simple", "standard", "full"];

/** プリセットを、17項目すべてを明示した値の組に展開する（DBへはこの形で書く） */
export const presetToValues = (preset: GymDisplayPreset): Record<GymDisplayColumn, boolean> => {
  const on = PRESET_COLUMNS[preset];
  const values = {} as Record<GymDisplayColumn, boolean>;
  for (const { column } of ALL_DISPLAY_TOGGLES) {
    values[column] = on === "all" || on.includes(column);
  }
  return values;
};

/**
 * 今の設定がどのプリセットと一致するか（どれとも一致しなければ null＝カスタム）。
 * 設定画面で「今どれが選ばれているか」を示すために使う。
 */
export const detectPreset = (tenant: Tenant | null | undefined): GymDisplayPreset | null => {
  if (!tenant) return null;
  for (const preset of GYM_DISPLAY_PRESETS) {
    const values = presetToValues(preset);
    if (ALL_DISPLAY_TOGGLES.every(({ column }) => isDisplayOn(tenant, column) === values[column])) {
      return preset;
    }
  }
  return null;
};

/** 表示ONか（列が無い/未取得なら既定で表示） */
export const isDisplayOn = (tenant: Tenant | null | undefined, column: GymDisplayColumn): boolean =>
  tenant?.[column] !== false;

/**
 * そのタブをメニューに出すか。
 * NAV_TAB_TOGGLES に無いタブ（ホーム・顧客・予約・設定）は常に表示する。
 *
 * ビルド時フラグを持つタブは、フラグとジムごとのトグルの AND で決まる
 * （featureFlags.ts の「FLAG && tenant.show_xxx で合成する」方針。
 *  **下の層はOFFにできるだけで、OFFをONに戻せない**）。
 *
 * - trial-followups … TRIAL_BOOKING_ENABLED
 * - exercises … WORKOUT_LOG_ENABLED。種目マスタ（exercises テーブル）を読むのは
 *   トレーニング記録タブ・部位バランス・アバターだけなので、記録を切った業種では
 *   **編集しても誰も見ない設定**になる。
 */
export const isNavTabVisible = (tenant: Tenant | null | undefined, tab: TrainerTab): boolean => {
  if (tab === "trial-followups" && !TRIAL_BOOKING_ENABLED) return false;
  if (tab === "exercises" && !WORKOUT_LOG_ENABLED) return false;
  const entry = NAV_TAB_TOGGLES.find((n) => n.tab === tab);
  if (!entry) return true;
  return isDisplayOn(tenant, entry.column);
};
