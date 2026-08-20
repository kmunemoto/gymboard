import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BOOKING_WINDOW_MAX_DAYS,
  BOOKING_WINDOW_MIN_DAYS,
  BOOKING_WINDOW_OPTIONS,
  LEGACY_GUEST_WINDOW_DAYS,
  LEGACY_MEMBER_WINDOW_MONTHS,
  bookingWindowEnd,
  bookingWindowEndDateKey,
  isBeyondBookingWindow,
  normalizeBookingWindowDays,
} from "@/lib/bookingWindow";

// 受付開始時期（何日先まで予約を受けるか / tenants.booking_window_days）。
//
// 締切（bookingCutoff）は「手前」の締めしか決められず、「先」の上限は
// **設定がどこにも無く、画面ごとに違う数字が直書き**されていた:
//   お客様の予約 1ヶ月 / 体験・ドロップイン 10日 / 店側の代理予約 無制限。
//
// このテストが守る不変条件:
//   1. **NULL（未設定）なら画面ごとの従来の上限がそのまま出る**（列を足しただけで挙動が変わらない）
//   2. 0・負・範囲外は未設定に倒す（0 を「当日のみ」と解釈すると設定ミスで店が止まる）
//   3. 比較は日付キーの文字列で行う（getJSTNow() の .getTime() は実時刻ではない）
//
// 変異検証（2026-08-20、6件すべて赤を確認）:
//   - normalize の下限 1 を 0 にする → 「0 は未設定」が赤
//   - normalize の上限チェックを外す → 「366日は未設定」が赤
//   - bookingWindowEnd の addDays を addMonths にする → 「30日先」が赤
//   - isBeyondBookingWindow の `>` を `>=` にする → 「上限日の当日は取れる」が赤
//   - 公開ページの LEGACY_GUEST_WINDOW_DAYS を 30 にする → 「従来の10日」が赤
//   - CustomerBooking の toDate を addMonths 直書きに戻す → 配線テストが赤

// 2026-08-20（木）12:00 JST を基準にする。JST プロキシと同じ形（ローカルのゲッターが
// JSTの壁時計を返す）を作るため、UTC で書いてから TZ 非依存に組み立てる。
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

describe("normalizeBookingWindowDays", () => {
  it("使える値はそのまま整数で返る", () => {
    expect(normalizeBookingWindowDays(1)).toBe(1);
    expect(normalizeBookingWindowDays(30)).toBe(30);
    expect(normalizeBookingWindowDays(365)).toBe(365);
    expect(normalizeBookingWindowDays(30.9)).toBe(30);
  });

  it("🔴 0 は「当日のみ」ではなく未設定に倒す", () => {
    // 0 を「当日しか取れない」と解釈すると、設定ミス1つで店の予約が全部止まる。
    // 止めたいなら定休日か締切で止めるのが筋。
    expect(normalizeBookingWindowDays(0)).toBeNull();
    expect(normalizeBookingWindowDays(-5)).toBeNull();
  });

  it("範囲外・型違いは未設定", () => {
    for (const bad of [366, 1000, NaN, Infinity, "30", null, undefined, {}, []]) {
      expect(normalizeBookingWindowDays(bad), `${JSON.stringify(bad)} が通った`).toBeNull();
    }
  });

  it("下限・上限が 1〜365 で固定されている", () => {
    // 定数同士で比べると同語反復になるので実値で固定する。
    expect(BOOKING_WINDOW_MIN_DAYS).toBe(1);
    expect(BOOKING_WINDOW_MAX_DAYS).toBe(365);
    for (const d of BOOKING_WINDOW_OPTIONS) {
      expect(normalizeBookingWindowDays(d), `選択肢 ${d} が範囲外`).toBe(d);
    }
  });
});

