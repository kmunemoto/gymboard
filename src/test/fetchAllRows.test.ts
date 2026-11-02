/**
 * 1000件の壁を越えて全件読む（src/lib/fetchAllRows.ts。2026-11-02）。
 *
 * PostgREST は1回の問い合わせで最大1000行しか返さず、超えた分は**エラーにならず黙って欠ける**。
 * 予定表は予約を古い順に1回で読んでいたので、ジムの予約が1000件を超えると、いちばん新しい
 * （＝これからの）予約から予定表に出なくなるところだった（御所南は 2026-11 時点で688件・月150件ほど増える）。
 *
 * 🔴 壊しやすいもの:
 *   1. 短いページで終わる判定を「空のページ」まで待たずに、ちょうど1000件のときに2ページ目を読まない
 *   2. ページのずれ（読んでいる途中の追加）で同じ行を2回数える
 *   3. 失敗を飲み込んで「0件」にする（呼び出し側が従来どおりに扱えない）
 *   4. e2e 用の偽の Supabase が range の開始位置を無視する（2ページ目に1ページ目が返る）
 */
import { describe, it, expect, vi } from "vitest";
import { fetchAllRows, FETCH_ALL_MAX_PAGES, FETCH_ALL_PAGE } from "@/lib/fetchAllRows";
import { createFixtureClient } from "@/dev/fixtureClient";

type Row = { id: string; n: number };

/** 本物の PostgREST と同じく、1回に max 行までしか返さない偽のサーバー */
const fakeServer = (total: number, max = 1000) => {
  const rows: Row[] = Array.from({ length: total }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, n: i }));
  const calls: [number, number][] = [];
  const build = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + max)), error: null });
  };
  return { rows, calls, build };
};

describe("fetchAllRows: 1000件の壁を越えて全件読む", () => {
  it("1ページは1000行（本物の上限と同じ）", () => {
    expect(FETCH_ALL_PAGE).toBe(1000);
  });

  it("（直す前）1回で読むと1000件で黙って切れ、いちばん新しい行が無い", async () => {
    const s = fakeServer(2500);
    const once = await s.build(0, 9999);
    expect(once.data).toHaveLength(1000);
    expect(once.data.at(-1)?.n).toBe(999);
  });

  it("2500件 → 3ページで全部読む", async () => {
    const s = fakeServer(2500);
    const out = await fetchAllRows(s.build);
    expect(out).toHaveLength(2500);
    expect(out.at(-1)?.n).toBe(2499);
    expect(s.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("ちょうど1000件 → 2ページ目（空）まで読んで終わる（取りこぼさない）", async () => {
    const s = fakeServer(1000);
    const out = await fetchAllRows(s.build);
    expect(out).toHaveLength(1000);
    expect(s.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it("1000件未満 → 1回で終わる（問い合わせの数は今までと同じ）", async () => {
    const s = fakeServer(688);
    expect(await fetchAllRows(s.build)).toHaveLength(688);
    expect(s.calls).toHaveLength(1);
  });

  it("0件 → 空", async () => {
    const s = fakeServer(0);
    expect(await fetchAllRows(s.build)).toEqual([]);
  });

  it("読んでいる途中に行が増えてずれても、key を渡せば同じ行を2回数えない", async () => {
    const rows: Row[] = Array.from({ length: 1500 }, (_, i) => ({ id: `r${i}`, n: i }));
    let first = true;
    const build = (from: number, to: number) => {
      const page = rows.slice(from, to + 1);
      if (first) {
        first = false;
        rows.unshift({ id: "new", n: -1 }); // 1ページ目を読んだ直後に、先頭側へ1件増えた
      }
      return Promise.resolve({ data: page, error: null });
    };
    const out = await fetchAllRows(build, { key: (r) => r.id });
    expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
    expect(out.map((r) => r.id)).toContain("r1499");
  });

  it("失敗は投げる（呼び出し側が従来どおりに扱う。0件にすり替えない）", async () => {
    const build = () => Promise.resolve({ data: null, error: { message: "boom" } });
    await expect(fetchAllRows(build)).rejects.toThrow("boom");
  });

  it("終わらないときは歯止めのページ数で打ち切って警告する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const build = (from: number) => {
      calls++;
      return Promise.resolve({ data: Array.from({ length: FETCH_ALL_PAGE }, (_, i) => ({ id: `${from + i}`, n: from + i })), error: null });
    };
    const out = await fetchAllRows(build);
    expect(calls).toBe(FETCH_ALL_MAX_PAGES);
    expect(out).toHaveLength(FETCH_ALL_MAX_PAGES * FETCH_ALL_PAGE);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("e2e 用の偽の Supabase（dev:fixtures）も range の開始位置を守る", () => {
  it("range(from, to) は並べたあとで from 件読み飛ばす（2ページ目に1ページ目を返さない）", async () => {
    const c = createFixtureClient();
    const q = () => c.from("bookings").select("*").order("booking_date", { ascending: true }).order("id", { ascending: true });
    const all = (await q()).data as { id: string }[];
    expect(all.length).toBeGreaterThanOrEqual(3);
    const page = (await q().range(1, 2)).data as { id: string }[];
    expect(page.map((r) => r.id)).toEqual(all.slice(1, 3).map((r) => r.id));
  });
});
