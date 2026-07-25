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
  booking_cutoff_type: string;
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
  sort_order: number;
  is_active: boolean;
}

export interface TenantMembership {
  tenant: Tenant;
  role: "owner" | "trainer" | "customer";
  plan_id: string | null;
}

export function useTenant() {
  const { user } = useAuth();
  const [membership, setMembership] = useState<TenantMembership | null>(null);
  const [plans, setPlans] = useState<TenantPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMembership = async () => {
    if (!user) {
      setMembership(null);
      setPlans([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      // 取得カラムとフォールバック段、既定値は src/lib/tenantColumns.ts に集約している
      // （カラム追加時に手で10段書き換える必要をなくすため。詳細はそちらのコメント参照）。
      const memberQuery = (tenantCols: string) =>
        supabase
          .from("tenant_members")
          .select(`role, plan_id, tenants:tenant_id(${tenantCols})`)
          .eq("user_id", user.id)
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
      if (cancelled) return;
      if (mem && mem.tenants) {
        const raw = mem.tenants as unknown as Record<string, unknown>;
        // 読めなかった列を既定値で埋め、どの段で取れても同じ形にして返す。
        const tenant = normalizeTenantRow(raw) as unknown as Tenant;
        setMembership({
          tenant,
          role: (mem as any).role,
          plan_id: (mem as any).plan_id,
        });
        const { data: planRows } = await supabase
          .from("tenant_plans")
          .select("*")
          .eq("tenant_id", tenant.id)
          .eq("is_active", true)
          .order("sort_order");
        if (!cancelled) setPlans((planRows as TenantPlan[]) || []);
      } else {
        setMembership(null);
        setPlans([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  };

  useEffect(() => {
    let cleanupFn: (() => void) | undefined;
    fetchMembership().then((fn) => { cleanupFn = fn; });
    return () => { cleanupFn?.(); };
  }, [user]);

  return {
    membership,
    tenant: membership?.tenant ?? null,
    role: membership?.role ?? null,
    plans,
    loading,
    refetch: fetchMembership,
  };
}
