#!/usr/bin/env node
/**
 * 翻訳ファイル自動生成スクリプト
 *
 * src/locales/ja.json を読み込み、欠けているキーだけを翻訳して
 * en.json / ko.json に書き出します。
 *
 * 使い方:
 *   LOVABLE_API_KEY=xxxx node scripts/translate-locales.mjs        # 差分のみ翻訳
 *   LOVABLE_API_KEY=xxxx node scripts/translate-locales.mjs --force # 全件再翻訳
 *   LOVABLE_API_KEY=xxxx node scripts/translate-locales.mjs --lang en
 *
 * 翻訳API: Lovable AI Gateway (google/gemini-2.5-flash)
 *   APIキーは Lovable のワークスペース設定で発行できる LOVABLE_API_KEY を
 *   環境変数として渡してください（コードに直書きしない）。
 *   ローカル開発では .env.local 等に書き、`export $(cat .env.local | xargs)` で読み込むか、
 *   `LOVABLE_API_KEY=... npm run translate` のように直接渡します。
 *
 * 補間構文 {{var}} は翻訳されずそのまま残ります。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "..", "src", "locales");
const API_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const langArgIdx = args.indexOf("--lang");
const ONLY_LANG = langArgIdx >= 0 ? args[langArgIdx + 1] : null;

const TARGETS = [
  { code: "en", name: "English" },
  { code: "ko", name: "Korean (한국어)" },
  {
    code: "zh-CN",
    name: "Simplified Chinese (简体中文, Mainland China usage)",
    extraNote:
      "簡体字（Simplified Chinese characters）のみを使い、中国大陸で自然な表現・語彙にする。繁体字は絶対に使わない。",
  },
  {
    code: "zh-TW",
    name: "Traditional Chinese (繁體中文, Taiwan usage)",
    extraNote:
      "繁體字（Traditional Chinese characters）のみを使い、台湾で自然な表現・語彙にする。簡体字は絶対に使わない。",
  },
].filter((t) => !ONLY_LANG || t.code === ONLY_LANG);

const API_KEY = process.env.LOVABLE_API_KEY;
if (!API_KEY) {
  console.error("ERROR: LOVABLE_API_KEY 環境変数が未設定です。");
  process.exit(1);
}

const readJSON = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const writeJSON = async (f, obj) =>
  fs.writeFile(f, JSON.stringify(obj, null, 2) + "\n", "utf8");

// ネストオブジェクトをフラット化 ("a.b.c" -> value)
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function setNested(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// {{var}} を一時トークンに置換 → 翻訳後に復元
function protectVars(text) {
  const vars = [];
  const protectedText = text.replace(/\{\{[^}]+\}\}/g, (m) => {
    vars.push(m);
    return `__VAR_${vars.length - 1}__`;
  });
  return { protectedText, vars };
}
function restoreVars(text, vars) {
  return text.replace(/__VAR_(\d+)__/g, (_, i) => vars[Number(i)] ?? "");
}

async function translateBatch(entries, targetLangName) {
  // entries: [{ key, text }]
  const prepared = entries.map(({ key, text }) => {
    const { protectedText, vars } = protectVars(String(text));
    return { key, protectedText, vars };
  });

  const userPayload = prepared.map((e) => ({ key: e.key, text: e.protectedText }));

  const sys =
    `あなたはプロのUI翻訳者です。日本語のUI文字列を ${targetLangName} に翻訳します。\n` +
    `ルール:\n` +
    `- 自然で簡潔なUI表現にする。\n` +
    `- __VAR_数字__ のようなトークンは絶対に翻訳・変更せず、そのまま残す。\n` +
    `- 句読点や記号もUIに自然な形にする。\n` +
    `- 入力JSON配列の各要素に対し、同じ key と翻訳後の text を含むJSONを返す。\n` +
    `- 出力は { "items": [{ "key": "...", "text": "..." }, ...] } の形式のみ。説明文は不要。`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse model output: ${content.slice(0, 200)}`);
  }
  const items = parsed.items ?? [];
  const byKey = new Map(items.map((it) => [it.key, it.text]));

  const result = {};
  for (const p of prepared) {
    const translated = byKey.get(p.key);
    if (typeof translated === "string") {
      result[p.key] = restoreVars(translated, p.vars);
    }
  }
  return result;
}

const CHUNK_SIZE = 30;

async function processLang(target, jaFlat) {
  const file = path.join(LOCALES_DIR, `${target.code}.json`);
  let existing = {};
  try {
    existing = await readJSON(file);
  } catch {
    existing = {};
  }
  const existingFlat = flatten(existing);

  const todo = [];
  for (const [key, text] of Object.entries(jaFlat)) {
    if (typeof text !== "string") continue;
    if (!FORCE && typeof existingFlat[key] === "string" && existingFlat[key].length > 0) {
      continue;
    }
    todo.push({ key, text });
  }

  console.log(`[${target.code}] 翻訳対象: ${todo.length} キー (全体 ${Object.keys(jaFlat).length})`);
  if (todo.length === 0) return;

  const output = structuredClone(existing);

  for (let i = 0; i < todo.length; i += CHUNK_SIZE) {
    const chunk = todo.slice(i, i + CHUNK_SIZE);
    process.stdout.write(`  [${target.code}] ${i + chunk.length}/${todo.length} ...`);
    try {
      const translations = await translateBatch(chunk, target.name);
      for (const { key } of chunk) {
        if (translations[key] != null) {
          setNested(output, key, translations[key]);
        } else {
          console.warn(`\n  ! 未翻訳: ${key}`);
        }
      }
      process.stdout.write(" done\n");
    } catch (err) {
      process.stdout.write(" FAILED\n");
      console.error(err.message);
      // 部分保存
      await writeJSON(file, output);
      throw err;
    }
    // レート制限対策
    await new Promise((r) => setTimeout(r, 500));
  }

  await writeJSON(file, output);
  console.log(`[${target.code}] -> ${path.relative(process.cwd(), file)} 書き出し完了`);
}

async function main() {
  const ja = await readJSON(path.join(LOCALES_DIR, "ja.json"));
  const jaFlat = flatten(ja);
  for (const target of TARGETS) {
    await processLang(target, jaFlat);
  }
  console.log("完了。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