describe("🔴 未設定なら従来の上限がそのまま出る", () => {
  const now = at(2026, 8, 20);

  it("会員の予約は1ヶ月先まで（従来どおり）", () => {
    expect(LEGACY_MEMBER_WINDOW_MONTHS).toBe(1);
    expect(bookingWindowEndDateKey(null, { months: LEGACY_MEMBER_WINDOW_MONTHS }, now)).toBe("2026-09-20");
    expect(bookingWindowEndDateKey(undefined, { months: LEGACY_MEMBER_WINDOW_MONTHS }, now)).toBe("2026-09-20");
  });

  it("公開ページ（体験・ドロップイン）は10日先まで（従来どおり）", () => {
    expect(LEGACY_GUEST_WINDOW_DAYS).toBe(10);
    expect(bookingWindowEndDateKey(null, { days: LEGACY_GUEST_WINDOW_DAYS }, now)).toBe("2026-08-30");
  });

  it("0 を保存しても従来どおりに戻る（店を止めない）", () => {
    expect(bookingWindowEndDateKey(0, { days: LEGACY_GUEST_WINDOW_DAYS }, now)).toBe("2026-08-30");
  });
});

describe("設定した日数が効く", () => {
  const now = at(2026, 8, 20);

  it("日数ぶん先まで受け付ける", () => {
    expect(bookingWindowEndDateKey(30, { months: 1 }, now)).toBe("2026-09-19");
    expect(bookingWindowEndDateKey(7, { days: 10 }, now)).toBe("2026-08-27");
    expect(bookingWindowEndDateKey(1, { days: 10 }, now)).toBe("2026-08-21");
  });

  it("🔴 上限日の当日は取れる（境界を1日ぶん取りこぼさない）", () => {
    const cfg = 7;
    expect(isBeyondBookingWindow("2026-08-27", cfg, { days: 10 }, now)).toBe(false); // ちょうど上限
    expect(isBeyondBookingWindow("2026-08-28", cfg, { days: 10 }, now)).toBe(true); // 1日先
  });

  it("今日・過去日は範囲外にならない（過去の判定は別の関数の仕事）", () => {
    expect(isBeyondBookingWindow("2026-08-20", 7, { days: 10 }, now)).toBe(false);
    expect(isBeyondBookingWindow("2026-01-01", 7, { days: 10 }, now)).toBe(false);
    expect(isBeyondBookingWindow("", 7, { days: 10 }, now)).toBe(false);
    expect(isBeyondBookingWindow(null, 7, { days: 10 }, now)).toBe(false);
  });

  it("時刻の切り捨てで境界がぶれない（朝でも夜でも同じ）", () => {
    for (const h of [0, 9, 12, 23]) {
      expect(bookingWindowEndDateKey(7, { days: 10 }, at(2026, 8, 20, h))).toBe("2026-08-27");
    }
  });

  it("bookingWindowEnd は Date を返す（カレンダーの toDate 用）", () => {
    const end = bookingWindowEnd(7, { days: 10 }, now);
    expect(end).toBeInstanceOf(Date);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth() + 1).toBe(8);
    expect(end.getDate()).toBe(27);
  });
});

