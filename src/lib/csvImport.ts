// CSV の読み取り（顧客の一括登録）。
//
// 置き場所を lib にしているのは、書き出し側（csvExport.ts）と同じ理由で、
// **解析と検証を純粋関数にして画面と切り離すため**。画面（TrainerCustomerImport）は
// 「ファイルを読む → parseCustomerCsv → 確認して送る」を繋ぐだけにしてある。
//
// 🔴 このファイルが守っている不変条件:
//   1. 書き出した CSV をそのまま読み戻せる（往復できる）
//      … BOM・CRLF・クォート・**数式インジェクション対策の ' を外す**まで含めて
//   2. 名前の無い行を作らない（誰か分からない顧客が増えると片付けられない）
//   3. 既に居る人を二重に作らない（同じ CSV を2回流しても増えない）

import { MEMBER_STATUSES, type MemberStatus } from "@/lib/memberLifecycle";

/**
 * ファイルの中身を文字列にする。
 *
 * ⚠️ Windows の Excel が「CSV」で保存すると**既定は Shift_JIS（CP932）**。
 *    他のシステムから出した名簿もまずこれで来る。UTF-8 として読めなければ
 *    Shift_JIS とみなす（UTF-8 の妥当なバイト列を Shift_JIS と誤判定することは無い）。
 *    ジムボード自身の書き出しは UTF-8 + BOM なので、そのまま通る。
 */
export const decodeCsvBytes = (bytes: ArrayBuffer | Uint8Array): string => {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
};

/**
 * RFC 4180 の CSV を行×セルに分解する。
 *
 * 自前で書いているのは、外部ライブラリを1つ増やすほどの分量ではないのと、
 * **書き出し側（csvExport.escapeCsvValue）と規則を1対1で対応させたい**ため。
 * 対応するもの: BOM / CRLF・LF / クォート内の , と改行 / "" によるクォートの埋め込み。
 */
export const parseCsv = (text: string): string[][] => {
  // Excel が付ける BOM は最初のセルの先頭に紛れ込むので、ここで落とす
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        // "" はエスケープされた " 。それ以外はクォートの終わり
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else {
        cell += c;
      }
      continue;
    }

    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\r") { if (src[i + 1] === "\n") i++; rows.push([...row, cell]); row = []; cell = ""; continue; }
    if (c === "\n") { rows.push([...row, cell]); row = []; cell = ""; continue; }
    cell += c;
  }
  // 最終行（末尾に改行が無い場合）。空行だけは足さない
  if (cell !== "" || row.length > 0) rows.push([...row, cell]);

  // 全セルが空の行は落とす（末尾の改行や Excel の余白行が1件として数えられるのを防ぐ）
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
};

/**
 * 🔴 書き出し側が付けた数式インジェクション対策の ' を外す。
 *
 * csvExport は `=` `+` `-` `@` タブ CR で始まる値の**先頭に ' を足す**。
 * これを外さないと、往復させたときに名前が `'=山田` のように化けて増えていく。
 *
 * ⚠️ 「本当に ' で始まり、2文字目がたまたま = だった値」は区別できない。
 *    その形の名前は現実には無いので、往復が壊れないほうを採る。
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

export const unescapeCsvValue = (value: string): string => {
  if (value.length >= 2 && value[0] === "'" && FORMULA_TRIGGERS.includes(value[1])) {
    return value.slice(1);
  }
  return value;
};

// ---------------------------------------------------------------------------
// 列の対応
// ---------------------------------------------------------------------------

/**
 * 受け付ける見出しと、その別名。
 *
 * 先頭が**書き出し側の見出しと同じ文字列**になっているのが大事で、
 * 「書き出した CSV を直して読み戻す」がそのままできる。
 * 別名は、他社のシステムから出した CSV をそのまま通せるようにするためのもの。
 */
export const IMPORT_FIELDS = {
  display_name: ["名前", "氏名", "顧客名", "name"],
  name_kana: ["ふりがな", "フリガナ", "カナ", "kana"],
  phone: ["電話番号", "電話", "TEL", "tel", "phone"],
  plan: ["プラン", "コース", "plan"],
  status: ["在籍状態", "状態", "ステータス", "status"],
  joined_at: ["入会日", "入会", "joined_at"],
} as const;

