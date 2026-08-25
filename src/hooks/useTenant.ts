import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { TENANT_COL_VARIANTS, normalizeTenantRow } from "@/lib/tenantColumns";

// 型の定義は src/lib/tenantTypes.ts に移した。
//
// 🔴 **lib は hooks に依存しない。** 逆向きだと、lib を型検査するだけで
//    hooks とその先のコンポーネントが引きずり込まれる（tsconfig.strict.json）。
//    ここから使っている箇所を壊さないよう再エクスポートする。
export type { Tenant } from "@/lib/tenantTypes";
import type { Tenant } from "@/lib/tenantTypes";

export interface TenantPlan {
  id: string;
  tenant_id: string;
  plan_name: string;
  plan_type: string;
  max_sessions: number | null;
  price: number;
  validity_days: number | null;
  /** サブスクのサイクル単位数。null/未設定は1。意味は cycle_unit で決まる（既定ヶ月・応当日ベース） */
  cycle_months: number | null;
  /** 利用期間の単位。'months'（応当日を含む・従来）/'weeks'/'days'。null は months */
  cycle_unit: string | null;
  /** サブスクの猶予日数。期限超過後この日数までは前サイクル分として大目に見る。null/未設定は0 */
  grace_days: number | null;
  /** このプランの予約1件あたりの占有時間（分）。null/未設定はジムの既定値（tenants.slot_duration_minutes）を継承 */
  slot_duration_minutes: number | null;
  /**
   * 上限（max_sessions）を超えた予約を許すか。true/null（既定）＝今までどおり超過できる。
   * false のとき DB の guard_booking_plan_limit が GB004 で拒否し、
   * 表示側もサイクルの自動ロールを止める（src/lib/planSessionLimit.ts）。
   */
  allow_overflow: boolean | null;
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
  /**
   * 非公開（is_active=false）も含む全プラン。**お客様自身の契約プランの解決**に使う。
   * プランを非公開にしても既存会員の profiles.plan は旧名のまま残り、DB 側
   * （guard_booking_plan_limit / check_booking_overlap）は is_active を見ずに
   * plan_name で引くため、画面だけ `plans`（有効のみ）で解決すると
   * 「カードは残りありなのに DB が GB004 で拒否し続ける」がその会員にだけ出る。
   * 選択肢（プランを選ばせる UI）には従来どおり `plans` を使うこと。
   */
  allPlans: TenantPlan[];
  loading: boolean;
}

const store: TenantStore = { userId: null, membership: null, plans: [], allPlans: [], loading: true };
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
    // is_active では絞らず全行を取り、有効な行だけを plans に分ける
    // （allPlans の用途は TenantStore のコメント参照）。
    const { data: planRows } = await supabase
      .from("tenant_plans")
      .select("*")
      .eq("tenant_id", tenant.id)
      .order("sort_order");
    if (store.userId !== userId) return;
    const all = planRows || [];
    setStore({
      membership: { tenant, role: (mem as any).role, plan_id: (mem as any).plan_id },
      plans: all.filter((p) => (p as { is_active?: boolean }).is_active !== false),
      allPlans: all,
      loading: false,
    });
  } else {
    setStore({ membership: null, plans: [], allPlans: [], loading: false });
  }
}

/** テナント情報を読み込む。force=false なら、同じユーザーで取得済みなら何もしない */
function loadTenant(userId: string | null, force: boolean): Promise<void> {
  if (!userId) {
    inflight = null;
    setStore({ userId: null, membership: null, plans: [], allPlans: [], loading: false });
    return Promise.resolve();
  }
  const sameUser = store.userId === userId;
  if (sameUser && !force) {
    // 取得済み、または取得中なら相乗りする
    if (inflight) return inflight;
    if (!store.loading) return Promise.resolve();
  }
  if (!sameUser) setStore({ userId, membership: null, plans: [], allPlans: [], loading: true });
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
  Object.assign(store, { userId: null, membership: null, plans: [], allPlans: [], loading: true });
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
    /** 非公開も含む全プラン。お客様自身の契約プランの解決はこちら（TenantStore のコメント参照） */
    allPlans: isCurrentUser ? store.allPlans : [],
    loading: isCurrentUser ? store.loading : true,
    /** 再取得して、useTenant を使っている全てのコンポーネントに反映する */
    refetch: () => loadTenant(user?.id ?? null, true),
  };
}
