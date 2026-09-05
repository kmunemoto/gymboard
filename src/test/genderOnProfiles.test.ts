import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// 性別を profiles へ移す＋ workouts のゲーム用トリガーを外す（2026-09-05）。
//
// ゲーム要素（アバター・EXP・ガチャ・クエスト）を物理削除する作業の**第1段**。
//
// 宗本さん:「今の予約や記録を削除してしまったり、してしまわないようにお願い」
//
// ── ここで守りたいこと ────────────────────────────────────────────
//
//  1. 🔴 **予約と記録を1件も消さないこと。** この段でやるのは
//     「列を足す」「値を写す」「トリガーを外す」の3つだけ
//  2. **性別が失われないこと。** 保存先が user_avatars しかなく、そこに
//     顧客一覧の男女タブ・カルテの性別設定・記録画面の筋肉図がぶら下がっている
//  3. **アバターへの書き込みが止まること。** useAvatar は画面に出ないまま
//     行の作成・称号の付与を続けていた

const stripSql = (src: string): string =>
  src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const stripJs = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const readCode = (p: string) => stripJs(readFileSync(p, "utf8"));

const MIGRATION_PATH = "supabase/migrations/20260905010000_move_gender_to_profiles.sql";
const SQL = stripSql(readFileSync(MIGRATION_PATH, "utf8"));
const PROFILE_HOOK = readCode("src/hooks/useProfile.ts");
const KARTE = readCode("src/components/trainer/TrainerClientDetail.tsx");
const TRAINING = readCode("src/components/customer/CustomerTraining.tsx");
const LIST = readCode("src/components/trainer/TrainerClientList.tsx");

describe("🔴 予約と記録を消さない", () => {
  it("マイグレーションに DELETE / TRUNCATE / DROP TABLE が1つも無い", () => {
    // この段は「足す・写す・トリガーを外す」だけ。行を消す操作は1つも要らない。
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i);
    expect(SQL).not.toMatch(/\bDROP\s+TABLE\b/i);
  });

  it("bookings / workouts の行に触れていない", () => {
    // workouts に触れてよいのは DROP TRIGGER の対象としてだけ
    expect(SQL).not.toMatch(/\bUPDATE\s+public\.bookings\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+public\.workouts\b/i);
    const workoutMentions = SQL.match(/public\.workouts/g) ?? [];
    const dropTriggers = SQL.match(/DROP TRIGGER IF EXISTS \S+\s+ON public\.workouts;/g) ?? [];
    expect(workoutMentions.length, "workouts への言及は DROP TRIGGER だけであるべき")
      .toBe(dropTriggers.length);
  });

  it("UPDATE の対象が profiles だけ", () => {
    const updates = SQL.match(/UPDATE\s+public\.(\w+)/gi) ?? [];
    expect(updates.map((u) => u.split(".").pop())).toEqual(["profiles"]);
  });
});

describe("性別の引っ越し", () => {
  it("profiles に gender を足している", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.profiles ADD COLUMN IF NOT EXISTS gender TEXT/);
  });

  it("値を male / female に縛っている", () => {
    expect(SQL).toMatch(/CHECK \(gender IS NULL OR gender IN \('male', 'female'\)\)/);
  });

  it("user_avatars から写している", () => {
    expect(SQL).toMatch(/UPDATE public\.profiles p[\s\S]*FROM public\.user_avatars a/);
  });

  it("🔴 既にある値を上書きしない（何度流しても壊れない）", () => {
    const upd = SQL.slice(SQL.indexOf("UPDATE public.profiles"));
    expect(upd, "p.gender IS NULL の条件が無いと、手で直した値を巻き戻す")
      .toContain("p.gender IS NULL");
  });
});

describe("🔴 記録の保存時に走っていたゲームの処理を止める", () => {
  it("ガチャ券のトリガーを外している", () => {
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS trg_grant_gacha_ticket\s+ON public\.workouts;/);
  });

  it("クエスト戦闘のトリガーを外している", () => {
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS trg_quest_battle_on_workout\s+ON public\.workouts;/);
  });

  it("この段では関数もテーブルも消していない（第2段でまとめて消す）", () => {
    // トリガーだけなら付け直せる。ここで戻せなくしない
    expect(SQL).not.toMatch(/DROP FUNCTION/i);
  });
});

describe("画面が profiles を見るようになっている", () => {
  it("🔴 どこも user_avatars から性別を読んでいない", () => {
    for (const [name, code] of [["顧客一覧のフック", PROFILE_HOOK], ["カルテ", KARTE], ["記録画面", TRAINING]] as const) {
      expect(code, name).not.toMatch(/from\("user_avatars"\)[\s\S]{0,120}gender/);
    }
  });

  it("カルテが profiles に書き込む", () => {
    const write = KARTE.slice(KARTE.indexOf("const handleGenderChange"));
    expect(write.slice(0, 400)).toContain('from("profiles")');
    expect(write.slice(0, 400)).not.toContain("user_avatars");
  });

  it("顧客一覧が profiles の gender を使う", () => {
    expect(PROFILE_HOOK).toContain("genderMap");
    expect(PROFILE_HOOK).not.toContain('table: "user_avatars"');
  });

  it("男女タブは今までどおり gender を見る（機能が消えていない）", () => {
    expect(LIST).toContain('c.gender === "male"');
    expect(LIST).toContain('c.gender === "female"');
  });

  it("記録画面が profiles から性別を取る", () => {
    expect(TRAINING).toContain("useProfile()");
    expect(TRAINING).not.toContain("useAvatar");
  });
});

describe("🔴 アバターへの書き込みが止まっている", () => {
  it("useAvatar を呼んでいる画面がもう無い", () => {
    // 画面に何も出ないまま、行の作成・称号の付与・RPC 呼び出しを続けていた
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (!path.startsWith("src/test")) walk(path);
        } else if (/\.tsx?$/.test(path) && path !== "src/hooks/useAvatar.ts"
                   && /\buseAvatar\(/.test(readFileSync(path, "utf8"))) {
          callers.push(path);
        }
      }
    };
    walk("src");
    expect(callers, "useAvatar を呼ぶとアバター行の作成などが走る").toEqual([]);
  });
});

describe("マイグレーションの置き場", () => {
  it("ファイルが1つだけある", () => {
    const hits = readdirSync("supabase/migrations")
      .filter((f) => f.includes("move_gender_to_profiles"));
    expect(hits).toEqual([MIGRATION_PATH.split("/").pop()]);
  });
});