export type ImportField = keyof typeof IMPORT_FIELDS;

/** 取り込む列（画面の説明にもこの順で出す） */
export const IMPORT_FIELD_ORDER: readonly ImportField[] = [
  "display_name", "name_kana", "phone", "plan", "status", "joined_at",
];

/** 見出し行 → 列番号。知らない見出しは黙って無視する（顧客ID・登録日時など） */
export const mapHeader = (header: string[]): Partial<Record<ImportField, number>> => {
  const out: Partial<Record<ImportField, number>> = {};
  header.forEach((raw, i) => {
    const h = unescapeCsvValue(raw).trim().toLowerCase();
    for (const field of IMPORT_FIELD_ORDER) {
      if (out[field] !== undefined) continue;
      if (IMPORT_FIELDS[field].some((alias) => alias.toLowerCase() === h)) out[field] = i;
    }
  });
  return out;
};

// ---------------------------------------------------------------------------
// 1行の検証
// ---------------------------------------------------------------------------

/** 電話番号の比較用に数字だけにする。ハイフンや全角の違いで別人にしない。 */
export const normalizePhone = (phone: string | null | undefined): string =>
  (phone ?? "")
    // 全角数字を半角に
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, "");

/** 突き合わせ用の名前。空白と全角半角のゆれを吸収する。 */
export const normalizeName = (name: string | null | undefined): string =>
  (name ?? "").replace(/[\s　]/g, "").normalize("NFKC").toLowerCase();

const STATUS_ALIASES: Record<string, MemberStatus> = {
  ...Object.fromEntries(MEMBER_STATUSES.map((s) => [s, s])),
  在籍中: "active", 在籍: "active", 有効: "active",
  休会中: "suspended", 休会: "suspended",
  退会: "withdrawn", 退会済み: "withdrawn",
};

export const parseStatus = (raw: string): MemberStatus | null => {
  const s = raw.trim();
  if (s === "") return "active";
  return STATUS_ALIASES[s] ?? STATUS_ALIASES[s.toLowerCase()] ?? null;
};

