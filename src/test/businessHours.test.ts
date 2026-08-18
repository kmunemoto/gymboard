import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseTimeToMinutes,
  resolveBusinessMinutes,
  bookingSlotMinutes,
  businessGridMinutes,
  blockEndMinutes,
  minutesToTime,
  DEFAULT_OPEN_MINUTES,
  DEFAULT_CLOSE_MINUTES,
} from "@/lib/businessHours";

// **営業時間と予約枠の連動。**
//
// ── 何が起きていたか（2026-08-15 に宗本さんが実機で発見） ─────────────
// 営業時間を 23:00 にしているのに、予約は 21:00 スタートが最後だった。
// 原因は「6箇所すべてが別々の数字を直書きしていた」こと:
//
//   予約を追加 / 体験予約 / ドロップイン … 600→1260（10:00-21:00）
//   週表示 / ブロック枠の開始           … 600→1335（10:00-22:15）
//   ブロック枠の終了                     … →1290（22:30）
//
// お客様側（CustomerBooking）だけが営業時間を読んでいたので、
// **お客様は 22:00 で予約できるのに店の画面には 21:00 までしか出ない**という
// 食い違いが起きていた。設定画面には「お客様の予約画面に表示される営業時間」と
// 書いてあるのに、設定が効いていなかった。
//
// ここは「直書きが二度と戻らないこと」を機械で見張る。

const SLOT_FILES = [
  "src/components/customer/CustomerBooking.tsx",
  "src/components/trainer/TrainerSchedule.tsx",
  "src/pages/TrialBooking.tsx",
  "src/pages/DropInBooking.tsx",
];

describe("parseTimeToMinutes", () => {
  it("分を捨てない", () => {
    // 以前の parseHour は "22:30".split(":")[0] で時だけを取り、分を黙って捨てていた。
    // 設定画面は30分刻みで保存できるので、22:30 が 22:00 になっていた。
    expect(parseTimeToMinutes("22:30")).toBe(22 * 60 + 30);
    expect(parseTimeToMinutes("10:00")).toBe(600);
    expect(parseTimeToMinutes("09:05")).toBe(9 * 60 + 5);
    expect(parseTimeToMinutes("9:05")).toBe(9 * 60 + 5);
  });

  it("解釈できない値は null", () => {
    for (const bad of ["", "  ", "あ", "25:00", "10:70", "1000", "10:0", null, undefined]) {
      expect(parseTimeToMinutes(bad as string), `${JSON.stringify(bad)} が通った`).toBeNull();
    }
  });
});

describe("resolveBusinessMinutes", () => {
  it("既定値が 10:00-21:00 で固定されている", () => {
    // ⚠️ ここを DEFAULT_* 同士で比べると同語反復になり、定数を書き換えても
    //    テストが両辺とも動いて気づけない（変異検証で実際にすり抜けた）。実値で固定する。
    //    この既定値は operating_hours 未設定のテナント全部の予約可能時間を決める。
    expect(DEFAULT_OPEN_MINUTES).toBe(10 * 60);
    expect(DEFAULT_CLOSE_MINUTES).toBe(21 * 60);
    expect(resolveBusinessMinutes(null)).toEqual({ open: 600, close: 1260 });
  });

  it("設定を読む", () => {
    expect(resolveBusinessMinutes({ start: "10:00", end: "23:00" })).toEqual({ open: 600, close: 1380 });
  });

  it("未設定は既定値", () => {
    expect(resolveBusinessMinutes(null)).toEqual({ open: DEFAULT_OPEN_MINUTES, close: DEFAULT_CLOSE_MINUTES });
    expect(resolveBusinessMinutes({})).toEqual({ open: DEFAULT_OPEN_MINUTES, close: DEFAULT_CLOSE_MINUTES });
  });

  it("終業が開店以前なら既定値に落とす（枠ゼロで画面が空になるのを防ぐ）", () => {
    expect(resolveBusinessMinutes({ start: "20:00", end: "10:00" }))
      .toEqual({ open: DEFAULT_OPEN_MINUTES, close: DEFAULT_CLOSE_MINUTES });
    expect(resolveBusinessMinutes({ start: "10:00", end: "10:00" }))
      .toEqual({ open: DEFAULT_OPEN_MINUTES, close: DEFAULT_CLOSE_MINUTES });
  });
});

