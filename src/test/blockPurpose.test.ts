import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { BLOCK_PURPOSE_MAX, BLOCK_PURPOSE_DB_MAX, blockPurposeName } from "@/lib/blockPurpose";

// ブロック枠の用事名（2026-09-04）。
//
// 宗本さん:「ブロックの用事をもちろんお客様には見せません。
//            お店の中だけで見返せるようにしたいだけです」
//
// ── ここで守りたいこと ────────────────────────────────────────────
//
//  1. 🔴 **お客様が読めないこと。** 画面に出さないだけでは足りない。
//     `blocked_slots` はもともと同じジムの会員が REST API で全列読めた。
//     用事名は私的なこと・第三者の名前が入る欄なので、ポリシーごと塞ぐ
//  2. 🔴 **古いアプリが書く自動生成 reason を、用事名として出さないこと。**
//     出回っている版は「ブロック（14:15〜15:15）」を書き続ける。そのまま出すと
//     狭いマスで「ブロ…」になり、いまより読めなくなる
//  3. **入力欄の上限と DB の上限をわざと違えていること。** DB を20にすると、
//     古い端末のブロック作成が黙って失敗する

const stripJs = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const stripSql = (src: string): string =>
  src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const readCode = (p: string) => stripJs(readFileSync(p, "utf8"));

const SQL = stripSql(
  readFileSync("supabase/migrations/20260904020000_blocked_slot_purpose.sql", "utf8"),
);
const SCHEDULE = readCode("src/components/trainer/TrainerSchedule.tsx");
const WEEK = readCode("src/components/trainer/WeekTimelineView.tsx");
const HOOK = readCode("src/hooks/useBookings.ts");
const FIELD = readCode("src/components/trainer/BlockPurposeField.tsx");

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
const locale = (lng: string) =>
  JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")) as Record<string, any>;

/** その言語の「古いアプリが書く自動生成 reason」を実際に組み立てる */
const generatedReason = (lng: string, start = "14:15", end = "15:15"): string =>
  locale(lng).schedule.blockReason.replace("{{start}}", start).replace("{{end}}", end);

describe("🔴 古いアプリの自動生成 reason は用事名として出さない", () => {
  // ここが外れると、出回っている版が作ったブロックが予定表で「ブロ…」になる。
  for (const lng of LOCALES) {
    it(`${lng} の自動生成 reason を弾く`, () => {
      expect(blockPurposeName(generatedReason(lng))).toBe("");
    });
  }

  it("時刻の桁が1桁でも弾く", () => {
    for (const lng of LOCALES) {
      expect(blockPurposeName(generatedReason(lng, "9:00", "9:30")), lng).toBe("");
    }
  });

  it("🔴 判定は文言ではなく形。ロケールの文言を読めている（パーサの生存確認）", () => {
    // ここが空だと「全部弾けている」と誤判定して番人が黙る
    for (const lng of LOCALES) {
      const r = generatedReason(lng);
      expect(r, lng).not.toContain("{{");
      expect(r.length, lng).toBeGreaterThan(8);
    }
  });
});

describe("人が付けた名前は残す", () => {
  it("ふつうの用事名はそのまま返る", () => {
    // 画面の文言ではなく、店の人が打つ想定の文字列。i18n とは無関係
    for (const s of ["Meeting", "cleaning", "AB社 打合せ", "設営"]) {
      expect(blockPurposeName(s)).toBe(s);
    }
  });

  it("括弧が無ければ、時刻を含んでいても残す", () => {
    // 「掃除 10:00〜11:00」のような書き方を消してしまわない
    const s = "cleaning 10:00-11:00";
    expect(blockPurposeName(s)).toBe(s);
  });

  it("前後の空白は落とす", () => {
    expect(blockPurposeName("  Meeting  ")).toBe("Meeting");
  });

  it("未入力は空文字（呼び出し側が既定の文言に倒す）", () => {
    expect(blockPurposeName(null)).toBe("");
    expect(blockPurposeName(undefined)).toBe("");
    expect(blockPurposeName("")).toBe("");
    expect(blockPurposeName("   ")).toBe("");
  });
});

describe("長さの上限", () => {
  it("入力欄は20文字", () => {
    expect(BLOCK_PURPOSE_MAX).toBe(20);
  });

  it("🔴 DB の上限が入力欄より広い（古い端末の書き込みを弾かないため）", () => {
    expect(BLOCK_PURPOSE_DB_MAX).toBeGreaterThan(BLOCK_PURPOSE_MAX);
  });

  it("🔴 DB の上限が、どの言語の自動生成 reason より長い", () => {
    // ここが逆転すると、出回っている版のブロック作成が 23514 で黙って失敗する
    for (const lng of LOCALES) {
      expect(generatedReason(lng, "10:00", "10:30").length, lng)
        .toBeLessThanOrEqual(BLOCK_PURPOSE_DB_MAX);
    }
  });

  it("マイグレーションの CHECK が BLOCK_PURPOSE_DB_MAX と同じ数字", () => {
    expect(SQL).toContain(`char_length(reason) <= ${BLOCK_PURPOSE_DB_MAX}`);
  });

  it("入力欄が定数を使っている（数字を直書きしていない）", () => {
    expect(FIELD).toContain("maxLength={BLOCK_PURPOSE_MAX}");
  });
});

