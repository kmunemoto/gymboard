import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// 上流のテストが兄弟アプリ（業種フォーク）で落ちないようにするための番人。
//
// 経緯: 2026-08-01 に46ファイルを手で監査して「フォークに敵対的なテスト」を潰したが、
// **2回続けて見逃しがあった**。
//   1回目の見逃し … TrainerSidebar / TrainerGymSettings が trial-followups タブを
//                    ビルド時フラグとの合成を考えずに扱っていた（#227 で発見）
//   2回目の見逃し … TrainerSidebar の「メッセージ」「カウンセリング」、
//                    authSignupSent の「お客様」「ジムオーナー」がリテラルのまま
//                    （セッコツボードが実際に踏んで報告してくれた）
//
// 人間（とエージェント）の目視監査は同じ穴を繰り返し見逃す。機械で検出する。
//
// 検出方法: テストのアサーションに現れる**日本語の文字列リテラル**のうち、
// `ja.json` の値として実在するものを「オーバーレイで変わりうる＝フォークで落ちる」
// とみなして落とす。直し方は `i18n.t("...")` から引くこと。
//
// mem/ops/vertical-fork.md「上流のテストがフォークで落ちないようにする」も参照。

const TEST_DIR = "src/test";

/** ja.json の値 → 最初に見つかったキー（逆引き） */
function buildValueIndex(): Map<string, string> {
  const ja = JSON.parse(readFileSync("src/locales/ja.json", "utf8"));
  const index = new Map<string, string>();
  const walk = (o: Record<string, unknown>, path: string) => {
    for (const [k, v] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      if (typeof v === "string") {
        if (!index.has(v)) index.set(v, p);
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, p);
      }
    }
  };
  walk(ja, "");
  return index;
}

/** アサーションで画面の文言を指定している箇所だけを見る（it() の説明文などは対象外） */
const ASSERTION_PATTERNS = [
  /(?:getByText|queryByText|getAllByText|queryAllByText|findByText|getByLabelText|queryByLabelText|getByPlaceholderText)\(\s*"([^"]+)"/g,
  /\bname:\s*"([^"]+)"/g,
  /\.(?:toBe|toContain|toEqual)\(\s*"([^"]+)"\s*\)/g,
];

/**
 * 意図的にリテラルを使ってよい箇所。**理由を必ず書くこと。**
 * 「落ちたから足す」ためのものではない。フォークで壊れないと言い切れる場合だけ。
 */
const ALLOWED: Record<string, string> = {
  // Edge Function のメールテンプレートは i18n を経由しない（フロントの設定を読まない）。
  // ここでのリテラルは「文字化けせずにこの文字列が出ること」を見るための検査対象そのもの。
  "src/test/emailEncoding.test.ts": "Edge Function のメール本文の文字化け検査。i18n 非経由",
  "src/test/recoveryEmail.test.ts": "同上（パスワード再設定メール）",
  // 独立した i18next インスタンスに偽データを流し込む機構テスト。
  // 実ロケールを読まないので、フォークのオーバーレイの影響を受けない。
  "src/test/verticalOverlay.test.ts": "独立インスタンス＋偽データでの深いマージの機構テスト",
  // テスト内で定義したスタブコンポーネントのラベル・架空のテナント名。実UIではない。
  "src/test/useTenantShared.test.tsx": "テスト内スタブのボタン文言と架空のジム名",
};

describe("フォークに敵対的なテストを増やさない", () => {
  const valueIndex = buildValueIndex();

  const testFiles: string[] = [];
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) collect(path);
      else if (/\.(ts|tsx)$/.test(path)) testFiles.push(path);
    }
  };
  collect(TEST_DIR);

  it("ja.json の値を検査対象として読めている（パーサの生存確認）", () => {
    // ここが壊れると「違反ゼロ」と誤判定して番人が黙る
    expect(valueIndex.size).toBeGreaterThan(1000);
    expect(valueIndex.has("設定")).toBe(true);
    expect(testFiles.length).toBeGreaterThan(30);
  });

  it("画面の文言をリテラルで断言していない（オーバーレイしたフォークで落ちるため）", () => {
    const violations: string[] = [];

    for (const file of testFiles.sort()) {
      if (file === "src/test/forkHostileTests.test.ts") continue; // 自分自身
      if (ALLOWED[file]) continue;
      const text = readFileSync(file, "utf8");
      const found = new Set<string>();
      for (const re of ASSERTION_PATTERNS) {
        for (const m of text.matchAll(re)) {
          const literal = m[1];
          if (!/[぀-ヿ一-鿿]/.test(literal)) continue; // 日本語を含むものだけ
          const key = valueIndex.get(literal);
          if (key) found.add(`${literal}  →  i18n.t("${key}")`);
        }
      }
      for (const f of [...found].sort()) violations.push(`  ${file}\n      ${f}`);
    }

    expect(
      violations,
      violations.length
        ? `画面の文言がリテラルで書かれています。フォークがこの語をオーバーレイすると落ちます。\n` +
          `i18n.t() から引いてください（対応キーを併記しています）:\n\n${violations.join("\n")}\n\n` +
          `どうしてもリテラルが必要な場合のみ ALLOWED に理由付きで登録すること。`
        : undefined,
    ).toEqual([]);
  });

  it("ALLOWED に、もう違反していないファイルが残っていない", () => {
    // 残したままだと、そのファイルの新しい違反を見逃す
    const stale: string[] = [];
    for (const file of Object.keys(ALLOWED)) {
      if (!testFiles.includes(file)) {
        stale.push(`${file}（ファイル自体が存在しない）`);
        continue;
      }
      const text = readFileSync(file, "utf8");
      let hit = false;
      for (const re of ASSERTION_PATTERNS) {
        for (const m of text.matchAll(re)) {
          if (!/[぀-ヿ一-鿿]/.test(m[1])) continue;
          if (valueIndex.has(m[1])) hit = true;
        }
      }
      if (!hit) stale.push(`${file}（もう違反が無い）`);
    }
    expect(
      stale,
      stale.length ? `ALLOWED から削除してください:\n${stale.map((s) => `  - ${s}`).join("\n")}` : undefined,
    ).toEqual([]);
  });
});
