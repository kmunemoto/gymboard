/**
 * ジム全体・全期間を読むところは、ページに分けて全件読む（2026-11-02）。
 *
 * PostgREST は1回の問い合わせで最大1000行しか返さず、超えた分は**黙って欠ける**
 * （mem/ops/postgrest-max-rows.md）。宗本さん「予定表の1000件の件も直して」。
 *
 * 🔴 壊しやすいもの:
 *   1. 予定表・お客様一覧の予約を、また1回の select で読む（1000件を超えた日から新しい予約が消える）
 *   2. ページで読むのに、並びの最後に id を付けない（同じ日時の行がページの境目で重複・欠落する）
 *   3. 件数を「行を読んで length」で数える（1000で頭打ち）
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

describe("ジム全体・全期間を読むところは fetchAllRows を通す", () => {
  it("予定表（useAllBookings）: 予約・体験・ブロックを fetchScheduleRows で読む", () => {
    const hooks = read("src/hooks/useBookings.ts");
    expect(hooks).toMatch(/= await fetchScheduleRows\(\);/);
    expect(hooks).not.toMatch(/supabase\.from\("(?:bookings|trial_bookings)"\)\.select\("\*"\)\.order\("booking_date", \{ ascending: true \}\),/);
    expect(hooks).not.toMatch(/supabase\.from\("blocked_slots"\)\.select\("\*"\),/);
    const lib = read("src/lib/scheduleRows.ts");
    for (const t of ["bookings", "trial_bookings", "blocked_slots"]) {
      expect(lib, t).toMatch(new RegExp(
        `fetchAllRows<Tables<"${t}">>\\(\\(from, to\\) =>\\s*supabase\\.from\\("${t}"\\)\\.select\\("\\*"\\)[\\s\\S]{0,200}?` +
        `\\.order\\("id", \\{ ascending: true \\}\\)\\s*\\.range\\(from, to\\), \\{ key: byId \\}\\)`,
      ));
    }
    // 予約が読めなかったときだけ error（体験・ブロックは空として続ける＝従来どおり）
    expect(lib).toMatch(/\(e: unknown\) => \(\{ data: null, error: e instanceof Error \? e : new Error\(String\(e\)\) \}\)/);
  });

  it("お客様一覧（useProfile）: 次回予約・最終来店日に使う全員の予約", () => {
    const s = read("src/hooks/useProfile.ts");
    expect(s).toMatch(/const allBookings = await fetchAllRows\(\(from, to\) =>[\s\S]{0,400}?\.in\("user_id", customerIds\)[\s\S]{0,300}?\.order\("id", \{ ascending: true \}\)\s*\.range\(from, to\),/);
  });

  it("成長グラフ（ProgressCharts）・メッセージ（useMessages）: 古い順なので切れると新しい分が消える", () => {
    expect(read("src/components/customer/ProgressCharts.tsx")).toMatch(
      /fetchAllRows\(\(from, to\) =>\s*supabase\s*\.from\("workouts"\)[\s\S]{0,300}?\.order\("id", \{ ascending: true \}\)\s*\.range\(from, to\),\s*\{ key: \(w\) => w\.id \},/,
    );
    expect(read("src/hooks/useMessages.ts")).toMatch(
      /fetchAllRows\(\(from, to\) =>\s*supabase\s*\.from\("messages"\)[\s\S]{0,300}?\.order\("id", \{ ascending: true \}\)\s*\.range\(from, to\),\s*\{ key: \(m\) => m\.id \},/,
    );
  });

  it("ダッシュボードの「フォロー待ち」は件数の問い合わせで数える（行を読んで length にしない）", () => {
    const s = read("src/components/trainer/TrainerDashboard.tsx");
    expect(s).toMatch(/\.from\("trial_bookings"\) as\s+any\)\s*\.select\("id", \{ count: "exact", head: true \}\)/);
    expect(s).toMatch(/setPendingFollowUps\(count \?\? 0\);/);
  });

  it("メールの送信記録のページ読みは、最後に id でも並べる", () => {
    expect(read("src/lib/emailLog.ts")).toMatch(/\.order\("created_at", \{ ascending: false \}\)[\s\S]{0,200}?\.order\("id", \{ ascending: false \}\)\s*\.range\(/);
  });

  it("期限のお知らせ（サーバー）もページで読む", () => {
    const s = read("supabase/functions/push-period-reminder/index.ts");
    expect(s).toMatch(/fetchAllRows\(\(from, to\) =>[\s\S]{0,300}?\.order\("id", \{ ascending: true \}\)\s*\.range\(from, to\)/);
  });
});

describe("🔴 予約・体験・ブロック・トレーニング記録を、上限なしでまとめて読む select を増やさない", () => {
  // 1人分（user_id）・1件（id）・期間（gte/lt…）・件数（limit/range/head）のどれかで絞っていない読み込みは、
  // 表が育つと1000件で黙って欠ける。全件が要るなら fetchAllRows（range）を通す。
  const TABLES = ["bookings", "trial_bookings", "blocked_slots", "workouts"];
  const NARROWING = [
    ".range(", ".limit(", "head: true", ".single(", ".maybeSingle(",
    '.eq("id"', '.in("id"', '.eq("user_id"', ".gte(", ".gt(", ".lt(", ".lte(",
  ];
  const WRITES = [".insert(", ".update(", ".upsert(", ".delete("];

  const files = [...walk("src"), ...walk("supabase/functions")].filter(
    (f) => /\.tsx?$/.test(f) && !f.startsWith("src/test/") && f !== "supabase/functions/mcp/index.ts",
  );

  /** `.from("表")` から、その問い合わせの終わり（; か次の .from( か配列の終わり）まで */
  const chainsOf = (src: string, table: string): string[] => {
    const flat = src.replace(/\s+/g, " ");
    const out: string[] = [];
    const needle = `.from("${table}")`;
    for (let i = flat.indexOf(needle); i >= 0; i = flat.indexOf(needle, i + needle.length)) {
      const rest = flat.slice(i + needle.length, i + needle.length + 900);
      const cut = Math.min(
        ...[rest.indexOf(";"), rest.indexOf(".from("), rest.indexOf("]);")].map((k) => (k < 0 ? Infinity : k)),
      );
      out.push(needle + rest.slice(0, cut === Infinity ? rest.length : cut));
    }
    return out;
  };

  it("検査が空振りしていない（予定表・成長グラフの読み込みを実際に見つけている）", () => {
    const all = files.flatMap((f) => TABLES.flatMap((t) => chainsOf(read(f), t)));
    expect(all.length).toBeGreaterThan(30);
    expect(chainsOf(read("src/lib/scheduleRows.ts"), "bookings")).toHaveLength(1);
  });

  it("絞り込みの無い読み込みが無い", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = read(f);
      for (const t of TABLES) {
        for (const chain of chainsOf(src, t)) {
          if (!chain.includes(".select(")) continue;
          if (WRITES.some((w) => chain.includes(w))) continue;
          if (NARROWING.some((n) => chain.includes(n))) continue;
          bad.push(`${f}: ${chain.slice(0, 140)}`);
        }
      }
    }
    expect(bad, "ジム全体を上限なしで読んでいる。全件が要るなら fetchAllRows を通す").toEqual([]);
  });
});
