// 顧客の一括登録（CSV）— 取得と送信。
//
// csvImport.ts（純粋な解析・検証）と TrainerCustomerImport.tsx（画面）の間に挟んで、
// **DB とやり取りする部分をここに集める**。書き出し側の gymDataExport.ts と同じ構え。
//
// 🔴 取得は「テナントで絞った在籍行から出た顧客ID」で引く。
//    profiles を tenant_id で絞ってはいけない（その列は埋まっていない。
//    2026-08-25 に書き出しがこれで空欄になった。mem/features/data-export-csv.md）。

import { supabase } from "@/integrations/supabase/client";
import type { ExistingCustomer, ImportRow } from "@/lib/csvImport";

/** 1回の送信で扱う件数。Edge Function 側の MAX_ROWS と揃えること。 */
export const IMPORT_CHUNK = 100;

/** .in() は URL に載るので分割して引く（gymDataExport と同じ理由）。 */
const ID_CHUNK = 200;

/**
 * 突き合わせに使う既存顧客。
 *
 * ⚠️ 退会も含めて全部取る。退会した人をもう一度取り込むと、
 *    同じ人のカルテが2つに分かれてしまうため。
 */
export const loadExistingCustomers = async (tenantId: string): Promise<ExistingCustomer[]> => {
  const { data: members, error: mErr } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("role", "customer");
  if (mErr) throw new Error(mErr.message);

  const ids = (members ?? []).map((m) => m.user_id);
  if (ids.length === 0) return [];

  const out: ExistingCustomer[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("profiles")
      .select("display_name, phone")
      .in("user_id", ids.slice(i, i + ID_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ExistingCustomer[]));
  }
  return out;
};

/** ジムに登録されているプラン名。CSV のプラン名がこれに無ければ警告を出す。 */
export const loadPlanNames = async (tenantId: string): Promise<string[]> => {
  const { data, error } = await supabase
    .from("tenant_plans")
    .select("plan_name")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => p.plan_name).filter((n): n is string => !!n);
};

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportOutcome {
  imported: number;
  /** 途中で止まったときの理由。最後まで行けば undefined */
  error?: string;
}

/**
 * 取り込みを実行する。
 *
 * Edge Function は1回 IMPORT_CHUNK 件までしか受けないので、分割して繰り返し呼ぶ。
 * **1回の呼び出しの中は全部入るか1件も入らないか**なので、途中で失敗しても
 * 「どこまで入ったか」は件数で正確に言える（半端な行は残らない）。
 */
export const runImport = async (
  tenantId: string,
  rows: readonly ImportRow[],
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportOutcome> => {
  let imported = 0;

  for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
    const chunk = rows.slice(i, i + IMPORT_CHUNK).map((r) => ({
      display_name: r.display_name,
      name_kana: r.name_kana,
      phone: r.phone,
      plan: r.plan,
      status: r.status,
      joined_at: r.joined_at,
    }));

    const { data, error } = await supabase.functions.invoke("import-customers", {
      body: { tenant_id: tenantId, rows: chunk },
    });

    if (error) {
      return { imported, error: error.message };
    }
    const payload = data as { imported?: number; error?: string; detail?: string } | null;
    if (payload?.error) {
      return { imported, error: payload.detail || payload.error };
    }

    imported += payload?.imported ?? chunk.length;
    onProgress?.({ done: imported, total: rows.length });
  }

  return { imported };
};