describe("🔴 お客様に見せない", () => {
  it("お客様の SELECT ポリシーを落としている", () => {
    expect(SQL).toMatch(/DROP POLICY IF EXISTS "Customers can view blocked slots"/);
  });

  it("お客様側のコードが blocked_slots を直接読んでいない", () => {
    // 読む経路が増えたら、そこから用事名が漏れる
    const dirs = ["src/components/customer", "src/pages"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(path) && readFileSync(path, "utf8").includes('from("blocked_slots")')) {
          offenders.push(path);
        }
      }
    };
    dirs.forEach(walk);
    expect(offenders, "お客様側から blocked_slots を直接読んでいます").toEqual([]);
  });

  it("blocked_slots を直接読むのはトレーナー画面だけ", () => {
    const readers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${e.name}`;
        if (e.isDirectory() && !path.startsWith("src/test") && !path.startsWith("src/dev")) walk(path);
        else if (/\.tsx?$/.test(path) && !path.startsWith("src/test") && !path.startsWith("src/dev")
                 && /from\("blocked_slots"\)/.test(readFileSync(path, "utf8"))) {
          readers.push(path);
        }
      }
    };
    walk("src");
    expect(readers.sort()).toEqual([
      "src/components/trainer/TrainerSchedule.tsx",
      "src/hooks/useBookings.ts",
    ]);
  });

  it("入力欄が「スタッフだけ」と伝えている", () => {
    expect(FIELD).toContain('t("schedule.blockPurposeNote")');
    for (const lng of LOCALES) {
      expect(typeof locale(lng).schedule.blockPurposeNote, lng).toBe("string");
      expect(locale(lng).schedule.blockPurposeNote.trim(), lng).not.toBe("");
    }
  });
});

describe("保存と表示", () => {
  it("🔴 入力した用事名を reason に入れる（自動生成をやめている）", () => {
    expect(SCHEDULE).toContain("reason: blockPurpose.trim() || null");
    expect(SCHEDULE).not.toContain('t("schedule.blockReason"');
  });

  it("🔴 ダイアログを閉じたら用事名を捨てる（次のブロックに持ち越さない）", () => {
    // キャンセルボタンと onOpenChange の**両方**。片方だけだと持ち越す
    const resets = SCHEDULE.match(/setBlockPurpose\(""\)/g) ?? [];
    expect(resets.length, "リセットが足りません（保存後・×で閉じる・キャンセル）")
      .toBeGreaterThanOrEqual(3);
    expect(SCHEDULE).toMatch(/onClick=\{\(\) => \{ setBlockDialogOpen\(false\); setBlockPurpose\(""\); \}\}/);
  });

  it("フックは reason をそのまま渡す（既定文言を混ぜない）", () => {
    expect(HOOK).toContain('clientName: bs.reason ?? ""');
  });

  it("日別ビューの2か所が用事名を出す", () => {
    const hits = SCHEDULE.match(/blockPurposeName\((?:session|booking)\.clientName\)/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it("週タイムラインが用事名を出す（「—」固定をやめている）", () => {
    expect(WEEK).toContain("blockPurposeName(b.clientName)");
    expect(WEEK).not.toMatch(/isBlocked\s*\n?\s*\?\s*"—"/);
  });

  it("用事名が無いときは既定の文言に倒す", () => {
    expect(WEEK).toContain('|| t("schedule.blockedLabel")');
    expect(SCHEDULE).toContain('|| t("schedule.blockedLabel")');
  });

  it("解除ダイアログが用事名を出す", () => {
    // 週の帯は8文字で切るので、全文を確かめられる場所がここしかない
    expect(SCHEDULE).toContain("schedule.releaseDescNamed");
    for (const lng of LOCALES) {
      expect(locale(lng).schedule.releaseDescNamed, lng).toContain("{{name}}");
    }
  });
});

describe("既存データの掃除", () => {
  it("自動生成の形だけを NULL にする", () => {
    expect(SQL).toMatch(/UPDATE public\.blocked_slots[\s\S]*SET reason = NULL/);
  });

  it("🔴 時点で切っている（再適用で人の用事名を消さない）", () => {
    const upd = SQL.slice(SQL.indexOf("UPDATE public.blocked_slots"));
    expect(upd).toContain("created_at <");
  });
});

describe("文言", () => {
  for (const lng of LOCALES) {
    it(`${lng} に用事名まわりの文言がある`, () => {
      const s = locale(lng).schedule;
      for (const k of ["blockPurposeLabel", "blockPurposePlaceholder", "blockPurposeNote", "releaseDescNamed"]) {
        expect(typeof s[k], `${lng}.${k}`).toBe("string");
        expect(String(s[k]).trim(), `${lng}.${k}`).not.toBe("");
      }
    });
  }

  it("🔴 blockReason は消さない（この番人が形の判定に使っている）", () => {
    // コードからは使わなくなったが、5言語ぶんの「古い形」の見本として要る
    for (const lng of LOCALES) {
      expect(typeof locale(lng).schedule.blockReason, lng).toBe("string");
    }
  });
});
