/**
 * お客様の予約の占有時間（オプション）をサーバーで決め直す・店の Google カレンダーの予定 ID を画面から書けなくする
 * （2026-11-11・定期点検 check_booking_overlap-1・enforce_booking_update_guard-1・google-calendar-sync-3）。
 *   `supabase/migrations/20261111030000_booking_insert_normalize_and_event_id_guard.sql`
 *
 * 以前は option_minutes・booking_options・google_event_id を画面（＝お客様の API）が送る値のまま入れていたので、
 * 満枠・担当の重なりの検査をすり抜けたり（オプションの時間を 0 に）、1日を塞いだり（480 に）、店の Google カレンダーの
 * 予定を増やしたり消したりできた。本番で、お客様・オーナー・インストラクター・サーバーを演じて確かめた（mem/ops/tenant-boundary.md 穴37）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { buildOptionSnapshot, parseOptionSnapshot } from "@/lib/bookingOptions";

const FILE = "20261111030000_booking_insert_normalize_and_event_id_guard.sql";
const DIR = "supabase/migrations";
const norm = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ").trim();
const SQL = norm(readFileSync(`${DIR}/${FILE}`, "utf8"));
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const fnOf = (sql: string, name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  return start < 0 ? "" : sql.slice(start, sql.indexOf("$function$;", start) + 11);
};
const lastDefining = (name: string) =>
  files.filter((f) => new RegExp(`FUNCTION public\\.${name}\\(\\)`).test(readFileSync(`${DIR}/${f}`, "utf8"))).at(-1);

describe("normalize_customer_booking_insert（BEFORE INSERT）", () => {
  const fn = fnOf(SQL, "normalize_customer_booking_insert");

  it("この定義が最新（後のマイグレーションで上書きされていない）", () => {
    expect(lastDefining("normalize_customer_booking_insert")).toBe(FILE);
  });

  it("サーバー（auth.uid() が無い）は素通し・トリガーとしてだけ動く", () => {
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("IF v_uid IS NULL THEN RETURN NEW; END IF;");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.normalize_customer_booking_insert() FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain(
      "CREATE TRIGGER aa_normalize_customer_booking BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.normalize_customer_booking_insert();",
    );
  });

  it("🔴 ログインした人の INSERT では google_event_id を必ず NULL にする（店の代理予約も。お客様だけの分岐より前）", () => {
    const nulling = fn.indexOf("NEW.google_event_id := NULL;");
    expect(nulling).toBeGreaterThan(fn.indexOf("IF v_uid IS NULL THEN RETURN NEW; END IF;"));
    expect(nulling).toBeLessThan(fn.indexOf("IF v_uid IS DISTINCT FROM NEW.user_id THEN RETURN NEW; END IF;"));
  });

  it("🔴 お客様ご自身の予約では、そのジムのオプションの表から時間と控えを作り直す（画面の値を使わない）", () => {
    expect(fn).toContain("IF v_uid IS DISTINCT FROM NEW.user_id THEN RETURN NEW; END IF;");
    expect(fn).toContain(
      "SELECT o.id, o.name, o.duration_minutes, o.price_yen INTO v_opt FROM public.booking_options o WHERE o.id = v_id AND o.tenant_id = NEW.tenant_id;",
    );
    expect(fn).toContain("v_minutes := v_minutes + GREATEST(COALESCE(v_opt.duration_minutes, 0), 0);");
    expect(fn).toContain("NEW.option_minutes := v_minutes;");
    expect(fn).toContain("NEW.booking_options := CASE WHEN jsonb_array_length(v_out) > 0 THEN v_out ELSE NULL END;");
    // 画面が送った時間・控えの中身（名前・値段・時間）は読まない
    expect(fn).not.toMatch(/NEW\.option_minutes\s*[+,)]/);
    expect(fn).not.toMatch(/v_elem\s*->>?\s*'(duration_minutes|price_yen|name)'/);
  });

  it("同じオプションの2回目・形の崩れた要素・そのジムに無い id は捨てる（時間に数えない）", () => {
    expect(fn).toContain("CONTINUE WHEN v_id IS NULL OR v_id = ANY (v_seen);");
    expect(fn).toContain("CONTINUE WHEN NOT FOUND;");
    expect(fn).toContain("v_seen := v_seen || v_id;");
    expect(fn).toContain("IF jsonb_typeof(v_elem) = 'object' THEN");
  });

  it("🔴 断らない（日時の変更とその戻しは元の控えを送る。店がオプションを消したあとに断ると、元の予約が消えたまま戻せない）", () => {
    expect(fn).not.toMatch(/RAISE/);
  });

  it("受付を止めたオプションも数える（止める前に付けた予約を日時の変更で動かせるように）", () => {
    expect(fn).not.toMatch(/\benabled\b/);
  });

  it("作り直した控えは、画面の控えと同じ形（parseOptionSnapshot がそのまま読める）", () => {
    const keys = [...fn.matchAll(/jsonb_build_object\(([^)]*)\)/g)]
      .flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((k) => k[1]))
      .sort();
    const snapshot = buildOptionSnapshot(
      [{ id: "o1", name: "Option-A", duration_minutes: 30, price_yen: 3000 } as never],
      ["o1"],
    );
    expect(keys).toEqual(Object.keys(snapshot[0]).sort());
    expect(parseOptionSnapshot([{ id: "o1", name: "Option-A", duration_minutes: 30, price_yen: 3000 }])).toEqual(snapshot);
  });

  it("🔴 option_minutes を読むほかの BEFORE INSERT の見張りより先に動く（トリガーは名前の順に動く）", () => {
    const names = new Set<string>();
    for (const f of files) {
      const src = norm(readFileSync(`${DIR}/${f}`, "utf8"));
      for (const m of src.matchAll(/CREATE TRIGGER (\w+) BEFORE (?:INSERT|UPDATE OR INSERT)\b[^;]*? ON public\.bookings\b/g)) {
        names.add(m[1]);
      }
    }
    // 本番に在る BEFORE INSERT のトリガー（2026-11-11 に pg_trigger で確かめた）
    for (const n of [
      "apply_booking_menu", "on_booking_ensure_customer", "prevent_booking_overlap", "trg_enforce_plan_limit_bookings",
      "trg_guard_booking_blocked_window", "trg_guard_booking_day_closed", "trg_guard_booking_frequency_limit",
      "trg_guard_booking_menu_teacher", "trg_guard_booking_next_cycle_payment", "trg_guard_booking_outside_hours_flag",
      "trg_guard_booking_plan_limit", "trg_guard_booking_restricted_options", "trg_guard_booking_staff_assignment",
      "trg_guard_booking_staff_shift", "trg_guard_booking_user_is_member",
    ]) names.add(n);
    names.delete("aa_normalize_customer_booking");
    expect(names.size).toBeGreaterThan(10);
    for (const n of names) {
      // Postgres は名前をバイト順で並べる（name 型）。ASCII の名前なら JS の比較と同じ
      expect("aa_normalize_customer_booking" < n, n).toBe(true);
    }
  });
});

describe("enforce_booking_update_guard（BEFORE UPDATE）", () => {
  const fn = fnOf(SQL, "enforce_booking_update_guard");
  const block =
    "IF NEW.google_event_id IS DISTINCT FROM OLD.google_event_id THEN RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。' USING ERRCODE = 'check_violation'; END IF; ";

  it("この定義が最新", () => {
    expect(lastDefining("enforce_booking_update_guard")).toBe(FILE);
  });

  it("🔴 ログインした人は google_event_id を変えられない（スタッフの早い return より前＝インストラクターも）", () => {
    const at = fn.indexOf(block);
    expect(at).toBeGreaterThan(fn.indexOf("IF auth.uid() IS NULL THEN RETURN NEW; END IF;"));
    expect(at).toBeLessThan(fn.indexOf("IF public.has_tenant_role(OLD.tenant_id, auth.uid(), ARRAY['owner', 'trainer']) THEN RETURN NEW; END IF;"));
  });

  it("前の定義（20261101050000）に、この1か所を足しただけ", () => {
    const prev = fnOf(norm(readFileSync(`${DIR}/20261101050000_booking_customer_update_guard.sql`, "utf8")), "enforce_booking_update_guard");
    expect(prev.length).toBeGreaterThan(500);
    expect(fn.replace(block, "")).toBe(prev);
  });
});

describe("画面は google_event_id を書かない（書くのは service_role の google-calendar-sync だけ）", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );

  it("insert・update の中身に google_event_id が無い", () => {
    const offenders = walk("src")
      .filter((f) => !f.startsWith("src/test/") && !f.endsWith("integrations/supabase/types.ts"))
      .filter((f) => /\.(?:insert|update|upsert)\(\s*\{[^}]*\bgoogle_event_id\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
