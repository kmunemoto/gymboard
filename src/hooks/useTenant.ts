import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { TENANT_COL_VARIANTS, normalizeTenantRow } from "@/lib/tenantColumns";

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
  operating_hours: { start: string; end: string };
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
  invite_code?: string;
  status: string;
  gymboard_plan: string;
  max_customers: number | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
}

export interface TenantPlan {
  id: string;
  tenant_id: string;
  plan_name: string;
  plan_type: string;
  max_sessions: number | null;
  price: number;
  validity_days: number | null;
  /** サブスクのサイクル月数（応当日ベース）。null/未設定は1ヶ月 */
  cycle_months: number | null;
  /** サブスクの猶予日数。期限超過後この日数までは前サイクル分として大目に見る。null/未設定は0 */
  grace_days: number | null;
  /** このプランの予約1件あたりの占有時間（分）。null/未設定はジムの既定値（tenants.slot_duration_minutes）を継承 */
  slot_duration_minutes: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface TenantMembership {
  tenant: Tenant;
  role: "owner" | "trainer" | "customer";
  plan_id: string | null;
}

// ---------------------------------------------------------------------------
// テナント情報はモジュール単位で共有する
//
// 以前は useTenant() の呼び出しごとに独立した useState を持っていた（26ファイルが利用）。
// そのため設定画面で refetch しても、同時にマウントされている他のコンポーネントは
// 古いテナント情報を持ったままで、**設定を変えても画面に反映されない**という
// 分かりにくい不具合が出ていた（例: メニューのタブをOFFにしても、サイドバーは
// 画面を開き直すまでそのタブを出し続ける）。
//
// muscleGroup.ts / tenantMuscleGroups.ts と同じ「モジュール単位のキャッシュ＋購読」
// パターンで、全ての利用箇所が同じ状態を見るようにする。
// 併せて、画面を開くたびに26個ぶんの同じクエリが飛んでいた無駄も無くなる。
// ---------------------------------------------------------------------------

interface TenantStore {
  userId: string | null;
  membership: TenantMembership | null;
  plans: TenantPlan[];
  loading: boolean;
}

const store: TenantStore = { userId: null, membership: null, plans: [], loading: true };
const listeners = new Set<() => void>();
/** 同時マウント時に同じクエリを何本も投げないための共有Promise */
let inflight: Promise<void> | null = null;

const notify = () => {
  for (const listener of [...listeners]) listener();
};

const setStore = (patch: Partial<TenantStore>) => {
  Object.assign(store, patch);
  notify();
};

async function fetchTenant(userId: string): Promise<void> {
  // 取得カラムとフォールバック段、既定値は src/lib/tenantColumns.ts に集約している
  // （カラム追加時に手で10段書き換える必要をなくすため。詳細はそちらのコメント参照）。
  const memberQuery = (tenantCols: string) =>
    supabase
      .from("tenant_members")
      .select(`role, plan_id, tenants:tenant_id(${tenantCols})`)
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

  let mem: any = null;
  let memErr: any = null;
  for (const cols of TENANT_COL_VARIANTS) {
    ({ data: mem, error: memErr } = (await memberQuery(cols)) as any);
    if (!memErr) break;
    console.warn("useTenant: 追加カラム付きのtenant取得に失敗。カラムを減らして再取得します。", memErr.message);
  }

  // 取得中に別のユーザーへ切り替わっていたら、この結果は捨てる
  if (store.userId !== userId) return;

  if (mem && mem.tenants) {
    const raw = mem.tenants as unknown as Record<string, unknown>;
    // 読めなかった列を既定値で埋め、どの段で取れても同じ形にして返す。
    const tenant = normalizeTenantRow(raw) as unknown as Tenant;
    const { data: planRows } = await supabase
      .from("tenant_plans")
      .select("*")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true)
      .order("sort_order");
    if (store.userId !== userId) return;
    setStore({
      membership: { tenant, role: (mem as any).role, plan_id: (mem as any).plan_id },
      plans: planRows || [],
      loading: false,
    });
  } else {
    setStore({ membership: null, plans: [], loading: false });
  }
}

/** テナント情報を読み込む。force=false なら、同じユーザーで取得済みなら何もしない */
function loadTenant(userId: string | null, force: boolean): Promise<void> {
  if (!userId) {
    inflight = null;
    setStore({ userId: null, membership: null, plans: [], loading: false });
    return Promise.resolve();
  }
  const sameUser = store.userId === userId;
  if (sameUser && !force) {
    // 取得済み、または取得中なら相乗りする
    if (inflight) return inflight;
    if (!store.loading) return Promise.resolve();
  }
  if (!sameUser) setStore({ userId, membership: null, plans: [], loading: true });
  else if (force) setStore({ loading: true });

  inflight = fetchTenant(userId).finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * テスト用: 共有キャッシュを初期状態に戻す。
 * 購読リストは触らない（マウント中のコンポーネントの購読を切ってしまわないため）。
 */
export function __resetTenantStoreForTests() {
  inflight = null;
  Object.assign(store, { userId: null, membership: null, plans: [], loading: true });
}

export function useTenant() {
  const { user } = useAuth();
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    void loadTenant(user?.id ?? null, false);
  }, [user?.id]);

  // ログインユーザーが切り替わった直後、上の useEffect が走るまでの1レンダーは、
  // キャッシュにまだ前のユーザーのジム情報が残っている。マルチテナントなので
  // 別ジムの情報が一瞬でも見えるのは許容できないため、ユーザーIDが一致している
  // ときだけ値を返す（一致するまでは「読み込み中」として扱う）。
  const isCurrentUser = store.userId === (user?.id ?? null);
  const membership = isCurrentUser ? store.membership : null;

  return {
    membership,
    tenant: membership?.tenant ?? null,
    role: membership?.role ?? null,
    plans: isCurrentUser ? store.plans : [],
    loading: isCurrentUser ? store.loading : true,
    /** 再取得して、useTenant を使っている全てのコンポーネントに反映する */
    refetch: () => loadTenant(user?.id ?? null, true),
  };
}
