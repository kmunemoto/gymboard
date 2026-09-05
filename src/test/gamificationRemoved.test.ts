import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

// ゲーム要素の撤去（2026-09-05）。第1段→第2段a→第2段b で消し切った。
//
// 宗本さん:「今の予約や記録を削除してしまったり、してしまわないようにお願い」
//
// ── ここで守りたいこと ────────────────────────────────────────────
//
//  1. 🔴 **消したテーブル・関数を、コードが二度と呼ばないこと。**
//     types.ts には Lovable が再生成するまで型が残るので、
//     `.from("user_avatars")` と書いても TS は通ってしまう（実行時に落ちる）
//  2. 🔴 **消してはいけないものを消していないこと。**
//     `booking_questions`（quest に当たる）／`weight_journey`（体重目標）／
//     `user_measurements`（体組成）／`clientDetail.expiry`（契約の有効期限）
//  3. マイグレーションが CASCADE を使っていないこと

const MIGRATION_PATH = "supabase/migrations/20260905020000_drop_gamification.sql";
const SQL = readFileSync(MIGRATION_PATH, "utf8")
  .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

/** 落としたテーブル。マイグレーションの DROP TABLE から機械的に取る */
const droppedTables = (): string[] => {
  const m = SQL.match(/DROP TABLE IF EXISTS([\s\S]*?);/);
  // ⚠️ 末尾に CASCADE などが付いていても拾えるようにする。
  //    素朴に trim しただけだと "booking_questions CASCADE" になり、
  //    「実機能が混ざっていないか」の検査をすり抜ける（変異検証で実際に抜けた）
  return (m?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^public\./, "").split(/\s+/)[0])
    .filter(Boolean);
};

/** 落とした関数名 */
const droppedFunctions = (): string[] => {
  const m = SQL.match(/DROP FUNCTION IF EXISTS([\s\S]*?);\s*$/);
  return (m?.[1] ?? "")
    .split(",").map((s) => s.trim().replace(/^public\./, "").replace(/\(.*$/, "")).filter(Boolean);
};

const srcFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p) && p !== "src/integrations/supabase/types.ts") out.push(p);
    }
  };
  walk("src");
  if (existsSync("supabase/functions")) {
    const walkFn = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walkFn(p);
        else if (/\.ts$/.test(p)) out.push(p);
      }
    };
    walkFn("supabase/functions");
  }
  return out;
};

describe("消したテーブルを二度と呼ばない", () => {
  const tables = droppedTables();
  const files = srcFiles().filter((f) => !f.startsWith("src/test/"));

  it("マイグレーションを読めている（パーサの生存確認）", () => {
    // ここが空だと「違反ゼロ」と誤判定して番人が黙る
    expect(tables.length).toBeGreaterThan(40);
    expect(tables).toContain("user_avatars");
    expect(files.length).toBeGreaterThan(50);
  });

  it("🔴 .from(\"<消したテーブル>\") がどこにも無い", () => {
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const t of tables) {
        if (src.includes(`from("${t}")`)) hits.push(`${f} → ${t}`);
      }
    }
    expect(hits, "本番に存在しないテーブルを読もうとしています").toEqual([]);
  });

  it("🔴 rpc(\"<消した関数>\") がどこにも無い", () => {
    const fns = droppedFunctions();
    expect(fns.length).toBeGreaterThan(40);
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const fn of fns) {
        if (src.includes(`rpc("${fn}"`)) hits.push(`${f} → ${fn}`);
      }
    }
    expect(hits, "本番に存在しない RPC を呼ぼうとしています").toEqual([]);
  });
});

describe("🔴 消してはいけないものを消していない", () => {
  const tables = droppedTables();

  it("実機能のテーブルが削除の一覧に入っていない", () => {
    // booking_questions は `quest` に、training_milestones と紛らわしい名前も多い。
    // 名前で選ぶと巻き込む（実際に一度やりかけた）
    for (const keep of ["booking_questions", "weight_journey", "user_measurements",
                        "bookings", "workouts", "profiles", "messages", "trial_bookings"]) {
      expect(tables, `${keep} は実機能なので消してはいけない`).not.toContain(keep);
    }
  });

  it("契約の有効期限の文言が5言語とも残っている", () => {
    // `exp` で始まるキーを消そうとして、一度これを巻き込んだ
    for (const lng of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const cd = JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")).clientDetail;
      for (const k of ["expiry", "expiryPending", "expiryConsumed", "expired"]) {
        expect(typeof cd[k], `${lng}.clientDetail.${k}`).toBe("string");
      }
    }
  });

  it("部位アイコンの置き場が残っている（アバターから移した定数）", () => {
    const lib = readFileSync("src/lib/muscleMapIcon.ts", "utf8");
    expect(lib).toContain("MUSCLE_ICON_CDN_BASE");
    // コメントには由来として avatarSystem が出てよい。見るのは import のほう
    expect(lib).not.toMatch(/import[^;]*avatarSystem/);
  });

  it("体重目標のパネルが生きている", () => {
    expect(existsSync("src/components/trainer/TrainerWeightJourneyPanel.tsx")).toBe(true);
  });
});

describe("マイグレーションの作法", () => {
  it("🔴 CASCADE を使っていない（何を巻き込んだか分からなくなる）", () => {
    expect(SQL).not.toMatch(/\bCASCADE\b/i);
  });

  it("予約・記録の行を消す操作が無い", () => {
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i);
    expect(SQL).not.toMatch(/\bDROP TABLE[^;]*\bpublic\.(bookings|workouts|profiles|messages)\b/i);
  });
});

describe("コードが消えている", () => {
  for (const f of [
    "src/lib/avatarSystem.ts", "src/lib/avatarRewards.ts", "src/lib/titleSystem.ts",
    "src/lib/missionSystem.ts", "src/lib/missionRewards.ts", "src/lib/raidUtils.ts",
    "src/lib/rankPerks.ts", "src/lib/comboSystem.ts",
    "src/hooks/useAvatar.ts", "src/hooks/useSeasonEvents.ts",
    "src/components/customer/BadgeIcon.tsx",
    "src/components/customer/SessionExpSummaryDialog.tsx",
    "src/components/customer/MilestoneAchievedDialog.tsx",
    "supabase/functions/payments-webhook/index.ts",
    "supabase/functions/create-checkout/index.ts",
  ]) {
    it(`${f} が無い`, () => {
      expect(existsSync(f)).toBe(false);
    });
  }

  it("フラグごと消えている", () => {
    expect(readFileSync("src/lib/featureFlags.ts", "utf8")).not.toContain("GAMIFICATION_ENABLED");
  });
});
