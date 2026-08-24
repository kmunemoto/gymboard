// ジムのデータを CSV で持ち出すための「何を・どの列で出すか」の定義と取得。
//
// 組み立て（csvExport.ts）と画面（TrainerDataExport.tsx）の間に挟んで、
// **列の並びと取得クエリをここ1箇所に集める**。列を足すときはここだけ触ればよい。
//
// 🔴 取得はすべて tenant_id で絞る。RLS も同テナントに絞っているので二重の防御になるが、
//    「RLS があるから where を書かなくてよい」にはしない（他ジムのデータが混ざる事故は
//    取り返しがつかない。migrations 側の穴を1つ踏んだだけで全部漏れる）。
//
// ⚠️ 件数の上限: Supabase の1リクエストは既定1000行で暗黙に切れる。
//    CSV は「全部持ち出せる」ことが価値なので、ページングして最後まで取る（fetchAll）。

import { supabase } from "@/integrations/supabase/client";
import { formatJST } from "@/lib/timezone";
import type { CsvColumn } from "@/lib/csvExport";

/** 出せるデータの種類。画面の並び順もこの順。 */
export type ExportKind = "customers" | "bookings" | "workouts" | "measurements" | "payments";

export const EXPORT_KINDS: readonly ExportKind[] = [
  "customers",
  "bookings",
  "workouts",
  "measurements",
  "payments",
] as const;

/** 1000行の壁を越えて全件取る。取得順は呼び出し側の order に従う。 */
const PAGE = 1000;

const fetchAll = async <T,>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> => {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
};

const jstDate = (v: string | null | undefined) => (v ? formatJST(v, "yyyy-MM-dd") : "");
const jstDateTime = (v: string | null | undefined) => (v ? formatJST(v, "yyyy-MM-dd HH:mm") : "");

// ---------------------------------------------------------------------------
// 顧客
// ---------------------------------------------------------------------------

interface CustomerRow {
  user_id: string;
  display_name: string | null;
  name_kana: string | null;
  phone: string | null;
  plan: string | null;
  cycle_start_date: string | null;
  created_at: string;
  member?: {
    status: string | null;
    joined_at: string | null;
    withdrawn_on: string | null;
    withdrawal_reason: string | null;
    suspended_from: string | null;
    suspended_until: string | null;
  };
}

const customerColumns: CsvColumn<CustomerRow>[] = [
  { header: "顧客ID", value: (r) => r.user_id },
  { header: "名前", value: (r) => r.display_name },
  { header: "ふりがな", value: (r) => r.name_kana },
  { header: "電話番号", value: (r) => r.phone },
  { header: "プラン", value: (r) => r.plan },
  { header: "在籍状態", value: (r) => r.member?.status },
  { header: "利用期間の起算日", value: (r) => jstDate(r.cycle_start_date) },
  { header: "入会日", value: (r) => jstDate(r.member?.joined_at) },
  { header: "休会開始", value: (r) => jstDate(r.member?.suspended_from) },
  { header: "休会終了", value: (r) => jstDate(r.member?.suspended_until) },
  { header: "退会日", value: (r) => jstDate(r.member?.withdrawn_on) },
  { header: "退会理由", value: (r) => r.member?.withdrawal_reason },
  { header: "登録日時", value: (r) => jstDateTime(r.created_at) },
];

