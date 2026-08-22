import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// scripts/build-android.bat の回帰テスト。
//
// ── 何が起きていたか（2026-08-04 に発覚） ──────────────────────────
// 2回目以降のビルドが、必ず最初の `git pull` で止まっていた:
//
//   error: Your local changes to the following files would be overwritten by merge:
//           supabase/functions/mcp/index.ts
//   Please commit your changes or stash them before you merge.
//
// このファイルは `npm run build`（vite.config.ts の mcpPlugin()）が**毎回生成し直す**
// 成果物で、git 追跡下にある。つまり
//
//   1回目: [3/5] npm run build が mcp/index.ts を書き換える → 作業ツリーが汚れる
//   2回目: [1/5] git pull が「上書きしていいか分からない」で中断
//
// という形で**必ず**詰まる。`package-lock.json` は同じ理由で
// 最初から `git checkout --` してあったのに、こちらが漏れていた。
//
// ── なぜテストにするか ────────────────────────────────────────
// .bat は CI でも vitest でも実行されない。**Windows で人が叩くまで誰も気づけない。**
// 「ビルドが作り直す成果物は、pull の前に捨てる」という不変条件を、形で見張る。

const BAT = "scripts/build-android.bat";
const script = readFileSync(BAT, "utf8");

/** ビルド手順が作り直す＝pull 前に捨ててよい（捨てるべき）成果物 */
const GENERATED_ARTIFACTS = [
  // [2/5] npm install が書き換える
  "package-lock.json",
  // [3/5] npm run build が書き換える（vite.config.ts の mcpPlugin()）
  "supabase/functions/mcp/index.ts",
];

describe("build-android.bat: pull を止める生成物を先に捨てる", () => {
  for (const path of GENERATED_ARTIFACTS) {
    it(`${path} を git pull より前に捨てている`, () => {
      const discard = script.indexOf(`git checkout -- ${path}`);
      expect(
        discard,
        `${BAT} に「git checkout -- ${path}」がありません。` +
          `このファイルはビルドが作り直すので、残っていると次回の git pull が中断します。`,
      ).toBeGreaterThan(-1);

      // `echo [1/5] git pull` の行を拾わないよう、行頭のコマンドだけを見る
      // （進捗表示の echo は checkout より前にあるので、素の indexOf だと必ず誤判定する）
      const pull = script.search(/^git pull\b/m);
      expect(pull, `${BAT} に git pull コマンドがありません`).toBeGreaterThan(-1);
      expect(
        discard,
        `「git checkout -- ${path}」が git pull より後にあります。順番が逆です。`,
      ).toBeLessThan(pull);
    });
  }

  it("捨てるときはエラーを握りつぶす（未変更でも止まらない）", () => {
    // `git checkout --` は対象が綺麗なときも成功するが、
    // パスが存在しない環境（フォークで構成が違う等）では失敗する。
    // そこでスクリプト全体が止まらないよう 2>nul を付ける。
    for (const path of GENERATED_ARTIFACTS) {
      expect(script).toMatch(
        new RegExp(`git checkout -- ${path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} 2>nul`),
      );
    }
  });

  it("生成物であることが CLAUDE.md にも書いてある（説明と実装の一致）", () => {
    // 「なぜ捨ててよいのか」の根拠。ここが食い違うと、次に読む人が
    // 「勝手に変更を捨てている」と誤解して外しかねない。
    const claude = readFileSync("CLAUDE.md", "utf8");
    expect(claude).toMatch(/supabase\/functions\/mcp\/index\.ts.*再生成|再生成.*supabase\/functions\/mcp\/index\.ts/s);
  });

  it("versionCode / versionName は書き換えない（手作業の領分を侵さない）", () => {
    // 版数の更新は Windows での手作業（mem/features/android-ci.md）。
    // ここで自動化すると、Play Console の実績とずれても気づけない。
    expect(script).not.toMatch(/versionCode\s*=|versionName\s*=/);
  });
});

