#!/usr/bin/env node
// 兄弟アプリ（業種特化フォーク）が直接書き換えてしまった ja.json から、
// 業種語彙のオーバーレイ（src/locales/vertical.ja.json）を機械的に抜き出す。
//
// なぜ要るか:
//   フォークが ja.json（約1,900キー）を直接書き換えていると、上流を取り込んだ瞬間に
//   業種語彙が全部消えるか、全ファイル衝突になる（mem/ops/vertical-fork.md）。
//   そこで「上流と値が違う葉」だけを先に抜き出してオーバーレイにし、
//   ja.json は上流のものに戻す。以後 ja.json は上流所有になり衝突しなくなる。
//
// 使い方:
//   node scripts/extract-vertical-overlay.mjs <上流のja.json> <フォークのja.json> [出力先]
//
//   例（フォークのリポジトリで、上流を fetch 済みの状態）:
//     git show upstream/main:src/locales/ja.json > /tmp/upstream-ja.json
//     node scripts/extract-vertical-overlay.mjs \
//       /tmp/upstream-ja.json src/locales/ja.json src/locales/vertical.ja.json
//     git checkout upstream/main -- src/locales/ja.json
//
// 出力するもの:
//   - オーバーレイ本体（値が違う葉だけ／入れ子構造は維持）
//   - 標準エラー出力に「オーバーレイで表現できないもの」の警告
//       * フォークが削除したキー … オーバーレイは上書きしかできないので表現できない
//       * フォークが追加したキー … 上流に無いキーは i18next が黙って無視する
//     どちらも人間の判断が要るので、握り潰さず必ず出す。

import { readFileSync, writeFileSync } from "node:fs";

const [, , upstreamPath, forkPath, outPath] = process.argv;

if (!upstreamPath || !forkPath) {
  console.error(
    "使い方: node scripts/extract-vertical-overlay.mjs <上流のja.json> <フォークのja.json> [出力先]",
  );
  process.exit(1);
}

const upstream = JSON.parse(readFileSync(upstreamPath, "utf8"));
const fork = JSON.parse(readFileSync(forkPath, "utf8"));

const isBranch = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const overlay = {};
const removed = []; // 上流にあってフォークに無い（＝フォークが消した）
const added = []; // フォークにあって上流に無い（＝フォークが足した）
const reshaped = []; // 同じキーだが文字列/オブジェクト/配列の形が変わった
const interpolated = []; // 上流が {{brandJa}} 等の補間に置き換えたキー（下記）
let changed = 0;
let same = 0;

/**
 * 上流が製品名を `{{brandJa}}` 等の補間に追い出したキーかどうか。
 *
 * フォークの ja.json が Phase 0-A より前の世代だと、そこには製品名が**リテラルで**
 * 入っている（例: 上流 `"{{brandJa}}へようこそ"` ／ フォーク `"セッコツボードへようこそ"`）。
 * 値が違うので機械的には「フォークが変えた葉」に見えるが、これをオーバーレイに
 * 書き写すと **Phase 0-A（brand.ts からの注入）が死ぬ**:
 *   - brand.ts を変えても文言が追従しなくなる
 *   - `brandInterpolation.test.ts` は base のロケールしか見ないので気づけない
 * セッコツボードでは実際に26葉が紛れ込んだ（2026-08-01）。
 *
 * 補間のまま base に任せるのが正しいので、オーバーレイからは外して警告する。
 */
const BRAND_INTERPOLATION = /\{\{\s*brand(Ja|En|App)\s*\}\}/;

/** overlay の dotted path に値を書き込む */
function setPath(root, path, value) {
  let cur = root;
  for (const key of path.slice(0, -1)) {
    cur[key] ??= {};
    cur = cur[key];
  }
  cur[path.at(-1)] = value;
}

function walk(up, fk, path) {
  for (const [key, upValue] of Object.entries(up)) {
    const here = [...path, key];
    const dotted = here.join(".");
    if (!(key in fk)) {
      removed.push(dotted);
      continue;
    }
    const fkValue = fk[key];
    if (isBranch(upValue) && isBranch(fkValue)) {
      walk(upValue, fkValue, here);
      continue;
    }
    if (isBranch(upValue) !== isBranch(fkValue) || Array.isArray(upValue) !== Array.isArray(fkValue)) {
      reshaped.push(dotted);
      continue;
    }
    // 配列（returnObjects で丸ごと引かれる）は要素ごとではなく丸ごと比較する
    if (JSON.stringify(upValue) === JSON.stringify(fkValue)) {
      same++;
    } else if (typeof upValue === "string" && BRAND_INTERPOLATION.test(upValue)) {
      // 上流が製品名を補間に追い出した葉。オーバーレイに写すと補間が死ぬので外す。
      interpolated.push({ path: dotted, up: upValue, fork: String(fkValue) });
    } else {
      setPath(overlay, here, fkValue);
      changed++;
    }
  }
  for (const key of Object.keys(fk)) {
    if (!(key in up)) added.push([...path, key].join("."));
  }
}

walk(upstream, fork, []);

const json = `${JSON.stringify(overlay, null, 2)}\n`;
if (outPath) {
  writeFileSync(outPath, json, "utf8");
  console.error(`書き出し: ${outPath}`);
} else {
  process.stdout.write(json);
}

const warn = (label, list) => {
  if (list.length === 0) return;
  console.error(`\n⚠️  ${label}: ${list.length}件`);
  for (const k of list.slice(0, 40)) console.error(`   - ${k}`);
  if (list.length > 40) console.error(`   … 他 ${list.length - 40}件`);
};

console.error(`\n上書きする葉: ${changed}件 / 上流と同じ葉: ${same}件`);

if (interpolated.length) {
  console.error(
    `\nℹ️  ブランド補間の葉を ${interpolated.length}件、オーバーレイから除外した`,
  );
  console.error(
    "   上流が製品名を {{brandJa}} 等に追い出したキー。フォーク側は製品名がリテラルで" +
      "\n   入っているため差分に見えるが、写すと brand.ts からの注入が効かなくなる。" +
      "\n   base の補間に任せるのが正しい（製品名は brand.ts で変える）。",
  );
  for (const { path, up, fork } of interpolated.slice(0, 10)) {
    console.error(`   - ${path}\n       上流: ${up}\n       フォーク: ${fork}`);
  }
  if (interpolated.length > 10) console.error(`   … 他 ${interpolated.length - 10}件`);
  console.error(
    "   ※ 製品名の差し替え以外の理由でも文言を変えていた葉があれば、手で戻すこと。",
  );
}

warn(
  "フォークが削除したキー（オーバーレイでは表現できない。上流の文言がそのまま出る）",
  removed,
);
warn("フォークが追加したキー（上流に無いので i18next が黙って無視する）", added);
warn("形が変わったキー（文字列↔オブジェクト↔配列）", reshaped);

if (removed.length || added.length || reshaped.length) {
  console.error(
    "\n上記は人間の判断が要る。削除キーは「上流の文言のままで良いか」、" +
      "追加キーは「本当に要るならコードごと上流へ入れるか」を決めること。",
  );
}