/** 入会日。yyyy-MM-dd / yyyy/MM/dd を受ける。空なら null（DB 側で now() になる）。 */
export const parseJoinedAt = (raw: string): { value: string | null; ok: boolean } => {
  const s = raw.trim();
  if (s === "") return { value: null, ok: true };
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return { value: null, ok: false };
  const [, y, mo, d] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00+09:00`);
  if (Number.isNaN(dt.getTime())) return { value: null, ok: false };
  return { value: iso, ok: true };
};

/** DB の CHECK に合わせた上限（profiles_phone_len / profiles_name_kana_len） */
export const MAX_PHONE = 30;
export const MAX_KANA = 100;
export const MAX_NAME = 100;

/**
 * 行の問題を表す符号。
 *
 * 🔴 ここで日本語の文言を作らない。画面の文字は i18n が持つ（5言語あり、
 *    兄弟アプリは語彙をオーバーレイする）。ライブラリは「何が起きたか」だけ返す。
 */
export type ImportIssueCode =
  | "nameRequired"
  | "nameTooLong"
  | "kanaTooLong"
  | "phoneTooLong"
  | "statusUnknown"
  | "joinedAtUnreadable"
  | "planUnknown"
  | "duplicatePhone"
  | "duplicateName"
  | "duplicateInFilePhone"
  | "duplicateInFileName";

export interface ImportIssue {
  code: ImportIssueCode;
  /** 文言に差し込む値（読めなかった在籍状態の文字列など） */
  value?: string;
}

export interface ImportRow {
  /** CSV の何行目か（見出しを1行目として数える。画面で場所を示すため） */
  line: number;
  display_name: string;
  name_kana: string | null;
  phone: string | null;
  plan: string | null;
  status: MemberStatus;
  joined_at: string | null;
  /** 取り込めない理由。空なら取り込める */
  errors: ImportIssue[];
  /** 取り込めるが知らせたいこと（既存と同じ人・プラン名が未登録 など） */
  warnings: ImportIssue[];
  /** 既に居る人と重なっている（取り込まない） */
  duplicate: boolean;
}

export interface ExistingCustomer {
  display_name: string | null;
  phone: string | null;
}

export interface ParseResult {
  rows: ImportRow[];
  /** 見出し行に無くて拾えなかった必須列 */
  missingFields: ImportField[];
  /** 見出し行そのもの（画面に出して対応を見せる） */
  header: string[];
}

/**
 * CSV 本文を、取り込める行の一覧に変える。
 *
 * `existing` には**そのジムの既存顧客**を渡す。電話番号（数字だけ）か、
 * 電話が無ければ名前で突き合わせて、既に居る人は duplicate にする。
 * 🔴 ここで弾かないと、同じ CSV を2回流したときに顧客が倍になる。
 *
 * `knownPlans` には tenant_plans のプラン名を渡す。売上集計はプラン名の
 * 文字列一致で価格を引くので、一致しない名前は警告にする（取り込みは止めない）。
 */
export const parseCustomerCsv = (
  text: string,
  existing: readonly ExistingCustomer[] = [],
  knownPlans: readonly string[] = [],
): ParseResult => {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], missingFields: ["display_name"], header: [] };

  const header = grid[0].map((h) => unescapeCsvValue(h).trim());
  const cols = mapHeader(header);
  if (cols.display_name === undefined) {
    return { rows: [], missingFields: ["display_name"], header };
  }

  const existingPhones = new Set(
    existing.map((e) => normalizePhone(e.phone)).filter((p) => p !== ""),
  );
  const existingNames = new Set(
    existing.map((e) => normalizeName(e.display_name)).filter((n) => n !== ""),
  );
  const planSet = new Set(knownPlans.map((p) => p.trim()).filter(Boolean));

  // CSV の中での重複も見る（同じファイルに同じ人が2回書かれている場合）
  const seenPhones = new Set<string>();
  const seenNames = new Set<string>();

  const at = (cells: string[], field: ImportField): string => {
    const i = cols[field];
    return i === undefined ? "" : unescapeCsvValue(cells[i] ?? "").trim();
  };

  const rows: ImportRow[] = grid.slice(1).map((cells, idx) => {
    const line = idx + 2; // 見出しが1行目
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];

    const display_name = at(cells, "display_name");
    if (display_name === "") errors.push({ code: "nameRequired" });
    else if (display_name.length > MAX_NAME) errors.push({ code: "nameTooLong" });

    const kanaRaw = at(cells, "name_kana");
    if (kanaRaw.length > MAX_KANA) errors.push({ code: "kanaTooLong" });

    const phoneRaw = at(cells, "phone");
    if (phoneRaw.length > MAX_PHONE) errors.push({ code: "phoneTooLong" });

    const statusRaw = at(cells, "status");
    const status = parseStatus(statusRaw);
    if (status === null) errors.push({ code: "statusUnknown", value: statusRaw });

    const joined = parseJoinedAt(at(cells, "joined_at"));
    if (!joined.ok) errors.push({ code: "joinedAtUnreadable" });

    const plan = at(cells, "plan");
    if (plan !== "" && planSet.size > 0 && !planSet.has(plan)) {
      warnings.push({ code: "planUnknown", value: plan });
    }

    // 突き合わせ: 電話があれば電話、無ければ名前
    const nphone = normalizePhone(phoneRaw);
    const nname = normalizeName(display_name);
    let duplicate = false;
    if (nphone !== "") {
      if (existingPhones.has(nphone)) { duplicate = true; warnings.push({ code: "duplicatePhone" }); }
      else if (seenPhones.has(nphone)) { duplicate = true; warnings.push({ code: "duplicateInFilePhone" }); }
      seenPhones.add(nphone);
    } else if (nname !== "") {
      if (existingNames.has(nname)) { duplicate = true; warnings.push({ code: "duplicateName" }); }
      else if (seenNames.has(nname)) { duplicate = true; warnings.push({ code: "duplicateInFileName" }); }
      seenNames.add(nname);
    }

    return {
      line,
      display_name,
      name_kana: kanaRaw || null,
      phone: phoneRaw || null,
      plan: plan || null,
      status: status ?? "active",
      joined_at: joined.value,
      errors,
      warnings,
      duplicate,
    };
  });

  return { rows, missingFields: [], header };
};

/** 実際に送る行だけを取り出す（エラー無し・重複でない）。 */
export const importableRows = (rows: readonly ImportRow[]): ImportRow[] =>
  rows.filter((r) => r.errors.length === 0 && !r.duplicate);
