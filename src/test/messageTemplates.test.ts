import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  appendTemplate,
  replaceTemplateVars,
  usesTemplateVars,
} from "@/lib/messageTemplate";

// ジム側の定型文。
//
// 「本日もお疲れさまでした」「次回のご予約はいかがですか」を毎回手で打っていた。
// 離脱アラートの「声かけ」から飛んできたときも、結局その場で文章を考えることになる。
//
// ── ここで守りたいこと ────────────────────────────────────────────
//
//  1. **差し込みで変な文面を作らないこと。** これは**お客様に送る文章**なので、
//     「様、こんにちは」のような文字列が出た時点で事故
//  2. **書きかけの文を消さないこと。** 定型文を押したら入力欄が置き換わる、は駄目
//  3. **お客様に定型文の一覧が見えないこと**（ジムの営業文言そのもの）

const MIGRATION = readFileSync("supabase/migrations/20260811030000_message_templates.sql", "utf8");
const SQL = MIGRATION.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const TRAINER = readFileSync("src/components/trainer/TrainerMessages.tsx", "utf8");
const HOOK = readFileSync("src/hooks/useMessageTemplates.ts", "utf8");
const CUSTOMER = readFileSync("src/components/customer/CustomerChat.tsx", "utf8");

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
const localeJson = (lng: string) =>
  JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8")) as Record<string, any>;

describe("差し込み（お客様に送る文面を壊さない）", () => {
  it("名前があれば置き換わる", () => {
    expect(replaceTemplateVars("{{name}}様、お疲れさまでした", { name: "山田" })).toBe(
      "山田様、お疲れさまでした",
    );
  });

  it("🔴 名前が無いときは敬称ごと落とす", () => {
    // 素朴に空文字へ置換すると「様、お疲れさまでした」になる。お客様に送る文面として事故。
    expect(replaceTemplateVars("{{name}}様、お疲れさまでした", { name: null })).toBe(
      "お疲れさまでした",
    );
    expect(replaceTemplateVars("{{name}}さん、こんにちは", { name: undefined })).toBe(
      "こんにちは",
    );
    expect(replaceTemplateVars("{{name}}、ご予約ありがとうございます", { name: "" })).toBe(
      "ご予約ありがとうございます",
    );
  });

  it("空白だけの名前も「無し」として扱う", () => {
    expect(replaceTemplateVars("{{name}}様、こんにちは", { name: "   " })).toBe("こんにちは");
  });

  it("名前の前後の空白は落とす", () => {
    expect(replaceTemplateVars("{{name}}様", { name: " 佐藤 " })).toBe("佐藤様");
  });

  it("文中・複数回の差し込みも効く", () => {
    expect(replaceTemplateVars("こんにちは、{{name}}様", { name: "鈴木" })).toBe(
      "こんにちは、鈴木様",
    );
    expect(replaceTemplateVars("{{name}}様\n{{name}}様", { name: "田中" })).toBe(
      "田中様\n田中様",
    );
  });

  it("差し込みが無い本文はそのまま", () => {
    expect(replaceTemplateVars("本日もお疲れさまでした", { name: "山田" })).toBe(
      "本日もお疲れさまでした",
    );
  });

  it("🔴 知らない差し込みは消さずに残す", () => {
    // 消すと、書いたつもりの文が黙って欠ける。
    expect(replaceTemplateVars("{{plan}}のご案内", { name: "山田" })).toBe("{{plan}}のご案内");
  });

  it("差し込みの有無を判定できる", () => {
    expect(usesTemplateVars("{{name}}様")).toBe(true);
    expect(usesTemplateVars("こんにちは")).toBe(false);
  });
});

describe("🔴 書きかけの文を消さない", () => {
  it("空なら定型文をそのまま入れる", () => {
    expect(appendTemplate("", "お疲れさまでした")).toBe("お疲れさまでした");
    expect(appendTemplate("   ", "お疲れさまでした")).toBe("お疲れさまでした");
  });

  it("書きかけがあれば末尾に足す（上書きしない）", () => {
    expect(appendTemplate("いつもありがとうございます。", "またお待ちしています。")).toBe(
      "いつもありがとうございます。\nまたお待ちしています。",
    );
  });

  it("末尾の余分な改行で行が増えない", () => {
    expect(appendTemplate("こんにちは\n\n", "本文")).toBe("こんにちは\n本文");
  });
});

