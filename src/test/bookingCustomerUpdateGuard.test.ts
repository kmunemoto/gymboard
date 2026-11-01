/**
 * お客様が予約の source を偽って満枠などの検査を飛ばせた・自分の予約の日時を API で満枠の時間へ動かせた穴
 * （2026-11-01・点検の拡大 bookings-source-1）。
 *   `supabase/migrations/20261101050000_booking_customer_update_guard.sql`
 *
 * 1. source='salute_sync' で INSERT すると、満枠・ブロック枠・休みの日・メニュー・限定オプションの検査が素通りした
 *    （塞ぐはずのポリシーが本番に入っていなかった）→ RESTRICTIVE のポリシーで、画面からは付けられない
 * 2. 満枠の検査は INSERT のときだけ。お客様は自分の予約を UPDATE できるので、日時・担当・メニュー・オプションを
 *    API で変えて素通りできた → お客様（その予約のジムのスタッフでない人）は枠を決める列を変えられない
 *
 * 本番で、適用前はお客様の「日時を動かす」「source を変える」が通り、適用後は拒否されること、当日の消化・
 * メモの引き継ぎ（アプリの正規の操作）と店の変更は今までどおり通ることを確かめた（mem/ops/tenant-boundary.md 穴22）。
 *
 * 🔴 壊しやすいもの:
 *   1. 20260625100000 を流す（問診の部分も未適用のままで、流すと問診のポリシーが古い形に戻る）
 *   2. アプリのお客様の UPDATE に、枠を決める列を足す（DB が断る。日時の変更は「消して作る」こと）
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (s: string) => stripSql(s).replace(/\s+/g, " ").trim();
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");

const MIGRATION = "20261101050000_booking_customer_update_guard.sql";
const SQL = norm(read(`supabase/migrations/${MIGRATION}`));
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.enforce_booking_update_guard()"));

/** 枠を決める列（お客様は UPDATE で変えられない） */
const FROZEN = [
  "booking_date", "tenant_id", "user_id", "booking_type", "source",
  "staff_user_id", "menu_id", "option_minutes", "booking_options",
];

describe("DB: source='salute_sync' は画面から付けられない", () => {
  it("🔴 INSERT に RESTRICTIVE のポリシー（anon・authenticated）", () => {
    expect(SQL).toContain("DROP POLICY IF EXISTS no_client_salute_source_insert ON public.bookings;");
    expect(SQL).toContain(
      "CREATE POLICY no_client_salute_source_insert ON public.bookings AS RESTRICTIVE FOR INSERT TO anon, authenticated " +
        "WITH CHECK (source IS DISTINCT FROM 'salute_sync');",
    );
  });

  it("後のマイグレーションがポリシーを外していない", () => {
    for (const f of migrations.filter((f) => f > MIGRATION)) {
      expect(norm(read(`supabase/migrations/${f}`)), f).not.toMatch(/DROP POLICY IF EXISTS no_client_salute_source_insert ON public\.bookings;(?! CREATE POLICY no_client_salute_source_insert)/);
    }
  });

  it("アプリは source='gymboard' しか送らない", () => {
    expect(read("src/hooks/useBookings.ts")).toContain('source: "gymboard"');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (p === join("src", "test")) continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(n) && !p.endsWith(join("integrations", "supabase", "types.ts"))) files.push(p);
      }
    };
    walk("src");
    for (const f of files) expect(code(f), f).not.toMatch(/source:\s*["']salute_sync["']/);
  });
});

describe("DB: お客様は予約の枠を決める列を UPDATE で変えられない", () => {
  it("これが enforce_booking_update_guard の最新の定義", () => {
    const last = [...migrations].reverse().find((f) => norm(read(`supabase/migrations/${f}`)).includes("CREATE OR REPLACE FUNCTION public.enforce_booking_update_guard("));
    expect(last).toBe(MIGRATION);
  });

  it("サービスロールと、その予約のジムのスタッフは今までどおり素通し", () => {
    expect(fn).toContain("IF auth.uid() IS NULL THEN RETURN NEW; END IF;");
    expect(fn).toContain("IF public.has_tenant_role(OLD.tenant_id, auth.uid(), ARRAY['owner', 'trainer']) THEN RETURN NEW; END IF;");
  });

  it("🔴 スタッフの素通しの後で、枠を決める列の変更を拒む", () => {
    const staffAt = fn.indexOf("IF public.has_tenant_role(OLD.tenant_id, auth.uid(), ARRAY['owner', 'trainer']) THEN RETURN NEW; END IF;");
    const at = fn.indexOf("IF NEW.booking_date IS DISTINCT FROM OLD.booking_date");
    expect(at).toBeGreaterThan(staffAt);
    const block = fn.slice(at, fn.indexOf("END IF;", at));
    for (const col of FROZEN) expect(block, col).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`);
    expect(block).toContain("USING ERRCODE = 'check_violation'");
  });

  it("🔴 店が取り消した予約（キャンセル済み）は、お客様からは戻せない", () => {
    expect(fn).toContain(
      "IF OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み' THEN RAISE EXCEPTION",
    );
  });

  it("今までの規則（お客様はキャンセル済みにできない・消化は当日だけ戻せる）は残っている", () => {
    expect(fn).toContain("IF NEW.status = 'キャンセル済み' AND OLD.status IS DISTINCT FROM 'キャンセル済み' THEN");
    expect(fn).toContain("IF OLD.status = '同日キャンセル済み' AND NEW.status IS DISTINCT FROM OLD.status");
  });
});

describe("アプリのお客様の UPDATE は、DB の規則の中に収まっている", () => {
  const hooks = code("src/hooks/useBookings.ts");

  it("お客様側の予約の UPDATE は status と trainer_note だけ（枠を決める列は送らない）", () => {
    const updates = [...hooks.matchAll(/from\("bookings"\)\s*\.update\(\{([^}]*)\}/g)].map((m) => m[1]);
    expect(updates.length).toBeGreaterThanOrEqual(3);
    for (const u of updates) {
      for (const col of FROZEN) expect(u, col).not.toMatch(new RegExp(`\\b${col}\\s*:`));
    }
  });

  it("日時の変更は「消して作る」（UPDATE で日時を変えない）", () => {
    expect(hooks).toContain("const { error: delError } = await cancelBooking(bookingId, false, { silent: true });");
    expect(hooks).not.toMatch(/\.update\(\{\s*booking_date/);
  });
});
