import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { toCsv, type CsvColumn } from "@/lib/csvExport";
import {
  parseCsv,
  unescapeCsvValue,
  mapHeader,
  normalizePhone,
  normalizeName,
  parseStatus,
  parseJoinedAt,
  parseCustomerCsv,
  importableRows,
  MAX_PHONE,
  MAX_KANA,
  decodeCsvBytes,
} from "@/lib/csvImport";

// 顧客の一括登録（CSV 読み取り）の見張り。
//
// 守りたい不変条件は3つ:
//   1. 書き出した CSV をそのまま読み戻せる（往復できる）
//   2. 名前の無い行を作らない
//   3. 既に居る人を二重に作らない（同じ CSV を2回流しても増えない）
//
// ⚠️ 名前は i18n のキーに当たらない文字列を使う（forkHostileTests.test.ts の制約）。

describe("CSV の解析（RFC 4180）", () => {
  it("BOM を落とす", () => {
    expect(parseCsv("﻿A,B\r\n1,2\r\n")).toEqual([["A", "B"], ["1", "2"]]);
  });

  it("CRLF と LF のどちらでも読める", () => {
    expect(parseCsv("A,B\n1,2\n")).toEqual([["A", "B"], ["1", "2"]]);
    expect(parseCsv("A,B\r\n1,2")).toEqual([["A", "B"], ["1", "2"]]);
  });

  it("クォートの中の , と改行を壊さない", () => {
    expect(parseCsv('A,B\r\n"x,y","1\r\n2"\r\n')).toEqual([["A", "B"], ["x,y", "1\r\n2"]]);
  });

  it('"" を " に戻す', () => {
    expect(parseCsv('A\r\n"he said ""hi"""\r\n')).toEqual([["A"], ['he said "hi"']]);
  });

  it("空行は行として数えない（末尾の改行・Excel の余白行）", () => {
    expect(parseCsv("A,B\r\n1,2\r\n\r\n,\r\n")).toEqual([["A", "B"], ["1", "2"]]);
  });

  it("値が空でも列は落とさない", () => {
    expect(parseCsv("A,B,C\r\n1,,3\r\n")).toEqual([["A", "B", "C"], ["1", "", "3"]]);
  });
});

describe("🔴 数式インジェクション対策の ' を外す（往復できる）", () => {
  it("先頭の ' を外すのは、次の1文字が数式の始まりのときだけ", () => {
    expect(unescapeCsvValue("'=1+1")).toBe("=1+1");
    expect(unescapeCsvValue("'@name")).toBe("@name");
    expect(unescapeCsvValue("'-5")).toBe("-5");
    // ふつうの値は触らない
    expect(unescapeCsvValue("O'Brien")).toBe("O'Brien");
    expect(unescapeCsvValue("'quoted'")).toBe("'quoted'");
    expect(unescapeCsvValue("")).toBe("");
  });

  it("書き出し → 読み取りで元の文字列に戻る", () => {
    const rows = [{ name: "=SUM(A1)", memo: 'a,b "c"\r\nd' }];
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { header: "名前", value: (r) => r.name },
      { header: "メモ", value: (r) => r.memo },
    ];
    const grid = parseCsv(toCsv(rows, columns));
    expect(grid[0]).toEqual(["名前", "メモ"]);
    expect(grid[1].map(unescapeCsvValue)).toEqual(["=SUM(A1)", 'a,b "c"\r\nd']);
  });
});

describe("列の対応", () => {
  it("書き出し側の見出しをそのまま受ける", () => {
    const cols = mapHeader(["顧客ID", "名前", "ふりがな", "電話番号", "プラン", "在籍状態", "入会日"]);
    expect(cols).toEqual({ display_name: 1, name_kana: 2, phone: 3, plan: 4, status: 5, joined_at: 6 });
  });

  it("別名と大文字小文字のゆれを吸収する", () => {
    expect(mapHeader(["氏名", "TEL", "Plan"])).toEqual({ display_name: 0, phone: 1, plan: 2 });
  });

  it("知らない見出しは無視する（顧客IDや登録日時を取り込まない）", () => {
    const cols = mapHeader(["顧客ID", "登録日時", "名前"]);
    expect(cols).toEqual({ display_name: 2 });
  });
});

