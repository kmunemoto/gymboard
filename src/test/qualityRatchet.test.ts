import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// 品質のラチェット（2026-08-26）。
//
// ## なぜ「今より悪くしない」で止めるのか
//
// 全体を strict にすると数百件出て一度には直せない。巨大ファイルも同じで、
// 1945行のカルテを一晩で割るのは危ない。**一気に良くするのは無理でも、
// 悪くなるのは止められる。**
//
// 数を上限として固定し、増えたら赤にする。減らしたら上限も下げる（それがラチェット）。
//
// 🔴 上限を上げて通すのは最後の手段。上げるときは PR に理由を書くこと。
//    ここを何度も上げるなら、それは「返済していない」という記録になる。

const SRC = "src";
const SKIP_DIRS = new Set(["node_modules", "dist"]);
/** 自動生成なので数えない（Supabase の型定義） */
const GENERATED = new Set(["src/integrations/supabase/types.ts"]);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !GENERATED.has(p)) out.push(p);
  }
  return out;
};

const files = walk(SRC);

describe("🔴 `as any` を増やさない", () => {
  // 2026-08-26 時点の実測値。減らしたらこの数も下げること
  const LIMIT = 128;

  it(`src 配下の as any が ${LIMIT} 件を超えていない`, () => {
    const hits = files.flatMap((f) =>
      readFileSync(f, "utf8").split("\n")
        .map((l, i) => ({ f, i: i + 1, l }))
        .filter(({ l }) => l.includes("as any")),
    );
    expect(
      hits.length,
      `as any が増えています（${hits.length} > ${LIMIT}）。` +
      `型が効かない場所が増えると、列名の打ち間違いも null も検査で止まりません。\n` +
      hits.slice(0, 10).map((h) => `  ${h.f}:${h.i}`).join("\n"),
    ).toBeLessThanOrEqual(LIMIT);
  });
});

describe("🔴 巨大ファイルを増やさない", () => {
  // 900行を超えるファイルは「もう分けたほうがよい」の目安。
  // いま超えているものは既知として許す（一気に割るのは危ない）。
  const KNOWN = new Set([
    "src/components/trainer/TrainerClientDetail.tsx",
    "src/components/trainer/TrainerGymSettings.tsx",
    "src/components/customer/CustomerBooking.tsx",
    "src/components/trainer/TrainerSchedule.tsx",
    "src/hooks/useBookings.ts",
  ]);
  const LIMIT = 900;

  it(`${LIMIT} 行を超える新しいファイルが無い`, () => {
    const big = files
      .map((f) => ({ f, n: readFileSync(f, "utf8").split("\n").length }))
      .filter(({ f, n }) => n > LIMIT && !KNOWN.has(f));
    expect(
      big.map((b) => `${b.f} (${b.n}行)`),
      "新しく巨大なファイルができています。分けるか、既知の一覧に足して理由を書いてください",
    ).toEqual([]);
  });

  it("既知の巨大ファイルが**さらに**膨らんでいない", () => {
    // 分割は別途やるとしても、これ以上太らせない。
    // 2026-08-26 時点の行数 + 余裕50行
    const CAP: Record<string, number> = {
      "src/components/trainer/TrainerClientDetail.tsx": 2000,
      "src/components/trainer/TrainerGymSettings.tsx": 1600,
      "src/components/customer/CustomerBooking.tsx": 1490,
      "src/components/trainer/TrainerSchedule.tsx": 1300,
      "src/hooks/useBookings.ts": 1150,
    };
    const over = Object.entries(CAP)
      .map(([f, cap]) => ({ f, cap, n: readFileSync(f, "utf8").split("\n").length }))
      .filter(({ n, cap }) => n > cap);
    expect(
      over.map((o) => `${o.f}: ${o.n}行 > ${o.cap}`),
      "既知の巨大ファイルがさらに膨らんでいます。足すぶんは別ファイルに出してください",
    ).toEqual([]);
  });
});

describe("🔴 lib は上の層に依存しない", () => {
  // ここが崩れると、lib だけを strict にするゲート（tsconfig.strict.json）が
  // 意味を失う。lib を検査するだけで components / hooks の木まで
  // 引きずり込まれ、無関係な画面のエラーで赤くなる（実際に13件出た）。
  const libFiles = files.filter((f) => f.startsWith("src/lib/"));

  it("src/lib が components / hooks / pages を import していない", () => {
    const bad: string[] = [];
    for (const f of libFiles) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/from\s+["']@\/(components|hooks|pages)\/[^"']+["']/g)) {
        bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad, "lib が上の層を import しています（型だけでも同じ。lib 側に置いてください）").toEqual([]);
  });

  it("検査が空振りしていない（lib のファイルを実際に読めている）", () => {
    expect(libFiles.length).toBeGreaterThan(50);
  });
});

describe("strict のゲートが外れていない", () => {
  const cfg = JSON.parse(readFileSync("tsconfig.strict.json", "utf8"));
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  it("strictNullChecks と noImplicitAny が入っている", () => {
    expect(cfg.compilerOptions.strict).toBe(true);
    expect(cfg.compilerOptions.strictNullChecks).toBe(true);
    expect(cfg.compilerOptions.noImplicitAny).toBe(true);
  });

  it("対象が src/lib から狭められていない", () => {
    expect(cfg.include).toContain("src/lib/**/*.ts");
  });

  it("CI で回している（回さないゲートは無いのと同じ）", () => {
    expect(pkg.scripts["typecheck:strict"]).toBe("tsc --noEmit -p tsconfig.strict.json");
    expect(ci).toContain("npm run typecheck:strict");
  });
});
