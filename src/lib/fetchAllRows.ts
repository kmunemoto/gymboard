// 1000件の壁を越えて全件読む（2026-11-02）。
//
// PostgREST（Supabase の REST）は1回の問い合わせで最大 1000 行しか返さない（max-rows の既定値）。
// 超えた分は**エラーにならず、黙って欠ける**。古い順に並べていれば、欠けるのはいちばん新しい行
// （これからの予約・最近のトレーニング記録）なので、画面からは「最近の分だけ無い」ように見える。
//
// 全件が要る読み込みは、これでページを分けて最後まで読む。詳細は mem/ops/postgrest-max-rows.md。
//
// 🔴 build には**一意に決まる並び**を付けること（最後に `.order("id")`）。
//    日時だけで並べると、同じ日時の行がページの境目をまたいだとき、問い合わせごとに並びが
//    変わりうるので、同じ行が2回出たり1行抜けたりする（同じ日のトレーニング記録・同じ時刻の
//    予約はふつうにある）。

/** 1回に読む行数。サーバーの max-rows（1000）以下にする（超えると短いページを「終わり」と誤解する） */
export const FETCH_ALL_PAGE = 1000;

/** 読みすぎの歯止め（100ページ＝10万行）。ここまで来たら打ち切って警告する */
export const FETCH_ALL_MAX_PAGES = 100;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * ページを分けて全件読む。読み込みに失敗したら Error を投げる（呼び出し側で従来どおりに扱う）。
 *
 * @param build `(from, to) => supabase.from(...).select(...).order(...).order("id").range(from, to)`
 * @param opts.key 行の一意キー。渡すと、読んでいる途中に行が増えてページがずれたときの重複を除く
 *                 （減ってずれた分の取りこぼしは防げないが、変更の通知で読み直すので次で戻る）
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { key?: (row: T) => string } = {},
): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < FETCH_ALL_MAX_PAGES; page++) {
    const from = page * FETCH_ALL_PAGE;
    const { data, error } = await build(from, from + FETCH_ALL_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      if (opts.key) {
        const k = opts.key(row);
        if (seen.has(k)) continue;
        seen.add(k);
      }
      out.push(row);
    }
    if (rows.length < FETCH_ALL_PAGE) return out;
  }
  console.warn(`fetchAllRows: ${FETCH_ALL_MAX_PAGES}ページ（${FETCH_ALL_MAX_PAGES * FETCH_ALL_PAGE}行）で打ち切りました`);
  return out;
}