describe("値の正規化", () => {
  it("電話番号は数字だけで比べる（ハイフン・全角を吸収）", () => {
    expect(normalizePhone("090-1234-5678")).toBe("09012345678");
    expect(normalizePhone("０９０１２３４５６７８")).toBe("09012345678");
    expect(normalizePhone(null)).toBe("");
  });

  it("名前は空白と全角半角を吸収して比べる", () => {
    expect(normalizeName("ABC DEF")).toBe(normalizeName("ABC　DEF"));
    expect(normalizeName("ＡＢＣ")).toBe(normalizeName("abc"));
  });

  it("在籍状態は日本語でもコードでも読める", () => {
    expect(parseStatus("在籍中")).toBe("active");
    expect(parseStatus("休会")).toBe("suspended");
    expect(parseStatus("退会")).toBe("withdrawn");
    expect(parseStatus("active")).toBe("active");
    expect(parseStatus("")).toBe("active"); // 未記入は在籍
    expect(parseStatus("???")).toBeNull();
  });

  it("入会日は yyyy-MM-dd / yyyy/MM/dd を受ける", () => {
    expect(parseJoinedAt("2026-04-01")).toEqual({ value: "2026-04-01", ok: true });
    expect(parseJoinedAt("2026/4/1")).toEqual({ value: "2026-04-01", ok: true });
    expect(parseJoinedAt("")).toEqual({ value: null, ok: true });
    expect(parseJoinedAt("令和8年4月1日").ok).toBe(false);
  });
});

const csv = (...lines: string[]) => lines.join("\r\n") + "\r\n";
const HEAD = "名前,ふりがな,電話番号,プラン,在籍状態,入会日";

describe("🔴 名前の無い行を作らない", () => {
  it("名前が空の行はエラーにする", () => {
    const { rows } = parseCustomerCsv(csv(HEAD, ",カナ,090-0000-0000,,,"));
    expect(rows[0].errors.map((e) => e.code)).toContain("nameRequired");
    expect(importableRows(rows)).toHaveLength(0);
  });

  it("名前の列が無い CSV は丸ごと受け付けない", () => {
    const res = parseCustomerCsv(csv("ふりがな,電話番号", "カナ,090-0000-0000"));
    expect(res.missingFields).toContain("display_name");
    expect(res.rows).toHaveLength(0);
  });
});

describe("🔴 既に居る人を二重に作らない", () => {
  const existing = [{ display_name: "ABC DEF", phone: "090-1111-2222" }];

  it("電話番号が一致したら重複にする（表記のゆれを越えて）", () => {
    const { rows } = parseCustomerCsv(csv(HEAD, "GHI JKL,,09011112222,,,"), existing);
    expect(rows[0].duplicate).toBe(true);
    expect(rows[0].warnings.map((w) => w.code)).toContain("duplicatePhone");
    expect(importableRows(rows)).toHaveLength(0);
  });

  it("電話が無いときは名前で見る", () => {
    const { rows } = parseCustomerCsv(csv(HEAD, "ABC　DEF,,,,,"), existing);
    expect(rows[0].duplicate).toBe(true);
    expect(rows[0].warnings.map((w) => w.code)).toContain("duplicateName");
  });

  it("同じ CSV の中の重複も2件目だけ落とす", () => {
    const { rows } = parseCustomerCsv(csv(HEAD, "MNO PQR,,090-3333-4444,,,", "MNO PQR,,090-3333-4444,,,"));
    expect(rows[0].duplicate).toBe(false);
    expect(rows[1].duplicate).toBe(true);
    expect(importableRows(rows)).toHaveLength(1);
  });

  it("別人は重複にしない", () => {
    const { rows } = parseCustomerCsv(csv(HEAD, "STU VWX,,090-5555-6666,,,"), existing);
    expect(rows[0].duplicate).toBe(false);
    expect(importableRows(rows)).toHaveLength(1);
  });
});

