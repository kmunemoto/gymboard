/**
 * 予約のオプションを、店が指定したお客様だけに出す（2026-10-26）。
 *
 * 宗本さん「オプションをお店が指定した特定のお客様だけがアプリから予約の際に選べる様に
 * できる機能を追加して」。
 *
 * - オプションごとに「指定したお客様だけ」（`booking_options.restricted`）
 * - 選べるお客様は `booking_option_customers` に1行ずつ
 * - 🔴 出し分けは DB の読み取り権限（RLS）。お客様の画面は表を直接読んでいるので、
 *   指定されていないお客様には**古いアプリでも**出ない。画面側で絞る処理は持たない
 * - 🔴 API を直接叩いて付けた場合は DB が `GB010` で断る（日時の変更での引き継ぎは通す）
 * - 店の代理予約・あとから足す（GB008 の画面）は今まで通り、どのお客様にも付けられる
 *
 * 詳細は `supabase/migrations/20261026020000_booking_option_customers.sql`。
 */

/** 指定されていない限定オプションを付けようとした（お客様の自己予約だけで起きる） */
export const RESTRICTED_OPTION_SQLSTATE = "GB010";

export const isRestrictedOptionError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: unknown }).code === RESTRICTED_OPTION_SQLSTATE;

/** 保存時に「選べるお客様」をどう直すか。前と後の集合の差だけを書く（全消し→全入れはしない） */
export const allowedCustomersDiff = (
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): { add: string[]; remove: string[] } => {
  const b = new Set(before);
  const a = new Set(after);
  return {
    add: [...a].filter((id) => !b.has(id)),
    remove: [...b].filter((id) => !a.has(id)),
  };
};

/** お客様を名前（ふりがなも）で絞る。空なら全員 */
export const filterCustomersByName = <T extends { display_name: string | null; name_kana?: string | null }>(
  customers: ReadonlyArray<T>,
  query: string,
): T[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [...customers];
  return customers.filter(
    (c) => (c.display_name ?? "").toLowerCase().includes(q) || (c.name_kana ?? "").toLowerCase().includes(q),
  );
};