// **版数はリポジトリで管理しない**（2026-08-13 にそう決めた）。
//
// ── なぜやめたか ─────────────────────────────────────────────
// 2026-08-05〜08-13 は `android-version.json` に版数を持ち、
// `scripts/set-android-version.mjs` が build.gradle に書いていた。
// だが **Play の実態とは自動同期しない**ので、8/11 に 86/9.5 へ進めたのに
// アップロードはせず、リポジトリだけが「9.5 を出した」ように見える状態が2日続いた。
// 同期しない記録を2つ持つより、Play Console だけを正にするほうが安全と判断した。
//
// ── なぜテストにするか ────────────────────────────────────────
// .bat は CI でも vitest でも実行されない。**Windows で人が叩くまで誰も気づけない。**
// 消したはずのスクリプトを呼ぶ行が戻ると、そこで `goto :err` してビルドが止まる。
describe("版数はリポジトリに持たない（2026-08-13〜）", () => {
  const REMOVED = ["android-version.json", "scripts/set-android-version.mjs"];

  for (const path of REMOVED) {
    it(`${path} が復活していない`, () => {
      expect(
        existsSync(path),
        `${path} が戻っています。版数は Android Studio で build.gradle を直接編集する ` +
          `運用にしました（mem/ops/release-signal.md）。二重管理に戻さないこと。`,
      ).toBe(false);
    });
  }

  it("build-android.bat が消えたスクリプトを呼んでいない", () => {
    // 呼ぶ行が残っていると `|| goto :err` でビルドが必ず失敗する。
    expect(
      script,
      "build-android.bat が set-android-version.mjs を呼んでいます（このファイルは削除済み）",
    ).not.toMatch(/set-android-version/);
    expect(script).not.toMatch(/android-version\.json/);
  });

  it("ワークフローも消えたスクリプトを呼んでいない", () => {
    const dir = ".github/workflows";
    const ymls = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    expect(ymls.length, "ワークフローが1つも読めていません").toBeGreaterThan(0);
    for (const f of ymls) {
      const body = readFileSync(join(dir, f), "utf8");
      expect(body, `${f} が set-android-version.mjs を呼んでいます`).not.toMatch(
        /set-android-version/,
      );
      expect(body, `${f} が android-version.json を読んでいます`).not.toMatch(
        /android-version\.json/,
      );
    }
  });

  it("ビルドの最後に build.gradle の現在値を表示する", () => {
    // 版数はこの PC にしか無く、上げ忘れても Play にアップロードするまで気づけない。
    // せめてビルド直後に目に入るようにしておく（`cap add android` で 1 に戻った
    // ことにも、ここで気づける）。
    expect(
      script,
      "build-android.bat が build.gradle の versionCode を表示していません",
    ).toMatch(/findstr[^\n]*versionCode[^\n]*build\.gradle/);
  });

  it("表示に失敗してもビルドを止めない", () => {
    // あくまで参考表示。ここで止めると、android/ がまだ無い等の理由で
    // 手順全体が失敗するようになってしまう。
    const line = script.split("\n").find((l) => l.startsWith("findstr")) ?? "";
    expect(line, "findstr の行が見つかりません").not.toBe("");
    expect(line, "表示のために goto :err してはいけない").not.toMatch(/goto :err/);
  });

  it("CLAUDE.md が Android Studio で上げる運用だと書いてある（説明と実装の一致）", () => {
    // ここが食い違うと、次に読む人が android-version.json を作り直しかねない。
    const claude = readFileSync("CLAUDE.md", "utf8");
    expect(claude).toMatch(/版数（versionCode \/ versionName）はリポジトリで管理しない/);
    expect(claude).toMatch(/Android Studio で直接編集/);
  });
});