describe("bookingSlotMinutes（予約枠）", () => {
  const hours = { start: "10:00", end: "23:00" };

  it("🔴 報告された不具合: 営業23:00・枠60分なら最後は22:00（21:00ではない）", () => {
    const slots = bookingSlotMinutes(hours, 60);
    expect(minutesToTime(slots[slots.length - 1])).toBe("22:00");
    expect(minutesToTime(slots[0])).toBe("10:00");
  });

  it("施術が終業までに終わる（最後の開始＋枠長＝終業）", () => {
    for (const slotMin of [30, 45, 60, 90, 120]) {
      const slots = bookingSlotMinutes(hours, slotMin);
      const last = slots[slots.length - 1];
      expect(last + slotMin, `枠${slotMin}分が終業を超えた`).toBeLessThanOrEqual(23 * 60);
      expect(last + slotMin + 15, `枠${slotMin}分で1枠損している`).toBeGreaterThan(23 * 60);
    }
  });

  it("15分刻みで並ぶ", () => {
    const slots = bookingSlotMinutes(hours, 60);
    for (let i = 1; i < slots.length; i++) expect(slots[i] - slots[i - 1]).toBe(15);
  });

  it("営業時間を変えると枠も動く（設定が効いている）", () => {
    const a = bookingSlotMinutes({ start: "10:00", end: "21:00" }, 60);
    const b = bookingSlotMinutes({ start: "10:00", end: "23:00" }, 60);
    expect(minutesToTime(a[a.length - 1])).toBe("20:00");
    expect(minutesToTime(b[b.length - 1])).toBe("22:00");
  });

  it("30分刻みの営業時間も反映される", () => {
    const slots = bookingSlotMinutes({ start: "10:30", end: "22:30" }, 60);
    expect(minutesToTime(slots[0])).toBe("10:30");
    expect(minutesToTime(slots[slots.length - 1])).toBe("21:30");
  });

  it("枠が営業時間より長ければ1つも出ない", () => {
    expect(bookingSlotMinutes({ start: "10:00", end: "11:00" }, 120)).toEqual([]);
  });
});

describe("businessGridMinutes（営業時間そのもの）", () => {
  it("枠の長さを引かない。終業の1刻み前まで", () => {
    const slots = businessGridMinutes({ start: "10:00", end: "23:00" });
    expect(minutesToTime(slots[0])).toBe("10:00");
    expect(minutesToTime(slots[slots.length - 1])).toBe("22:45");
  });
});

describe("blockEndMinutes（ブロック枠の終了）", () => {
  it("開始より後から終業ちょうどまで", () => {
    const slots = blockEndMinutes({ start: "10:00", end: "23:00" }, 22 * 60);
    expect(slots.map(minutesToTime)).toEqual(["22:15", "22:30", "22:45", "23:00"]);
  });
});

describe("🔴 直書きが戻っていない", () => {
  for (const file of SLOT_FILES) {
    it(`${file} が営業時間を共有関数から取っている`, () => {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} が @/lib/businessHours を使っていません`).toMatch(/from "@\/lib\/businessHours"/);
    });

    it(`${file} に分の直書きループが無い`, () => {
      // コメントは除外して、実コードだけを見る（経緯の説明で数字に触れているため）。
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      // 600=10:00 / 1260=21:00 / 1290=22:30 / 1335=22:15 が直書きされていた
      for (const bad of [600, 1260, 1290, 1335]) {
        expect(
          new RegExp(`(<=|<|=)\\s*${bad}\\b`).test(code),
          `${file} に ${bad}（分の直書き）が戻っています。営業時間は @/lib/businessHours から取ってください。`,
        ).toBe(false);
      }
    });
  }

  it("走査対象が実在する（空振りしていない）", () => {
    for (const f of SLOT_FILES) expect(readFileSync(f, "utf8").length).toBeGreaterThan(1000);
  });
});

describe("公開ページが営業時間を受け取れる", () => {
  it("get_tenant_public が operating_hours を返す", () => {
    // 公開ページ（体験予約・ドロップイン）は anon なので、この RPC が返さないと
    // そもそも営業時間を知る手段が無い。返し忘れると直書きに戻るしかなくなる。
    const dir = "supabase/migrations";
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((s) => /FUNCTION public\.get_tenant_public/.test(s))
      .join("\n");
    expect(sql.length, "get_tenant_public のマイグレーションが見つかりません").toBeGreaterThan(100);
    const last = sql.slice(sql.lastIndexOf("DROP FUNCTION IF EXISTS public.get_tenant_public"));
    expect(last).toMatch(/operating_hours jsonb/);
    expect(last).toMatch(/t\.operating_hours/);
    // DROP すると GRANT が消える。戻していないと本番で anon が 42501 になる。
    expect(last, "DROP 後に GRANT を戻していません").toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_tenant_public\(uuid\) TO anon/,
    );
  });

  it("types.ts にも operating_hours がある", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    const block = types.slice(types.indexOf("get_tenant_public: {"), types.indexOf("get_trainer_ids: {"));
    expect(block).toMatch(/operating_hours: Json/);
  });
});
