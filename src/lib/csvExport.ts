// CSV の組み立てとダウンロード。ジムのデータを Excel / 他システムへ持ち出すために使う。
//
// 置き場所を lib にしているのは、**組み立て（純粋関数）を画面と切り離してテストするため**。
// 画面側（TrainerDataExport）は「取得 → toCsv → downloadCsv」を繋ぐだけにしてある。
//
// 🔴 このファイルが守っている不変条件は3つ。どれも壊すと静かに事故る:
//   1. CSV インジェクション対策（下記）
//   2. Excel が文字化けしないこと（UTF-8 BOM + CRLF）
//   3. 値の中の " , 改行 を壊さないこと（RFC 4180 のクォート規則）

/** Excel が UTF-8 と判別するための BOM。これが無いと日本語が全部化ける。 */
const BOM = "﻿";

/** RFC 4180 は CRLF。Excel も CRLF を期待するので LF にしない。 */
const CRLF = "\r\n";

/**
 * 🔴 CSV インジェクション（数式インジェクション）対策。
 *
 * 表計算ソフトは `=` `+` `-` `@` で始まるセルを**数式として解釈する**。
 * ジムボードの CSV には**お客様が自分で入力した文字列**（表示名・メモ・
 * 体験予約の回答など）がそのまま載るので、悪意ある値が書き込まれていると、
 * 店の人が Excel で開いた瞬間に外部通信やコマンド実行に繋がりうる。
 *
 * 対策は「先頭にシングルクォートを足して文字列として読ませる」。
 * 表示上は Excel 側が ' を隠すので、店の人の見た目は変わらない。
 *
 * タブ・CR も Excel/LibreOffice が数式の開始と見なす経路があるので同じ扱いにする。
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

export const escapeCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";

  let s = typeof value === "string" ? value : String(value);

  // 1) 数式として解釈されうる先頭文字を無害化する（値そのものは消さない）
  if (s.length > 0 && FORMULA_TRIGGERS.includes(s[0])) {
    s = `'${s}`;
  }

  // 2) " , 改行 のいずれかを含むならクォートで包み、中の " は "" にする
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export interface CsvColumn<T> {
  /** ヘッダー行に出る見出し（日本語でよい） */
  header: string;
  /** 1行分のデータから、そのセルの値を取り出す */
  value: (row: T) => unknown;
}

/**
 * 行の配列と列定義から CSV 本文を組み立てる（BOM は付けない）。
 * 0件でもヘッダー行だけは返す。「空のファイル」より「中身が無いと分かるファイル」のほうがよい。
 */
export const toCsv = <T,>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string => {
  const head = columns.map((c) => escapeCsvValue(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsvValue(c.value(row))).join(","));
  return [head, ...body].join(CRLF) + CRLF;
};

/**
 * ファイル名。`顧客_サンプルジム_2026-08-24.csv` の形。
 * ファイル名に使えない文字（/ \ : * ? " < > |）はジム名から落とす。
 */
export const buildCsvFilename = (kind: string, gymName: string | null | undefined, today: string): string => {
  const safeGym = (gymName ?? "").replace(/[\\/:*?"<>|]/g, "").trim();
  return safeGym ? `${kind}_${safeGym}_${today}.csv` : `${kind}_${today}.csv`;
};

/**
 * CSV をダウンロードさせる。
 *
 * ⚠️ ネイティブ（iOS/Android の WebView）では `<a download>` が効かない。
 * @capacitor/filesystem を入れればネイティブ保存もできるが、プラグイン追加＝
 * ネイティブの作り直しが要るので、ここでは**Web でだけ落とせる**形にしてある。
 * 呼び出し側がネイティブを判定して案内を出すこと（canDownloadCsv を使う）。
 */
export const downloadCsv = (filename: string, csvBody: string): void => {
  const blob = new Blob([BOM + csvBody], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 即 revoke すると Safari がダウンロードを取りこぼすことがあるので、少し置いてから捨てる
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