// ---------------------------------------------------------------------------
// 🔴 cmd.exe が .bat を壊して読む問題（2026-08-22 に実害が出た）
//
// 宗本さんの Windows で build-android.bat が化けた文字列を実行しようとして
// 「内部コマンドまたは外部コマンドとして認識されていません」を出していた。
// 調べたら、**改行が LF だったせいでスクリプトの半分が実行されていなかった**。
//
// 仕組み:
//   .bat は UTF-8（日本語コメント入り）だが、cmd は CP932 として読む。
//   日本語行の行末バイトが 0x81-0x9F / 0xE0-0xFC に化けると、cmd はそれを
//   「2バイト文字の1バイト目」とみなして**次の1バイトを無条件に飲む**。
//   行末が LF だと、飲まれるのは改行そのもの。→ 行が消えて次の行が前の
//   REM / echo に飲み込まれる。CRLF なら CR が飲まれて LF が残るので無事。
//
// 実際の被害: 71行 → 54行に潰れ、以下が**一度も実行されていなかった**。
//   - git checkout --（pull 前の掃除。2回目以降の pull が止まる原因そのもの）
//   - npm install（optional peer。無いと build が落ちる）
//   - 🔴 npm run build（web の dist が更新されない＝**古い中身で AAB ができる**）
//   - findstr（版数の表示）
// ビルドは最後まで通ってしまうので、**成果物を見るまで誰も気づけない**壊れ方。
//
// このテストは cmd の読み方をバイト単位で再現して、主要なコマンドが「行頭に
// 立ったまま」であることを見張る。日本語コメントを足すのは自由だが、
// LF で保存した瞬間に赤くなる。
// ---------------------------------------------------------------------------
describe("cmd.exe が読んでも行が潰れない（CRLF 必須）", () => {
  const bytes = readFileSync(BAT);

  it("CRLF で保存されている（LF だと cmd が改行を食う）", () => {
    expect(bytes.includes(Buffer.from("\r\n")), "build-android.bat は CRLF で保存すること").toBe(true);
    // LF 単独（CR を伴わない改行）が混ざっていないこと
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x0a) {
        expect(i > 0 && bytes[i - 1] === 0x0d, `${i} バイト目に CR の無い LF がある`).toBe(true);
      }
    }
  });

  it(".gitattributes が .bat の改行変換を禁じている（次の clone で LF に戻らない）", () => {
    const attrs = readFileSync(".gitattributes", "utf8");
    expect(attrs).toMatch(/^\*\.bat\s+-text\s*$/m);
  });

  it("cmd（CP932）の読み方を再現しても、実行すべきコマンドが行頭に残る", () => {
    // cmd の挙動: 先頭バイトが 0x81-0x9F / 0xE0-0xFC なら次の1バイトを無条件に飲む
    const lines: string[] = [];
    let cur: number[] = [];
    for (let i = 0; i < bytes.length; ) {
      const b = bytes[i];
      if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) {
        cur.push(b);
        if (i + 1 < bytes.length) cur.push(bytes[i + 1]); // LF でも飲む
        i += 2;
      } else if (b === 0x0a) {
        lines.push(Buffer.from(cur).toString("binary"));
        cur = [];
        i += 1;
      } else {
        cur.push(b);
        i += 1;
      }
    }
    if (cur.length) lines.push(Buffer.from(cur).toString("binary"));
    const heads = lines.map((l) => l.replace(/^\s+/, "").replace(/\r$/, ""));

    // ビルドの本体。1つでも飲まれると「通ったのに中身が古い」成果物ができる
    const MUST_SURVIVE = [
      "git checkout -- package-lock.json",
      "git checkout -- supabase/functions/mcp/index.ts",
      "git pull",
      "call npm install --legacy-peer-deps",
      "call npm install @mediapipe/pose",
      "call npm run build",
      "call npx cap sync android",
      "node scripts/patch-android.mjs",
      'findstr /C:"versionCode"',
    ];
    for (const cmd of MUST_SURVIVE) {
      expect(
        heads.some((h) => h.startsWith(cmd)),
        `cmd が読むと「${cmd}」が行頭に立たない＝実行されない（LF で保存していないか確認）`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// setup-android-secrets.ps1 も同じ地雷を踏んでいた（2026-08-22）
//
// Windows PowerShell 5.1（powershell.exe = Windows の既定）は **BOM の無い**
// ファイルを ANSI（日本語環境では CP932）として読む。つまり .bat と同じ
// 「日本語行の行末バイトが次の1バイトを飲む」現象が起きる。
// 実測: 192行 → 171行に潰れ、$tmp = [IO.Path]::GetTempFileName() や
// keytool の実行行が丸ごと消えていた。
//
// 根治は **UTF-8 BOM を付けること**（PowerShell が UTF-8 として読む）。
// CRLF も併せて固定する（Windows のスクリプトとしての作法）。
// PowerShell 7+ は BOM 無しでも UTF-8 なので、BOM があれば両方で正しい。
// ---------------------------------------------------------------------------
describe("setup-android-secrets.ps1 も PowerShell が壊して読まない", () => {
  const PS1 = "scripts/setup-android-secrets.ps1";
  const bytes = readFileSync(PS1);

  it("UTF-8 BOM がある（PS 5.1 が CP932 として読むのを防ぐ）", () => {
    expect(
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      "PowerShell 5.1 は BOM 無しの UTF-8 を CP932 として読み、日本語行が次の行を飲む",
    ).toBe(true);
  });

  it("CRLF で保存されている", () => {
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x0a) {
        expect(i > 0 && bytes[i - 1] === 0x0d, `${i} バイト目に CR の無い LF がある`).toBe(true);
      }
    }
  });

  it(".gitattributes が .ps1 の改行変換も禁じている", () => {
    const attrs = readFileSync(".gitattributes", "utf8");
    expect(attrs).toMatch(/^\*\.ps1\s+-text\s*$/m);
  });
});
