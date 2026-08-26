import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { EMAIL_NOTE_MAX_LENGTH } from "@/lib/emailNotes";
import { TENANT_OPTIONAL_COL_GROUPS, TENANT_VALUE_DEFAULTS } from "@/lib/tenantColumns";

// 体験メールの「キャンセル・変更」欄を店ごとの文章にできる仕組みの見張り（2026-08-26）。
//
// もともとこの欄はテンプレートの固定文（全ジム共通）だった。キャンセルの連絡先・方針は
// 店ごとに違う（LINE・電話・メール）ので、上流が文章を代弁しない
// （cancel_policy_body / email_note と同じ方針）。
//
// 🔴 決めごと（宗本さん決定）:
//   1. 設定した場合は**その文章だけ**を出す。ジムのメールアドレスの mailto リンクも
//      自動では足さない（「お電話ください」と書いたのにリンクが残る食い違いを作らない）
//   2. NULL/空なら従来の固定文＋リンクのまま（全店 NULL スタート＝挙動不変）
//   3. 確認メールとリマインドメールで**同じ1つの欄**を使う（同じポリシーの案内なので）

const MIGRATION = "supabase/migrations/20260826050000_trial_email_cancel_note.sql";
const CONFIRMATION = "supabase/functions/_shared/transactional-email-templates/trial-booking-confirmation.tsx";
const REMINDER = "supabase/functions/_shared/transactional-email-templates/trial-booking-reminder.tsx";
const TRIAL_BOOK = "supabase/functions/trial-book/index.ts";
const REMINDERS_FN = "supabase/functions/send-trial-reminders/index.ts";
const SETTINGS = "src/components/trainer/TrialCancelNoteCard.tsx";

const read = (p: string) => readFileSync(p, "utf8");

describe("DB（migration）", () => {
  const sql = read(MIGRATION);

  it("列と名前つき CHECK がある", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS trial_email_cancel_note TEXT");
    expect(sql).toContain("tenants_trial_email_cancel_note_len");
  });

  it("🔴 文字数上限がクライアントの定数と同じ", () => {
    // ずれると「画面では入るのに保存で落ちる」になる
    expect(sql).toContain(`char_length(trial_email_cancel_note) <= ${EMAIL_NOTE_MAX_LENGTH}`);
  });

  it("🔴 既定文の backfill をしていない（全店 NULL スタート＝挙動不変）", () => {
    expect(sql).not.toMatch(/UPDATE\s+public\.tenants/i);
  });
});

describe("メールテンプレート", () => {
  it.each([CONFIRMATION, REMINDER])("%s: cancelNote があればそれ**だけ**を出す（固定文の分岐より先）", (p) => {
    const src = read(p);
    // 設定時の分岐が、固定文の分岐（cancelUrl / gymContactEmail）より前に評価される
    const noteIdx = src.indexOf("splitNoteLines(cancelNote)");
    const fixedIdx = src.indexOf("cancelUrl ? (");
    expect(noteIdx, "cancelNote の分岐が無い").toBeGreaterThan(-1);
    expect(fixedIdx, "従来の固定文の分岐が消えている（空欄の店の見た目が変わってしまう）").toBeGreaterThan(-1);
    expect(noteIdx, "cancelNote の分岐が固定文より後にある（設定しても固定文が勝ってしまう）").toBeLessThan(fixedIdx);
  });

  it("🔴 cancelNote の分岐に mailto リンクを足していない", () => {
    for (const p of [CONFIRMATION, REMINDER]) {
      const src = read(p);
      // cancelNote 分岐の中身（`) : cancelUrl ? (` まで）に mailto が無いこと
      const start = src.indexOf("splitNoteLines(cancelNote).length > 0 ? (");
      const end = src.indexOf(": cancelUrl ? (", start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(src.slice(start, end), `${p}: 文章だけを出す決定に反している`).not.toContain("mailto");
    }
  });

  it("自由入力は SafeText（エンティティ化）で描画している", () => {
    for (const p of [CONFIRMATION, REMINDER]) {
      expect(read(p)).toMatch(/splitNoteLines\(cancelNote\)\.map\(\(line, i\) => \(\s*<SafeText/);
    }
  });
});

describe("送信元（Edge Function）", () => {
  it("確認メール（trial-book）が列を読んで渡している", () => {
    const src = read(TRIAL_BOOK);
    expect(src).toMatch(/\.select\("[^"]*trial_email_cancel_note[^"]*"\)/);
    expect(src).toContain("cancelNote,");
  });

  it("リマインド（send-trial-reminders）が同じ列を読んで渡している", () => {
    const src = read(REMINDERS_FN);
    expect(src).toMatch(/\.select\('[^']*trial_email_cancel_note[^']*'\)/);
    expect(src).toMatch(/cancelNote: \(\(tenant\?\.trial_email_cancel_note/);
  });

  it("どちらも空/未設定を null に倒している（列がまだ無い環境でも安全）", () => {
    for (const p of [TRIAL_BOOK, REMINDERS_FN]) {
      expect(read(p)).toMatch(/trial_email_cancel_note as string \| null \| undefined\) \?\? ['"]{2}\)\.trim\(\) \|\| null/);
    }
  });
});

describe("読み取りの配線（tenantColumns）", () => {
  it("select グループと既定値の両方に登録されている", () => {
    // 片方だけだと「設定画面には出るのに読めない」ズレになる（tenantColumns.ts 冒頭参照）
    expect(TENANT_OPTIONAL_COL_GROUPS.some((g) => g.includes("trial_email_cancel_note"))).toBe(true);
    expect(TENANT_VALUE_DEFAULTS).toHaveProperty("trial_email_cancel_note", null);
  });
});

describe("設定画面", () => {
  const src = read(SETTINGS);

  it("体験カテゴリーに配線されている（カードだけ在って未配置を防ぐ）", () => {
    const parent = read("src/components/trainer/TrainerGymSettings.tsx");
    expect(parent).toContain("<TrialCancelNoteCard />");
    expect(parent).toContain('t("settings.trainer.trialCancelNoteSection")');
  });

  it("空欄を NULL に正規化して保存している（空文字を入れない）", () => {
    expect(src).toMatch(/trial_email_cancel_note: normalizeEmailNote\(note\)/);
  });

  it("入力欄の上限が DB の CHECK と同じ定数", () => {
    const block = src.slice(src.indexOf('id="trial-cancel-note"'), src.indexOf('id="trial-cancel-note"') + 600);
    expect(block).toContain("maxLength={EMAIL_NOTE_MAX_LENGTH}");
  });
});

describe("i18n（5言語）", () => {
  const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"];
  const KEYS = [
    "trialCancelNoteSection", "trialCancelNoteDesc", "trialCancelNoteLabel",
    "trialCancelNotePlaceholder", "trialCancelNoteUnset", "trialCancelNoteSaved", "trialCancelNoteSaveFailed",
  ];

  it.each(LOCALES)("%s にキーが揃っている", (loc) => {
    const trainer = JSON.parse(read(`src/locales/${loc}.json`)).settings.trainer;
    for (const k of KEYS) expect(trainer[k], `${loc}: ${k} が無い`).toBeTruthy();
  });
});
