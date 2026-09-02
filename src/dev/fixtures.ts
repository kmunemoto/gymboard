/**
 * 開発用のダミーデータ（`VITE_DEV_FIXTURES=1` のときだけ使われる）。
 *
 * ここのデータは **実在しない架空のジム**。本番テナント（Salute御所南）の
 * ID・名前・お客様情報は一切含めない。ログインせずに画面を確認するためだけのもの。
 *
 * 日付は「今日」を基準に組み立てる。固定日付にすると、時間が経つほど
 * 「予約が全部過去」「稼働率が常に0」になって画面確認の役に立たなくなるため。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const iso = (d: Date) => d.toISOString();

/** JSTでの「今日」の年月日 */
const jstToday = () => {
  const d = new Date(Date.now() + JST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};

/**
 * JSTの「今日 + days 日」の hour:minute を表す時刻。
 * アプリは保存済みの時刻をJSTとして表示する（toJSTDate / formatJST）。
 * ローカル時刻で作ると、コンテナのタイムゾーン（UTC）次第で予約が9時間ずれて
 * 「全部21時開始」のようなあり得ない画面になるため、JST基準で組み立てる。
 */
const shift = (days: number, hour = 10, minute = 0) => {
  const { y, m, d } = jstToday();
  return new Date(Date.UTC(y, m, d + days, hour - 9, minute));
};

/** JSTでの日付（yyyy-MM-dd） */
const dateOnly = (d: Date) => new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

export const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_OWNER_ID = "00000000-0000-4000-8000-0000000000a1";
/** お客様側の画面を確認するときにログイン扱いにするお客様（下の CUSTOMERS の1人目） */
export const DEV_CUSTOMER_ID = "00000000-0000-4000-8000-0000000000c1";

const CUSTOMERS = [
  { id: "00000000-0000-4000-8000-0000000000c1", name: "田中 花子", plan: 1, cycleOffset: -3 },
  { id: "00000000-0000-4000-8000-0000000000c2", name: "佐藤 健", plan: 1, cycleOffset: -40 },
  { id: "00000000-0000-4000-8000-0000000000c3", name: "鈴木 美咲", plan: 0, cycleOffset: -5 },
  { id: "00000000-0000-4000-8000-0000000000c4", name: "高橋 大輔", plan: 2, cycleOffset: -70 },
];

const PLAN_NAMES = ["月4回コース", "月8回コース", "16回チケット"];

const PLAN_IDS = [
  "00000000-0000-4000-8000-0000000000p1",
  "00000000-0000-4000-8000-0000000000p2",
  "00000000-0000-4000-8000-0000000000p3",
];

const EXERCISES = [
  { name: "ベンチプレス", group: "胸" },
  { name: "ラットプルダウン", group: "背中" },
  { name: "ショルダープレス", group: "肩" },
  { name: "スクワット", group: "脚" },
  { name: "ヒップスラスト", group: "お尻" },
  { name: "アームカール", group: "二頭筋" },
  { name: "トライセプスエクステンション", group: "三頭筋" },
  { name: "アブドミナルクランチ", group: "腹筋" },
];

/** テーブル名 → 行の配列。ここに無いテーブルは空配列として扱われる（画面は空表示になる） */
export function buildDevFixtures(): Record<string, Record<string, unknown>[]> {
  const now = iso(new Date());

  const exercises = EXERCISES.map((e, i) => ({
    id: `00000000-0000-4000-8000-0000000000e${i + 1}`,
    tenant_id: DEV_TENANT_ID,
    name: e.name,
    muscle_group: e.group,
    category: e.group,
    sort_order: i,
    default_sets: 3,
    default_reps: 10,
    default_weight: 40 + i * 5,
    notes: null,
    created_at: now,
    updated_at: now,
  }));

  // 予約: 過去2週間ぶんと今後1週間ぶんを、お客様に散らして作る
  const bookings: Record<string, unknown>[] = [];
  let n = 0;
  for (let d = -14; d <= 7; d++) {
    // 週末は少なめにして、稼働率ヒートマップに濃淡が出るようにする
    const weekday = shift(d).getUTCDay();
    const slots = weekday === 0 ? 1 : weekday === 6 ? 2 : 3;
    for (let s = 0; s < slots; s++) {
      const customer = CUSTOMERS[(d + s + 14) % CUSTOMERS.length];
      bookings.push({
        id: `00000000-0000-4000-8000-00000000b${String(++n).padStart(3, "0")}`,
        tenant_id: DEV_TENANT_ID,
        user_id: customer.id,
        booking_date: iso(shift(d, 10 + s * 2)),
        status: "予約済み",
        booking_type: "通常",
        source: null,
        trainer_note: d < 0 && s === 0 ? "フォーム改善中。次回は重量を上げる。" : null,
        google_event_id: null,
        created_at: now,
      });
    }
  }

  const workouts: Record<string, unknown>[] = [];
  let w = 0;
  for (let d = -30; d <= 0; d += 3) {
    for (const customer of CUSTOMERS.slice(0, 3)) {
      const ex = exercises[(w + customer.name.length) % exercises.length];
      workouts.push({
        id: `00000000-0000-4000-8000-00000000w${String(++w).padStart(3, "0")}`,
        tenant_id: DEV_TENANT_ID,
        user_id: customer.id,
        exercise_id: ex.id,
        workout_date: dateOnly(shift(d)),
        weight: 40 + (w % 6) * 5,
        reps: 10,
        sets: [
          { set: 1, weight: 40 + (w % 6) * 5, reps: 10 },
          { set: 2, weight: 40 + (w % 6) * 5, reps: 9 },
          { set: 3, weight: 40 + (w % 6) * 5, reps: 8 },
        ],
        notes: null,
        created_at: now,
      });
    }
  }

  return {
    tenants: [
      {
        id: DEV_TENANT_ID,
        gym_name: "デモ・フィットネススタジオ",
        gym_name_short: "デモジム",
        business_type: "personal_gym",
        logo_url: null,
        primary_color: "#14b8a6",
        address: "東京都千代田区1-1-1 デモビル2F",
        phone: "03-0000-0000",
        email: "demo@example.com",
        website_url: "https://example.com",
        operating_hours: { start: "09:00", end: "21:00" },
        slot_duration_minutes: 60,
        booking_buffer_minutes: 15,
        booking_cutoff_type: "hours",
        booking_cutoff_hours: 12,
        same_day_cancel_penalty_enabled: false,
        daily_summary_enabled: true,
        line_url: null,
        google_review_url: null,
        trial_info_title: null,
        trial_info_body: null,
        invite_code: "DEMO1234",
        status: "active",
        gymboard_plan: "standard",
        // Standard プランの上限（src/lib/gymboardPlans.ts の PLAN_CARDS と揃える）
        max_customers: 30,
        max_trainers: 3,
        owner_user_id: DEV_OWNER_ID,
        subscription_status: "active",
        trial_ends_at: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        // 表示トグルは全てON（＝本番の既定と同じ、全部盛りの状態を確認できる）
        show_retention_alerts: true,
        show_stat_today_sessions: true,
        show_stat_active_clients: true,
        show_stat_month_sessions: true,
        show_stat_month_revenue: true,
        show_today_schedule: true,
        show_trial_followup_alert: true,
        show_renewal_alerts: true,
        show_counseling_responses: true,
        show_revenue_chart: true,
        show_utilization_heatmap: true,
        show_nav_messages: true,
        show_nav_exercises: true,
        show_nav_counseling: true,
        show_nav_announcements: true,
        show_nav_notifications: true,
        show_nav_trial_followups: true,
        created_at: now,
        updated_at: now,
      },
    ],

    tenant_members: [
      {
        id: "00000000-0000-4000-8000-0000000000m0",
        tenant_id: DEV_TENANT_ID,
        user_id: DEV_OWNER_ID,
        role: "owner",
        status: "active",
        display_name: "デモ オーナー",
        plan_id: null,
        plan_start_date: null,
        cycle_start_date: null,
        joined_at: now,
      },
      ...CUSTOMERS.map((c, i) => ({
        id: `00000000-0000-4000-8000-0000000000m${i + 1}`,
        tenant_id: DEV_TENANT_ID,
        user_id: c.id,
        role: "customer",
        status: "active",
        display_name: c.name,
        plan_id: PLAN_IDS[c.plan],
        plan_start_date: dateOnly(shift(c.cycleOffset)),
        cycle_start_date: dateOnly(shift(c.cycleOffset)),
        joined_at: iso(shift(c.cycleOffset)),
      })),
    ],

    tenant_plans: [
      { id: PLAN_IDS[0], tenant_id: DEV_TENANT_ID, plan_name: "月4回コース", plan_type: "subscription", max_sessions: 4, price: 22000, validity_days: null, cycle_months: 1, grace_days: 3, sort_order: 0, is_active: true, allow_overflow: false, created_at: now },
      { id: PLAN_IDS[1], tenant_id: DEV_TENANT_ID, plan_name: "月8回コース", plan_type: "subscription", max_sessions: 8, price: 40000, validity_days: null, cycle_months: 1, grace_days: 3, sort_order: 1, is_active: true, allow_overflow: false, created_at: now },
      { id: PLAN_IDS[2], tenant_id: DEV_TENANT_ID, plan_name: "16回チケット", plan_type: "ticket", max_sessions: 16, price: 76000, validity_days: 180, cycle_months: null, grace_days: null, sort_order: 2, is_active: true, allow_overflow: false, created_at: now },
    ],

    profiles: [
      {
        id: "00000000-0000-4000-8000-0000000000f0",
        user_id: DEV_OWNER_ID,
        tenant_id: DEV_TENANT_ID,
        display_name: "デモ オーナー",
        avatar_url: null,
        plan: null,
        cycle_start_date: null,
        training_goal: null,
        grace_enabled: true,
        game_mode_enabled: false,
        show_usage_period: true,
        paid_this_month: true,
        trial_completed: true,
        best_streak: 0,
        last_streak_notified: 0,
        calendar_token: "dev-owner-token",
        line_user_id: null,
        review_prompted_at: null,
        created_at: now,
        updated_at: now,
      },
      ...CUSTOMERS.map((c, i) => ({
        id: `00000000-0000-4000-8000-0000000000f${i + 1}`,
        user_id: c.id,
        tenant_id: DEV_TENANT_ID,
        display_name: c.name,
        avatar_url: null,
        // 売上集計・契約状態の表示は tenant_members.plan_id ではなく
        // profiles.plan（プラン「名」の文字列）を見ている
        plan: PLAN_NAMES[c.plan],
        cycle_start_date: dateOnly(shift(c.cycleOffset)),
        training_goal: i === 0 ? "3ヶ月で体脂肪率5%減" : null,
        grace_enabled: true,
        game_mode_enabled: false,
        show_usage_period: true,
        paid_this_month: true,
        trial_completed: true,
        best_streak: 3,
        last_streak_notified: 0,
        calendar_token: `dev-token-${i}`,
        line_user_id: null,
        review_prompted_at: null,
        created_at: now,
        updated_at: now,
      })),
    ],

    user_roles: [
      { id: "00000000-0000-4000-8000-0000000000r0", user_id: DEV_OWNER_ID, role: "trainer" },
      ...CUSTOMERS.map((c, i) => ({
        id: `00000000-0000-4000-8000-0000000000r${i + 1}`,
        user_id: c.id,
        role: "customer",
      })),
    ],

    tenant_muscle_groups: ["胸", "背中", "肩", "脚", "お尻", "二頭筋", "三頭筋", "腹筋"].map((name, i) => ({
      id: `00000000-0000-4000-8000-0000000000g${i + 1}`,
      tenant_id: DEV_TENANT_ID,
      name,
      sort_order: i,
      created_at: now,
    })),

    exercises,
    bookings,
    workouts,

    trial_bookings: [
      {
        id: "00000000-0000-4000-8000-0000000000t1",
        tenant_id: DEV_TENANT_ID,
        guest_name: "体験 太郎",
        guest_contact: "taro@example.com",
        booking_date: iso(shift(2, 14)),
        booking_type: "初回無料体験",
        booking_kind: "trial",
        status: "予約済み",
        follow_up_status: "pending",
        follow_up_note: null,
        cancel_token: "dev-cancel-token-1",
        google_event_id: null,
        created_at: now,
      },
      {
        id: "00000000-0000-4000-8000-0000000000t2",
        tenant_id: DEV_TENANT_ID,
        guest_name: "体験 次郎",
        guest_contact: "jiro@example.com",
        booking_date: iso(shift(-3, 11)),
        booking_type: "初回無料体験",
        booking_kind: "trial",
        status: "予約済み",
        follow_up_status: "pending",
        follow_up_note: null,
        cancel_token: "dev-cancel-token-2",
        google_event_id: null,
        created_at: now,
      },
    ],

    blocked_slots: [
      {
        id: "00000000-0000-4000-8000-0000000000s1",
        tenant_id: DEV_TENANT_ID,
        blocked_date: iso(shift(4, 9)),
        end_blocked_date: iso(shift(4, 12)),
        reason: "設備メンテナンス",
        source: null,
        created_by: DEV_OWNER_ID,
        created_at: now,
      },
    ],
    // 予約オプション（トレーニング後のストレッチ等）。開発中に画面で確認するため。
    booking_options: [
      {
        id: "00000000-0000-4000-8000-0000000000o1",
        tenant_id: DEV_TENANT_ID,
        name: "ストレッチ",
        duration_minutes: 30,
        price_yen: 3000,
        description: null,
        enabled: true,
        sort_order: 0,
        created_at: now,
        updated_at: now,
      },
      {
        id: "00000000-0000-4000-8000-0000000000o2",
        tenant_id: DEV_TENANT_ID,
        name: "プロテイン",
        duration_minutes: 0,
        price_yen: 500,
        description: null,
        enabled: true,
        sort_order: 1,
        created_at: now,
        updated_at: now,
      },
    ],
  };
}
