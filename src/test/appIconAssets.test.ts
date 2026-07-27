import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

// アイコン系アセットの取り違え・取りこぼしを見張る。
//
// 背景: ローディング表示に FIFA ワールドカップのトロフィー画像が使われていた
// （src/assets/world-cup-trophy.png）。商用アプリに他社の商標を出すのは事故なので、
// アプリアイコンに差し替えたうえで、戻ってこないようにここで固定する。
//
// もう1つの事故は「生成物を生成元にする」こと。scripts/generate-app-icon.py が
// assets/icon-only.png（＝自分の出力）を読むと、流すたびに絵柄が劣化していく。

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function pngSize(path: string): [number, number] {
  const buf = readFileSync(path);
  expect(buf.subarray(0, 4), `${path} が PNG ではない`).toEqual(PNG_MAGIC);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];   // IHDR の width/height
}

describe("アプリアイコンのアセット", () => {
  it("ローディング表示は盾とGBのロゴを使う", () => {
    const src = readFileSync("src/components/ui/dumbbell-loader.tsx", "utf8");
    expect(src).toContain("@/assets/gymboard-loader.png");
    expect(existsSync("src/assets/gymboard-loader.png")).toBe(true);
    // 生成元はブランドロゴ。アイコン（雪山の背景つき）に戻すと、
    // ボタン内の16〜24px表示で背景が主張してマークが読めなくなる。
    const gen = readFileSync("scripts/generate-app-icon.py", "utf8");
    expect(gen).toMatch(/Image\.open\("src\/assets\/gymboard-logo\.png"\)/);
  });

  it("ローディング画像は背景を持たない（アルファチャンネルあり）", () => {
    // 背景つきの画像を貼ると、白い画面の上で四角い板が浮いて見える。
    // PNG の IHDR 25バイト目が色タイプ。6 = truecolor+alpha、2 = alpha無しのRGB。
    // 背景つきのアプリアイコン（=2）を流用すると、この判定で落ちる。
    const colorType = (p: string) => readFileSync(p).readUInt8(25);
    expect(colorType("src/assets/gymboard-loader.png"),
      "ローディング画像にアルファチャンネルが無い").toBe(6);
    expect(colorType("assets/icon-only.png"),
      "前提が崩れている: アプリアイコンは背景つき(色タイプ2)のはず").toBe(2);
  });

  it("ワールドカップのトロフィー画像が復活していない", () => {
    // 他社の商標なので、ファイルごと消してある。
    // 経緯をコメントに書いた箇所があるので、語句ではなく「画像への参照」だけを見る。
    expect(existsSync("src/assets/world-cup-trophy.png"), "トロフィー画像が戻っている").toBe(false);
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!/\.tsx?$/.test(file) || file.startsWith("src/test/")) continue;
      if (/["'][^"']*world-cup-trophy[^"']*["']/i.test(readFileSync(file, "utf8"))) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("生成元と出力先が別のファイルになっている", () => {
    // ここが同じだと、生成スクリプトが自分の出力を読み直して絵柄が劣化する。
    const gen = readFileSync("scripts/generate-app-icon.py", "utf8");
    const emblemSrc = gen.match(/^EMBLEM_SRC = "([^"]+)"/m)?.[1];
    expect(emblemSrc, "EMBLEM_SRC が読み取れない").toBeTruthy();
    expect(emblemSrc).not.toBe("assets/icon-only.png");
    expect(existsSync(emblemSrc!), `${emblemSrc} が無い`).toBe(true);
    expect(existsSync("assets/feature-text-src.png")).toBe(true);
  });

  it("各アセットの寸法がストア/ネイティブの要件どおり", () => {
    const expected: Record<string, [number, number]> = {
      "assets/icon-only.png": [1024, 1024],
      "gymboard-app-icon-1024.PNG": [1024, 1024],
      "assets/icon-foreground.png": [1024, 1024],
      "assets/icon-background.png": [1024, 1024],
      "assets/splash.png": [2732, 2732],
      "assets/splash-dark.png": [2732, 2732],
      "public/icon-192.png": [192, 192],
      "public/icon-512.png": [512, 512],          // Play Console のストア掲載アイコン
      "public/apple-touch-icon.png": [180, 180],
      "gymboard-feature-graphic-1024x500.png": [1024, 500],   // フィーチャーグラフィック
    };
    for (const [path, want] of Object.entries(expected)) {
      expect(existsSync(path), `${path} が無い`).toBe(true);
      expect(pngSize(path), `${path} の寸法が違う`).toEqual(want);
    }
  });

  it("ルートのマスターと assets/icon-only.png が一致している", () => {
    // メモに「両方を更新する（ドリフト防止）」とある箇所。片方だけ差し替えると
    // iOS CI が古いほうを拾って、アイコンだけ前のデザインで出てしまう。
    //
    // 中身の比較はハッシュで行う。640KB の Buffer 同士を toEqual に渡すと
    // 1件で5秒かかったうえ、同じ内容でも結果が安定しなかった。
    const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    expect(sha("gymboard-app-icon-1024.PNG")).toBe(sha("assets/icon-only.png"));
  });
});

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
