import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

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

/**
 * 8bit RGBA の PNG を復号する。画素まで見ないと「盾の中が塗られている」ことを検出できず、
 * ほぼ白の画面では見た目でも気づけないため、ここだけ自前で展開する（依存を増やさない）。
 */
function decodeRGBA(path: string): { w: number; h: number; px: Buffer } {
  const buf = readFileSync(path);
  let pos = 8;                                    // PNGシグネチャ
  let w = 0, h = 0, depth = 0, colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;                              // len + type(4) + data + CRC(4)
  }
  if (depth !== 8 || colorType !== 6) {
    throw new Error(`想定外のPNG形式: depth=${depth} colorType=${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;          // 左
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;             // 上
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;  // 左上
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, px };
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

  it("ローディング画像は盾の中身が塗られていない（輪郭だけ）", () => {
    // ロゴ原本は外側だけ透過で**盾の内側が白ベタ**。ほぼ白の通常画面では気づかないが、
    // 写真背景（theme-glass）では白い板として浮く。画素まで見ないと検出できない。
    const { w, h, px } = decodeRGBA("src/assets/gymboard-loader.png");
    const alphaAt = (x: number, y: number) => px[(y * w + x) * 4 + 3];

    expect(alphaAt(1, 1), "余白が透明でない").toBe(0);

    // 文字より上、盾の壁だけが写る行を走査する。
    // 期待する並び: 透明 → 不透明(左の壁) → 透明(中身) → 不透明(右の壁) → 透明
    const y = Math.round(h * 0.22);
    const runs: [number, number][] = [];
    let start: number | null = null;
    for (let x = 0; x < w; x++) {
      const solid = alphaAt(x, y) > 200;
      if (solid && start === null) start = x;
      if (!solid && start !== null) { runs.push([start, x - 1]); start = null; }
    }
    if (start !== null) runs.push([start, w - 1]);

    expect(runs.length, `盾の左右の壁が見つからない (runs=${JSON.stringify(runs)})`).toBe(2);
    const mid = Math.round((runs[0][1] + runs[1][0]) / 2);
    expect(alphaAt(mid, y), "盾の内側が塗りつぶされている（白ベタが残っている）").toBe(0);
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
