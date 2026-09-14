import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { indexesOverlappingBlocks } from "@/lib/scheduleOverlap";
import { TENANT_DEFAULT_FALSE_COLS, tenantOptionalColumnNames } from "@/lib/tenantColumns";

// ────────────────────────────────────────────────────────────────
// 体験予約だけ「時間ブロック」を無視して受けられる設定（2026-09-14 宗本さんの要望）
//
// > 体験予約はお店のブロックを無視して予約できるように設定できる、
// > オンオフの機能を追加してほしい。……時間ブロックです。
//
// 宗本さんの決定:
//   - 体験のみ（ドロップインは対象外）
//   - 店ごとに1つのトグル（枠ごとのフラグは作らない）
//
// 🔴 この機能で踏みうる穴は2つ。どちらも「静かに壊れる」たぐい。
//
//   1. 画面側でブロック行を overlapping から**落とさない**と、
//      「overlapping.length >= 同時受入数」に残って数えられる。
//      本番は全20テナントが同時受入数 1（帯の設定は0件）なので、
//      早期 return を外すだけでは **ONにしても枠が1ミリも変わらない**。
//   2. DB の check_booking_overlap は bookings と共用。
//      TG_TABLE_NAME で限定しないと、会員予約・代理予約まで
//      全テナントでブロック枠を素通りする（二重予約）。
// ────────────────────────────────────────────────────────────────

const readCode = (path: string) => readFileSync(path, "utf8");

/**
 * コメントを落としてから見る。
 *
 * 🔴 この番人は3回それで空振りしかけた。説明のコメントに `NEW.booking_kind` や
 *    `overlapping.length >=` と書いてあると、素の indexOf / toMatch が
 *    **実コードを1行も見ないままコメントに当たる**。
 *    （`min_version` の番人・`dangerouslySetInnerHTML` の番人と同じ型）
 */
const stripComments = (src: string): string =>
  src.replace(/^\s*(--|\*|\/\/|\/\*).*$/gm, "");

const TRIAL = "src/pages/TrialBooking.tsx";
const DROPIN = "src/pages/DropInBooking.tsx";
const MIGRATION = "supabase/migrations/20260914010000_trial_ignores_blocked_slots.sql";
const CARD = "src/components/trainer/TrialIgnoreBlocksCard.tsx";
const WEEK = "src/components/trainer/WeekTimelineView.tsx";

const COL = "trial_ignores_blocked_slots";

describe("🔴 同時受入数の数え上げからブロックを落としていること", () => {
  const code = readCode(TRIAL);

  it("filter の中でブロック行を落としている（some() の条件付けではない）", () => {
    // ここを some() の条件付けだけで済ませると、本番の全テナント（同時受入数 1）で
    // 設定が効かない。数え上げに入る前に落とすのが要点
    expect(code).toMatch(/if \(ignoreBlocks && b\.isBlock\) return false;/);
  });

  it("落とす位置が overlapping.length の判定より前にある", () => {
    const body = stripComments(code);
    const drop = body.indexOf("if (ignoreBlocks && b.isBlock) return false;");
    const count = body.indexOf("overlapping.length >=");
    expect(drop).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(count);
  });

  it("🔴 未適用の環境では従来どおりブロックを効かせる（=== true で見る）", () => {
    // 列が無い環境では undefined。`??` や truthy 判定にすると安全側に倒れない
    expect(code).toMatch(new RegExp(`tenant\\?\\.${COL} === true`));
  });
});

describe("🔴 ドロップインと会員予約は変えていないこと", () => {
  it("ドロップインの画面はフラグを見ていない", () => {
    // 体験とドロップインは同じ trial_bookings に入るが、依頼は「体験予約は」
    expect(readCode(DROPIN)).not.toContain(COL);
  });

  it("会員側の枠判定には手を入れていない", () => {
    for (const f of ["src/hooks/useBookings.ts", "src/components/customer/CustomerBooking.tsx", "src/lib/bookedSlots.ts"]) {
      expect(readCode(f), f).not.toContain(COL);
    }
  });
});