describe("🔴 お客様には見せない", () => {
  it("SELECT が trainer に限定されている", () => {
    const idx = SQL.indexOf("message_templates_select");
    expect(idx, "SELECT ポリシーがありません").toBeGreaterThan(-1);
    expect(SQL.slice(idx, idx + 300)).toMatch(
      /has_role\(auth\.uid\(\), 'trainer'::app_role\)/,
    );
  });

  it("書き込みも全部 trainer に限定されている", () => {
    for (const op of ["insert", "update", "delete"]) {
      const idx = SQL.indexOf(`message_templates_${op}`);
      expect(idx, `${op} のポリシーがありません`).toBeGreaterThan(-1);
      expect(SQL.slice(idx, idx + 300), `${op} が trainer 限定になっていません`).toMatch(
        /has_role\(auth\.uid\(\), 'trainer'::app_role\)/,
      );
    }
  });

  it("テナント分離が RESTRICTIVE で入っている", () => {
    expect(SQL).toMatch(
      /CREATE POLICY tenant_isolation ON public\.message_templates AS RESTRICTIVE/,
    );
    expect(SQL).toMatch(/tenant_id = public\.get_my_tenant_id\(\)/);
  });

  it("お客様の画面に定型文が出ていない", () => {
    expect(
      /useMessageTemplates|MessageTemplateChips/.test(CUSTOMER),
      "CustomerChat に定型文が出ています。ジムの営業文言をお客様に見せないこと。",
    ).toBe(false);
  });
});

describe("入力の縛り", () => {
  it("表示名と本文に長さ制限がある", () => {
    // ⚠️ 部分一致で見ると `<= 30` が `<= 30000` にも当たる（実際に変異を素通りさせた）。
    //    数値を取り出して比較する。
    const limitOf = (col: string) => {
      const m = SQL.match(new RegExp(`char_length\\(${col}\\) <= (\\d+)`));
      return m ? Number(m[1]) : null;
    };
    expect(limitOf("title"), "表示名の長さ制限がありません").toBe(30);
    expect(limitOf("body"), "本文の長さ制限がありません").toBe(1000);
    // 制約名も残っていること（名前が変わると DROP/再作成の対応が崩れる）
    expect(SQL).toMatch(/message_templates_title_len/);
    expect(SQL).toMatch(/message_templates_body_len/);
  });

  it("空文字を登録できない", () => {
    expect(SQL).toMatch(/btrim\(title\) <> ''/);
    expect(SQL).toMatch(/btrim\(body\) <> ''/);
  });

  it("並び順に索引がある", () => {
    expect(SQL).toMatch(/message_templates \(tenant_id, sort_order, created_at\)/);
  });
});

describe("チャットからの使い勝手", () => {
  it("ジム側のチャットにチップと管理が出ている", () => {
    expect(TRAINER).toMatch(/<MessageTemplateChips/);
    expect(TRAINER).toMatch(/<MessageTemplateDialog/);
  });

  it("🔴 定型文の挿入が上書きになっていない", () => {
    const idx = TRAINER.indexOf("const applyTemplate");
    expect(idx, "applyTemplate がありません").toBeGreaterThan(-1);
    const body = TRAINER.slice(idx, idx + 400);
    expect(body, "書きかけを残す形になっていません").toMatch(/appendTemplate/);
    expect(body, "差し込みを解決していません").toMatch(/replaceTemplateVars/);
    // 相手の名前を渡していること（渡さないと {{name}} が常に消える）
    expect(body, "送信先の名前を渡していません").toMatch(/selected\?\.display_name/);
  });

  it("並べ替えが番号を振り直してから入れ替える", () => {
    // 既存行は sort_order が同値で並んでいることがある（既定 0 のまま作られた等）。
    // 単純な入れ替えだと動かない。
    expect(HOOK).toMatch(/sort_order: i/);
  });
});

describe("5言語", () => {
  const KEYS = [
    "manageTitle",
    "manageDescription",
    "empty",
    "add",
    "atLimit",
    "titlePlaceholder",
    "bodyPlaceholder",
    "varHint",
    "moveUp",
    "moveDown",
    "errEmpty",
    "errSaveFailed",
    "errDeleteFailed",
  ];

  it("messageTemplates が全言語に揃っている", () => {
    for (const lng of LOCALES) {
      const ns = localeJson(lng).messageTemplates;
      expect(ns, `${lng}.json に messageTemplates がありません`).toBeTruthy();
      for (const k of KEYS) {
        expect(typeof ns[k] === "string" && ns[k].length > 0, `${lng}.json の ${k} が空です`).toBe(
          true,
        );
      }
    }
  });

  it("上限の文言に {{max}} が入っている", () => {
    for (const lng of LOCALES) {
      expect(localeJson(lng).messageTemplates.atLimit, `${lng}`).toContain("{{max}}");
    }
  });

  it("差し込みの説明に {{name}} が出ている", () => {
    // 使い方が分からないと誰も使わない。
    for (const lng of LOCALES) {
      expect(localeJson(lng).messageTemplates.varHint, `${lng}`).toContain("{{name}}");
    }
  });
});