describe("列ごとの検証", () => {
  it("DB の CHECK と同じ長さで弾く", () => {
    const { rows } = parseCustomerCsv(
      csv(HEAD, `ABC,${"あ".repeat(MAX_KANA + 1)},${"9".repeat(MAX_PHONE + 1)},,,`),
    );
    const codes = rows[0].errors.map((e) => e.code);
    expect(codes).toContain("kanaTooLong");
    expect(codes).toContain("phoneTooLong");
  });

  it("読めない在籍状態はエラーにし、値を持ち帰る", () => {
    const { rows } = parseCustomerCsv(csv(HEAD, "ABC,,,,幽霊,"));
    expect(rows[0].errors).toContainEqual({ code: "statusUnknown", value: "幽霊" });
  });

  it("読めない入会日はエラーにする", () => {
    const { rows } = parseCustomerCsv(csv(HEAD, "ABC,,,,,きのう"));
    expect(rows[0].errors.map((e) => e.code)).toContain("joinedAtUnreadable");
  });

  it("ジムに無いプラン名は警告だけ（取り込みは止めない）", () => {
    const { rows } = parseCustomerCsv(csv(HEAD, "ABC,,,月10回コース,,"), [], ["月4回コース"]);
    expect(rows[0].warnings).toContainEqual({ code: "planUnknown", value: "月10回コース" });
    expect(rows[0].errors).toHaveLength(0);
    expect(importableRows(rows)).toHaveLength(1);
  });

  it("プランを1つも登録していないジムでは警告を出さない", () => {
    const { rows } = parseCustomerCsv(csv(HEAD, "ABC,,,なにか,,"), [], []);
    expect(rows[0].warnings).toHaveLength(0);
  });

  it("行番号は CSV の見た目と一致する（見出しが1行目）", () => {
    const { rows } = parseCustomerCsv(csv(HEAD, "ABC,,,,,", "DEF,,,,,"));
    expect(rows.map((r) => r.line)).toEqual([2, 3]);
  });
});

describe("書き出した顧客CSVをそのまま読み戻せる", () => {
  it("往復して名前・ふりがな・電話・プランが保たれる", () => {
    const src = [{ name: "ABC DEF", kana: "エービーシー", phone: "090-1234-5678", plan: "月4回コース" }];
    const columns: CsvColumn<(typeof src)[number]>[] = [
      { header: "顧客ID", value: () => "00000000-0000-0000-0000-000000000000" },
      { header: "名前", value: (r) => r.name },
      { header: "ふりがな", value: (r) => r.kana },
      { header: "電話番号", value: (r) => r.phone },
      { header: "プラン", value: (r) => r.plan },
      { header: "在籍状態", value: () => "active" },
      { header: "入会日", value: () => "2026-04-01" },
    ];
    const { rows } = parseCustomerCsv(toCsv(src, columns), [], ["月4回コース"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      display_name: "ABC DEF",
      name_kana: "エービーシー",
      phone: "090-1234-5678",
      plan: "月4回コース",
      status: "active",
      joined_at: "2026-04-01",
    });
    expect(rows[0].errors).toHaveLength(0);
    expect(rows[0].warnings).toHaveLength(0);
  });
});

describe("🔴 画面の文言をライブラリに持たせない", () => {
  it("エラー・警告は符号で返す（5言語 i18n なので文言は画面側が持つ）", () => {
    const src = readFileSync("src/lib/csvImport.ts", "utf8");
    // errors.push / warnings.push に文字列リテラルを直接渡していないこと
    expect(src).not.toMatch(/(errors|warnings)\.push\(\s*["'`]/);
    expect(src).toMatch(/errors\.push\(\{ code:/);
  });
});

describe("文字コードの判別", () => {
  const utf8 = (s: string) => new TextEncoder().encode(s);

  it("UTF-8（BOM 付き＝自分の書き出し）を読む。BOM は復号の時点で落ちる", () => {
    // TextDecoder("utf-8") は BOM を自分で取り除く。parseCsv 側にも保険がある
    expect(decodeCsvBytes(utf8("\ufeff名前\r\nABC\r\n"))).toBe("名前\r\nABC\r\n");
  });

  it("⚠️ Windows の Excel が出す Shift_JIS も読める", () => {
    // 「名前」を CP932 で書いたバイト列
    const sjis = new Uint8Array([0x96, 0xbc, 0x91, 0x4f, 0x0d, 0x0a]);
    expect(decodeCsvBytes(sjis)).toBe("名前\r\n");
  });

  it("Shift_JIS の CSV を最後まで通せる", () => {
    // "名前,電話番号\r\nABC,090\r\n" を CP932 で
    const head = new Uint8Array([0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x93, 0x64, 0x98, 0x62, 0x94, 0xd4, 0x8d, 0x86, 0x0d, 0x0a]);
    const body = new TextEncoder().encode("ABC,090\r\n");
    const all = new Uint8Array([...head, ...body]);
    const { rows } = parseCustomerCsv(decodeCsvBytes(all));
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe("ABC");
    expect(rows[0].phone).toBe("090");
  });
});
