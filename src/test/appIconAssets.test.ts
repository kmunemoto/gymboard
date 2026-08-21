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
 * 8bit の PNG を復号する（colorType 6=RGBA / 2=RGB のみ）。画素まで見ないと
 * 「盾の中が塗られている」「背景に絵が描いてある」を検出できず、見た目でも気づけないため、
 * ここだけ自前で展開する（依存を増やさない）。
 *
 * 返す `ch` は 1画素あたりのバイト数（4 か 3）。呼ぶ側はこれで添字を作る。
 */
function decodePNG(path: string): { w: number; h: number; px: Buffer; ch: number } {
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
  if (depth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`想定外のPNG形式: depth=${depth} colorType=${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3, stride = w * bpp;
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
  return { w, h, px, ch: bpp };
}

describe("アプリアイコンのアセット", () => {
  it("ローディング表示は盾とGBのロゴを使う", () => {
    const src = readFileSync("src/components/ui/dumbbell-loader.tsx", "utf8");
    expect(src).toContain("@/assets/gymboard-loader.png");
    expect(existsSync("src/assets/gymboard-loader.png")).toBe(true);
    // 生成元はブランドロゴ。アイコン（背景つき）に戻すと、
    // ボタン内の16〜24px表示で背景が主張してマークが読めなくなる。
    const gen = readFileSync("scripts/generate-app-icon.py", "utf8");
    expect(gen).toMatch(/Image\.open\("src\/assets\/gymboard-logo\.png"\)/);
  });

  it("ローディング画像は背景を持たない（アルファチャンネルあり）", () => {
    // 背景つきの画像を貼ると、白い画面の上で四角い板が浮いて見える。
    // PNG の IHDR 25バイト目が色タイプ。6 = truecolor+alpha、2 = alpha無しのRGB。
    // 背景つきのアプリアイコン（=2）を流用すると、この判定で落ちる。
    // ここが 6 に変わったら、アイコン側を透過で書き出してしまっている
    // （ネイティブのランチャーアイコンは透過を許さない）。
    const colorType = (p: string) => readFileSync(p).readUInt8(25);
    expect(colorType("src/assets/gymboard-loader.png"),
      "ローディング画像にアルファチャンネルが無い").toBe(6);
    expect(colorType("assets/icon-only.png"),
      "前提が崩れている: アプリアイコンは背景つき(色タイプ2)のはず").toBe(2);
  });

  it("ローディング画像は盾の中身が塗られていない（輪郭だけ）", () => {
    // ロゴ原本は外側だけ透過で**盾の内側が白ベタ**。ほぼ白の通常画面では気づかないが、
    // 写真背景（theme-glass）では白い板として浮く。画素まで見ないと検出できない。
    const { w, h, px, ch } = decodePNG("src/assets/gymboard-loader.png");
    const alphaAt = (x: number, y: number) => px[(y * w + x) * ch + 3];

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

  // ------------------------------------------------------------------
  // 背景デザイン（2026-08-21: 雪山 → ティール1色）
  // ------------------------------------------------------------------
  // 雪山をやめた理由は「16〜24px で何が描いてあるか判別できない」こと。
  // 背景に絵が戻ってきたら、その理由ごと静かに巻き戻る。ここで画素から見張る。

  /** icon-background.png を読んで、平均色を返すヘルパー */
  const bgBlock = (x0: number, y0: number, n = 24) => {
    const { w, px, ch } = decodePNG("assets/icon-background.png");
    const sum = [0, 0, 0];
    for (let y = y0; y < y0 + n; y++) {
      for (let x = x0; x < x0 + n; x++) {
        for (let i = 0; i < 3; i++) sum[i] += px[(y * w + x) * ch + i];
      }
    }
    return sum.map((v) => v / (n * n));
  };

  it("背景の右下が生成スクリプトの GRAD_TO と一致する", () => {
    // 生成物（コミット済みPNG）と生成元（定数）のドリフト検出。
    // 定数だけ書き換えて python を流し忘れると、リポジトリの絵は前のままになる。
    //
    // 右下を基準にするのは、そこだけ他の要素が乗らないため。
    // 左上には LIGHT_AMOUNT の加算があり、中央はグラデーションの途中なので、
    // 「定数がそのまま出ている」と言えるのは t=1 の右下だけ。
    const gen = readFileSync("scripts/generate-app-icon.py", "utf8");
    const m = gen.match(/^GRAD_TO = \((0x[0-9A-Fa-f]+), (0x[0-9A-Fa-f]+), (0x[0-9A-Fa-f]+)\)/m);
    expect(m, "GRAD_TO が読み取れない").toBeTruthy();
    const want = [m![1], m![2], m![3]].map((v) => parseInt(v, 16));

    const { w, h } = decodePNG("assets/icon-background.png");
    const got = bgBlock(w - 24, h - 24);
    // 許容±3は GRAIN(1.2) のばらつきと LANCZOS 縮小のぶん。
    got.forEach((v, i) =>
      expect(Math.abs(v - want[i]), `右下の色が GRAD_TO と違う got=${got} want=${want}`)
        .toBeLessThanOrEqual(3));
  });

  it("背景は左上が明るく右下が暗い（135°の向きが保たれている）", () => {
    // 製品の .gradient-primary と同じ向き。逆転すると、フィーチャーグラフィックで
    // 「ジムボード」の白文字が明るい側に乗ってコントラストを失う。
    const { w, h } = decodePNG("assets/icon-background.png");
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const tl = lum(bgBlock(0, 0));
    const br = lum(bgBlock(w - 24, h - 24));
    expect(tl - br, `左上が右下より明るくない (tl=${tl} br=${br})`).toBeGreaterThan(30);
  });

  it("背景に絵が描かれていない（どの窓を見ても平坦）", () => {
    // これが今回の変更の理由そのもの。山・粉雪・周辺減光のような「絵」が入ると、
    // 局所のばらつきが跳ね上がる。実測: 雪山版は 32px 窓の std が最大 56.9、
    // ティール1色は最大 0.85（GRAIN のディザ）。閾値 2.0 はその間。
    const { w, h, px, ch } = decodePNG("assets/icon-background.png");
    const N = 32;
    let worst = 0;
    for (let y0 = 0; y0 + N <= h; y0 += N) {
      for (let x0 = 0; x0 + N <= w; x0 += N) {
        let sum = 0, sq = 0;
        for (let y = y0; y < y0 + N; y++) {
          for (let x = x0; x < x0 + N; x++) {
            const i = (y * w + x) * ch;
            // 輝度で見る（色相の違いではなく「模様があるか」を見たい）
            const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
            sum += l; sq += l * l;
          }
        }
        const n = N * N;
        worst = Math.max(worst, Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)));
      }
    }
    expect(worst, `背景に絵が入っている（32px窓の輝度std=${worst.toFixed(2)}）`)
      .toBeLessThan(2.0);
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