const fetchCustomers = async (tenantId: string): Promise<CustomerRow[]> => {
  // 在籍情報は tenant_members、人の情報は profiles に分かれているので突き合わせる
  const members = await fetchAll<{
    user_id: string; status: string | null; joined_at: string | null;
    withdrawn_on: string | null; withdrawal_reason: string | null;
    suspended_from: string | null; suspended_until: string | null;
  }>((from, to) =>
    supabase
      .from("tenant_members")
      .select("user_id, status, joined_at, withdrawn_on, withdrawal_reason, suspended_from, suspended_until")
      .eq("tenant_id", tenantId)
      .eq("role", "customer")
      .order("joined_at", { ascending: true })
      .range(from, to),
  );
  if (members.length === 0) return [];

  const profiles = await fetchAll<CustomerRow>((from, to) =>
    supabase
      .from("profiles")
      .select("user_id, display_name, name_kana, phone, plan, cycle_start_date, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .range(from, to),
  );

  const byUser = new Map(profiles.map((p) => [p.user_id, p]));
  // 在籍行を軸にする（profiles が欠けている人も1行として出す＝人数が合わなくならない）
  return members.map((m) => ({
    ...(byUser.get(m.user_id) ?? {
      user_id: m.user_id, display_name: null, name_kana: null,
      phone: null, plan: null, cycle_start_date: null, created_at: m.joined_at ?? "",
    }),
    member: m,
  }));
};

// ---------------------------------------------------------------------------
// 予約
// ---------------------------------------------------------------------------

interface BookingRow {
  id: string;
  user_id: string;
  booking_date: string;
  booking_type: string;
  status: string;
  staff_user_id: string | null;
  trainer_note: string | null;
  created_via: string | null;
  created_at: string;
}

const bookingColumns = (nameOf: (id: string | null) => string): CsvColumn<BookingRow>[] => [
  { header: "予約日", value: (r) => jstDate(r.booking_date) },
  { header: "時刻", value: (r) => (r.booking_date ? formatJST(r.booking_date, "HH:mm") : "") },
  { header: "顧客名", value: (r) => nameOf(r.user_id) },
  { header: "顧客ID", value: (r) => r.user_id },
  { header: "種別", value: (r) => r.booking_type },
  { header: "状態", value: (r) => r.status },
  { header: "担当スタッフ", value: (r) => nameOf(r.staff_user_id) },
  { header: "店側メモ", value: (r) => r.trainer_note },
  { header: "予約経路", value: (r) => r.created_via },
  { header: "登録日時", value: (r) => jstDateTime(r.created_at) },
];

const fetchBookings = (tenantId: string) =>
  fetchAll<BookingRow>((from, to) =>
    supabase
      .from("bookings")
      .select("id, user_id, booking_date, booking_type, status, staff_user_id, trainer_note, created_via, created_at")
      .eq("tenant_id", tenantId)
      .order("booking_date", { ascending: false })
      .range(from, to),
  );

// ---------------------------------------------------------------------------
// トレーニング記録
// ---------------------------------------------------------------------------

interface WorkoutRow {
  id: string;
  user_id: string;
  workout_date: string;
  exercise_id: string;
  weight: number | null;
  reps: number | null;
  sets: unknown;
  notes: string | null;
  exercises?: { name: string | null } | null;
}

/** sets(JSONB) は [{set,weight,reps}...]。1セルに畳んで「60kg×10, 60kg×8」の形にする。 */
export const formatSets = (sets: unknown, weight: number | null, reps: number | null): string => {
  if (Array.isArray(sets) && sets.length > 0) {
    return sets
      .map((s) => {
        const w = (s as { weight?: unknown }).weight;
        const r = (s as { reps?: unknown }).reps;
        return `${w ?? ""}kg×${r ?? ""}`;
      })
      .join(", ");
  }
  if (weight != null || reps != null) return `${weight ?? ""}kg×${reps ?? ""}`;
  return "";
};

const workoutColumns = (nameOf: (id: string | null) => string): CsvColumn<WorkoutRow>[] => [
  { header: "実施日", value: (r) => r.workout_date },
  { header: "顧客名", value: (r) => nameOf(r.user_id) },
  { header: "顧客ID", value: (r) => r.user_id },
  { header: "種目", value: (r) => r.exercises?.name },
  { header: "セット", value: (r) => formatSets(r.sets, r.weight, r.reps) },
  { header: "総ボリューム(kg)", value: (r) => totalVolume(r.sets, r.weight, r.reps) },
  { header: "メモ", value: (r) => r.notes },
];

/** 重量×回数の合計。負荷の推移を Excel 側で追えるように数値のまま出す。 */
export const totalVolume = (sets: unknown, weight: number | null, reps: number | null): number | "" => {
  const list = Array.isArray(sets) && sets.length > 0
    ? sets
    : weight != null || reps != null
      ? [{ weight, reps }]
      : [];
  if (list.length === 0) return "";
  const sum = list.reduce((acc: number, s) => {
    const w = Number((s as { weight?: unknown }).weight) || 0;
    const r = Number((s as { reps?: unknown }).reps) || 0;
    return acc + w * r;
  }, 0);
  return sum;
};

const fetchWorkouts = (tenantId: string) =>
  fetchAll<WorkoutRow>((from, to) =>
    supabase
      .from("workouts")
      .select("id, user_id, workout_date, exercise_id, weight, reps, sets, notes, exercises(name)")
      .eq("tenant_id", tenantId)
      .order("workout_date", { ascending: false })
      .range(from, to),
  );

// ---------------------------------------------------------------------------
// 測定（体重・体脂肪）
// ---------------------------------------------------------------------------

interface MeasurementRow {
  id: string;
  user_id: string;
  measured_date: string;
  weight: number | null;
  body_fat: number | null;
}

const measurementColumns = (nameOf: (id: string | null) => string): CsvColumn<MeasurementRow>[] => [
  { header: "測定日", value: (r) => r.measured_date },
  { header: "顧客名", value: (r) => nameOf(r.user_id) },
  { header: "顧客ID", value: (r) => r.user_id },
  { header: "体重(kg)", value: (r) => r.weight },
  { header: "体脂肪率(%)", value: (r) => r.body_fat },
];

const fetchMeasurements = (tenantId: string) =>
  fetchAll<MeasurementRow>((from, to) =>
    supabase
      .from("user_measurements")
      .select("id, user_id, measured_date, weight, body_fat")
      .eq("tenant_id", tenantId)
      .order("measured_date", { ascending: false })
      .range(from, to),
  );

// ---------------------------------------------------------------------------
// 入金
// ---------------------------------------------------------------------------

interface PaymentRow {
  id: string;
  user_id: string;
  paid_on: string;
  amount_yen: number;
  kind: string;
  method: string;
  plan_name: string | null;
  note: string | null;
  created_at: string;
}

const paymentColumns = (nameOf: (id: string | null) => string): CsvColumn<PaymentRow>[] => [
  { header: "入金日", value: (r) => r.paid_on },
  { header: "顧客名", value: (r) => nameOf(r.user_id) },
  { header: "顧客ID", value: (r) => r.user_id },
  { header: "金額(円)", value: (r) => r.amount_yen },
  { header: "種別", value: (r) => r.kind },
  { header: "支払方法", value: (r) => r.method },
  { header: "プラン", value: (r) => r.plan_name },
  { header: "メモ", value: (r) => r.note },
  { header: "記録日時", value: (r) => jstDateTime(r.created_at) },
];

const fetchPayments = (tenantId: string) =>
  fetchAll<PaymentRow>((from, to) =>
    supabase
      .from("member_payments")
      .select("id, user_id, paid_on, amount_yen, kind, method, plan_name, note, created_at")
      .eq("tenant_id", tenantId)
      .order("paid_on", { ascending: false })
      .range(from, to),
  );

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/** 顧客ID → 表示名。予約・記録・入金の CSV に名前を載せるために使う。 */
const buildNameMap = async (tenantId: string): Promise<Map<string, string>> => {
  const rows = await fetchAll<{ user_id: string; display_name: string | null }>((from, to) =>
    supabase
      .from("profiles")
      .select("user_id, display_name")
      .eq("tenant_id", tenantId)
      .range(from, to),
  );
  return new Map(rows.map((r) => [r.user_id, r.display_name ?? ""]));
};

export interface ExportResult {
  rows: unknown[];
  columns: CsvColumn<never>[];
}

/**
 * 指定した種類のデータを取得し、CSV の行と列定義を返す。
 * ここでは CSV 文字列にはしない（組み立ては csvExport.toCsv の仕事）。
 */
export const loadExport = async (kind: ExportKind, tenantId: string): Promise<ExportResult> => {
  if (kind === "customers") {
    return { rows: await fetchCustomers(tenantId), columns: customerColumns as CsvColumn<never>[] };
  }

  // 以降は顧客名を引くので、名前表を先に作る
  const names = await buildNameMap(tenantId);
  const nameOf = (id: string | null) => (id ? names.get(id) ?? "" : "");

  switch (kind) {
    case "bookings":
      return { rows: await fetchBookings(tenantId), columns: bookingColumns(nameOf) as CsvColumn<never>[] };
    case "workouts":
      return { rows: await fetchWorkouts(tenantId), columns: workoutColumns(nameOf) as CsvColumn<never>[] };
    case "measurements":
      return { rows: await fetchMeasurements(tenantId), columns: measurementColumns(nameOf) as CsvColumn<never>[] };
    case "payments":
      return { rows: await fetchPayments(tenantId), columns: paymentColumns(nameOf) as CsvColumn<never>[] };
  }
};