describe("🔴 画面がこの関数を使っている（直書きが戻っていない）", () => {
  it("お客様の予約カレンダーが店の設定を見ている", () => {
    const src = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8");
    expect(src, "toDate が addMonths の直書きに戻っています").not.toMatch(/toDate=\{addMonths\(/);
    expect(src).toMatch(/toDate=\{maxBookableDate\}/);
    expect(src).toMatch(/bookingWindowEnd\(bookingWindowDays, \{ months: LEGACY_MEMBER_WINDOW_MONTHS \}\)/);
    // 定期予約の上限も同じ範囲に従う（ここを忘れると4回目だけ範囲外に作られる）
    expect(src).toMatch(/maxRepeatWeeksFor\(selectedDate, maxBookableDate\)/);
  });

  it("公開ページが店の設定を見ている", () => {
    for (const f of ["src/pages/TrialBooking.tsx", "src/pages/DropInBooking.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} に上限日数の直書きが残っています`).not.toMatch(/MAX_DAYS_AHEAD/);
      expect(src).toMatch(/isBeyondBookingWindow\(\s*yyyyMMdd,\s*tenant\?\.booking_window_days \?\? null,\s*\{ days: LEGACY_GUEST_WINDOW_DAYS \},?\s*\)/);
    }
  });

  it("🔴 店側の代理予約には受付期間をかけていない（意図的）", () => {
    // 「何日先まで受け付けるか」はお客様に向けた制限であって、店が自分で入れる
    // 予約の制限ではない（電話で3ヶ月先を押さえたい、はあり得る）。
    // ここが将来「効かせ忘れ」と誤解されて足されると、店の運用が黙って狭まる。
    const src = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
    expect(src, "代理予約に受付期間の制限が入りました。意図的に外してあります").not.toMatch(
      /isBeyondBookingWindow\(/,
    );
    // ただし定休日とシフトは塞ぐ（実際に営業していない・出勤していないため）
    expect(src).toMatch(/isClosedDate\(tenant\?\.operating_hours,/);
    expect(src).toMatch(/staffWorksOnWeekday\(/);
  });

  it("走査対象が実在する（空振りしていない）", () => {
    for (const f of [
      "src/components/customer/CustomerBooking.tsx",
      "src/pages/TrialBooking.tsx",
      "src/pages/DropInBooking.tsx",
    ]) {
      expect(readFileSync(f, "utf8").length).toBeGreaterThan(1000);
    }
  });
});

describe("設定が公開ページまで届く", () => {
  const dir = "supabase/migrations";
  const allSql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");

  it("列と CHECK 制約がある", () => {
    expect(allSql).toMatch(/ADD COLUMN IF NOT EXISTS booking_window_days INTEGER/);
    expect(allSql).toMatch(/booking_window_days BETWEEN 1 AND 365/);
  });

  it("🔴 既存テナントに値を backfill していない", () => {
    // backfill すると、列を足しただけで全店の受付範囲が変わる。
    // cancel_policy と同じ方針（src/test/cancelPolicy.test.ts）。
    expect(allSql).not.toMatch(/UPDATE public\.tenants[\s\S]{0,200}booking_window_days\s*=/);
  });

  it("get_tenant_public が booking_window_days を返し、GRANT も戻している", () => {
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((s) => /FUNCTION public\.get_tenant_public/.test(s))
      .join("\n");
    const last = sql.slice(sql.lastIndexOf("DROP FUNCTION IF EXISTS public.get_tenant_public"));
    expect(last).toMatch(/booking_window_days integer/);
    expect(last).toMatch(/t\.booking_window_days/);
    // DROP すると GRANT が消える。戻していないと本番で anon が 42501 になる。
    expect(last, "DROP 後に GRANT を戻していません").toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_tenant_public\(uuid\) TO anon/,
    );
  });

  it("types.ts と公開ページの型が揃っている", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    const block = types.slice(types.indexOf("get_tenant_public: {"), types.indexOf("get_trainer_ids: {"));
    // ⚠️ 列の**有無**だけを見る。`| null` を書くかどうかは types.ts の**生成器の都合**で、
    //    RETURNS TABLE の列に生成器は nullability を付けない（既存の address / trial_price_yen も
    //    同じく非 null になっている）。手で書いた形を固定すると、Lovable が本番DBから
    //    再生成した瞬間に落ちる（2026-08-20 に実際に落ちた）。
    //    実際の NULL 可能性は公開ページ側の PublicTenant が `| null` で受けている。
    expect(block).toMatch(/booking_window_days: number/);
    for (const f of ["src/pages/TrialBooking.tsx", "src/pages/DropInBooking.tsx"]) {
      expect(readFileSync(f, "utf8"), `${f} の PublicTenant に列がありません`).toMatch(
        /booking_window_days: number \| null;/,
      );
    }
  });

  it("ログイン側のカラム取得にも載っている", () => {
    const cols = readFileSync("src/lib/tenantColumns.ts", "utf8");
    expect(cols).toMatch(/"booking_window_days"/);
    // 未適用の環境で「未設定」に倒れること（数字を既定にすると全店の範囲が勝手に変わる）
    expect(cols).toMatch(/booking_window_days: null/);
  });
});