describe("🔴 DB 側（画面だけ直すと送信で必ず落ちる）", () => {
  const sql = readCode(MIGRATION);

  it("既定は false（他ジムの挙動を変えない）", () => {
    expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${COL} BOOLEAN NOT NULL DEFAULT false`));
  });

  it("migration が誰の値も ON にしていない", () => {
    // 特定テナント専用の変更を全テナントに適用しない（CLAUDE.md）。
    // Salute で使うなら本番で個別に入れる
    expect(sql).not.toMatch(new RegExp(`UPDATE public\\.tenants[\\s\\S]{0,200}${COL}\\s*=\\s*true`));
  });

  it("🔴 緩めるのを trial_bookings に限定している（bookings と共用の関数）", () => {
    // ここを忘れると、会員の自己予約も店の代理予約も全テナントで
    // ブロック枠を素通りし、二重予約が起きる
    expect(sql).toMatch(/TG_TABLE_NAME = 'trial_bookings'/);
  });

  it("🔴 ドロップインを除いている（同じテーブルに同居）", () => {
    expect(sql).toMatch(/booking_kind', 'trial'\) = 'trial'/);
  });

  it("bookings に無い列を NEW から直接読んでいない", () => {
    // trial_bookings にしか無い列を NEW.x と書くと、会員予約の登録が実行時に落ちる
    expect(stripComments(sql)).not.toMatch(/NEW\.booking_kind/);
  });

  it("判定の緩和がブロックだけに掛かっている（同時受入数はそのまま）", () => {
    expect(sql).toMatch(/IF \(NOT v_ignore_blocks AND blocked_count > 0\) OR overlap_count >= capacity_limit THEN/);
  });

  it("既定値は false で、読めなければ false に倒れる", () => {
    expect(sql).toMatch(/v_ignore_blocks boolean := false;/);
    expect(sql).toMatch(new RegExp(`COALESCE\\(t\\.${COL}, false\\)`));
  });

  it("🔴 公開ページへ届ける（DROP → CREATE → GRANT の3点セット）", () => {
    // 返り値の型を変えるので DROP が要る。DROP すると GRANT が消えるので貼り直す
    const drop = sql.indexOf("DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);");
    const create = sql.indexOf("CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)");
    const grant = sql.indexOf("GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon");
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
    expect(grant).toBeGreaterThan(create);
    expect(sql).toMatch(new RegExp(`RETURNS TABLE\\([\\s\\S]*${COL} boolean`));
  });
});

describe("設定の読み出しと画面", () => {
  it("ログイン側は列を読み、無ければ false に倒す", () => {
    expect(tenantOptionalColumnNames()).toContain(COL);
    expect(TENANT_DEFAULT_FALSE_COLS).toContain(COL);
  });

  it("トグルは店側の設定画面に置いてある", () => {
    expect(readCode("src/components/trainer/TrainerGymSettings.tsx")).toContain("<TrialIgnoreBlocksCard />");
    expect(readCode(CARD)).toMatch(new RegExp(`tenant\\?\\.${COL} === true`));
  });

  it("ONのときだけ注意書きを出す", () => {
    expect(readCode(CARD)).toMatch(/\{enabled && \(/);
  });

  for (const lng of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
    it(`${lng}: 設定の文言がある`, () => {
      const tr = JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")).settings.trainer;
      for (const k of [
        "trialIgnoreBlocksSection", "trialIgnoreBlocksLabel", "trialIgnoreBlocksDesc",
        "trialIgnoreBlocksWarning", "trialIgnoreBlocksSaved", "trialIgnoreBlocksSaveFailed",
      ]) {
        expect(typeof tr[k], `${lng}.${k}`).toBe("string");
        expect(tr[k].length, `${lng}.${k}`).toBeGreaterThan(0);
      }
    });
  }
});

describe("🔴 予定表でブロックが体験を覆い隠さないこと", () => {
  const week = readCode(WEEK);

  it("ブロックを背面に、予約を前面に置いている", () => {
    // カードは全部 absolute left-0.5 right-0.5。z を分けないと
    // 後から描いた1枚が前の1枚を丸ごと覆う
    expect(week).toMatch(/b\.isBlocked \? "z-0" : "z-\[1\]"/);
  });

  it("ブロックと重なった予約に印を出している", () => {
    expect(week).toContain("indexesOverlappingBlocks");
    expect(week).toMatch(/onBlock \? "ring-2 ring-warning" : ""/);
    expect(week).toContain('t("schedule.overlapsBlock")');
  });

  for (const lng of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
    it(`${lng}: 重なりの文言がある`, () => {
      const s = JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")).schedule.overlapsBlock;
      expect(typeof s, lng).toBe("string");
      expect(s.length, lng).toBeGreaterThan(0);
    });
  }
});

describe("重なり判定", () => {
  const B = (startTime: string, endTime: string) => ({ startTime, endTime, isBlocked: true });
  const R = (startTime: string, endTime: string) => ({ startTime, endTime, isBlocked: false });

  it("重なっている予約を拾う", () => {
    expect([...indexesOverlappingBlocks([B("10:00", "11:00"), R("10:30", "11:30")])]).toEqual([1]);
  });

  it("🔴 端が接するだけは重なりにしない", () => {
    // 10:00-11:00 のブロックと 11:00 開始の予約は隣り合っているだけ
    expect(indexesOverlappingBlocks([B("10:00", "11:00"), R("11:00", "12:00")]).size).toBe(0);
  });

  it("ブロックが無ければ何も拾わない", () => {
    expect(indexesOverlappingBlocks([R("10:00", "11:00"), R("11:00", "12:00")]).size).toBe(0);
  });

  it("ブロック同士は見ない", () => {
    expect(indexesOverlappingBlocks([B("10:00", "12:00"), B("11:00", "13:00")]).size).toBe(0);
  });

  it("🔴 読めない時刻は静かに落とす（印が出ないだけ・安全側）", () => {
    expect(indexesOverlappingBlocks([B("なし", "11:00"), R("10:30", "11:30")]).size).toBe(0);
    expect(indexesOverlappingBlocks([B("10:00", "11:00"), R("", "")]).size).toBe(0);
  });

  it("終わりが始まりより前の行は落とす", () => {
    expect(indexesOverlappingBlocks([B("12:00", "10:00"), R("10:30", "11:30")]).size).toBe(0);
  });

  it("1つのブロックに複数の予約が重なっても全部拾う", () => {
    const got = indexesOverlappingBlocks([B("10:00", "14:00"), R("10:30", "11:30"), R("13:00", "15:00")]);
    expect([...got].sort()).toEqual([1, 2]);
  });
});
