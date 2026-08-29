import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_NOTE_MAX_LENGTH, normalizeEmailNote } from "@/lib/emailNotes";

// 確認メール・リマインドメールに足す、店ごとの一文
// （tenants.booking_email_note / reminder_email_note）。
//
// **店の自由入力がメール本文に入る初めての経路**なので、逃げ道を作らないための検査。
//
// このテストが守る不変条件:
//   1. 空/未設定なら**ブロックごと出さない**（既定文は持たない）
//   2. 本文は必ずエスケープ→エンティティ化を通る（& を最初に処理する順序も含む）
//   3. 🔴 本文に文字を挿入しない（2026-08-18 の「キ??ンセル」は自分で入れた
//      HTML コメントが原因だった。同じ機構を二度と持ち込まない）
//   4. 5枚のテンプレートすべてに出る（1枚忘れると「あの店だけ案内が出ない」になる）
//
// 変異検証（2026-08-20、5件すべて赤を確認）:
//   - normalizeEmailNote が空文字を "" のまま返す → 「空は null」が赤
//   - gym-note.tsx の toHtmlEntities から & の分岐を削る → 「& を最初に」が赤
//   - GymNoteSection の早期 return を消す → 「空なら描かない」が赤
//   - テンプレート1枚から <GymNoteSection> を消す → 「5枚すべて」が赤
//   - 送信側の1本から gymNote を落とす → 「5つの送信元」が赤

const TEMPLATE_DIR = "supabase/functions/_shared/transactional-email-templates";

/** gymNote を出す5枚 */
const TEMPLATES = [
  "booking-confirmation.tsx",
  "booking-reminder.tsx",
  "trial-booking-confirmation.tsx",
  "trial-booking-reminder.tsx",
  "drop-in-booking-confirmation.tsx",
];

/** gymNote を渡す5つの送信元 */
// 予約確認はサーバー側送信へ移行済み（2026-08-21。bookings の AFTER INSERT →
// notify-new-booking。端末発の bookingNotification.ts は削除された）。
const SENDERS: Array<[string, string]> = [
  ["supabase/functions/notify-new-booking/index.ts", "booking-confirmation"],
  ["supabase/functions/push-booking-reminder/index.ts", "booking-reminder"],
  ["supabase/functions/trial-book/index.ts", "trial-booking-confirmation"],
  ["supabase/functions/send-trial-reminders/index.ts", "trial-booking-reminder"],
  ["supabase/functions/drop-in-book/index.ts", "drop-in-booking-confirmation"],
];

describe("normalizeEmailNote", () => {
  it("🔴 空欄は null（ブロックごと出さない）", () => {
    // "" のまま保存すると、DB では「設定済みで空」になり、
    // 将来「未設定なら既定文を出す」を足したときに区別できなくなる。
    expect(normalizeEmailNote("")).toBeNull();
    expect(normalizeEmailNote("   ")).toBeNull();
    expect(normalizeEmailNote("\n\n")).toBeNull();
    expect(normalizeEmailNote(null)).toBeNull();
    expect(normalizeEmailNote(undefined)).toBeNull();
  });

  it("前後の空白を落として保存する", () => {
    expect(normalizeEmailNote("  5分前にお越しください  ")).toBe("5分前にお越しください");
  });

  it("長すぎる文は切る（DB の CHECK に当たって保存が落ちない）", () => {
    const long = "あ".repeat(EMAIL_NOTE_MAX_LENGTH + 100);
    expect(normalizeEmailNote(long)).toHaveLength(EMAIL_NOTE_MAX_LENGTH);
  });

  it("上限が 500 で固定されている", () => {
    // 定数同士で比べると同語反復。実値で固定する。
    expect(EMAIL_NOTE_MAX_LENGTH).toBe(500);
  });
});

describe("🔴 共通部品が本文を安全に描いている", () => {
  const src = readFileSync(join(TEMPLATE_DIR, "gym-note.tsx"), "utf8");
  /** 設計コメントを落として実コードだけを見る（コメントが説明のために書いた
   *  `<br>` や `<!--` を本文への挿入と誤検出しないため）。 */
  const codeOnly = () =>
    src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");

  it("空なら Section ごと描かない", () => {
    expect(src).toMatch(/if \(lines\.length === 0\) return null/);
  });

  it("エスケープの順序が正しい（& が最初）", () => {
    // & を後回しにすると、先に作った &lt; の & まで &amp;lt; に壊れる。
    const body = src.slice(src.indexOf("const toHtmlEntities"));
    const amp = body.indexOf("'&amp;'");
    const lt = body.indexOf("'&lt;'");
    expect(amp).toBeGreaterThan(-1);
    expect(lt).toBeGreaterThan(-1);
    expect(amp, "& の分岐が < より後ろにあります").toBeLessThan(lt);
  });

  it("非ASCII をすべてエンティティにする", () => {
    expect(src).toMatch(/cp > 0x7f \? `&#\$\{cp\};` : ch/);
  });

  it("🔴 本文に文字を挿入していない（2026-08-18 の再発防止）", () => {
    // 折り返しのつもりで入れた HTML コメントが、メールクライアントに
    // `??` として描画された（「キ??ンセル」）。同じ機構を持ち込まない。
    const code = codeOnly();
    expect(code, "本文に HTML コメントを挿入しています").not.toMatch(/["'`]<!--/);
    expect(code, "本文に \\u200b などの不可視文字を挿入しています").not.toMatch(/\\u200[b-d]/);
  });

  it("改行は行ごとの <Text> にする（店の文字から <br> を作らない）", () => {
    expect(src).toMatch(/split\(\/\\r\?\\n\/\)/);
    expect(codeOnly(), "店の自由入力から <br> を作っています").not.toMatch(/<br\s*\/?>/);
  });

  it("コメント除去が効いている（空振り検知）", () => {
    // codeOnly() が全部落としてしまうと、上の2件が常に緑になる。
    expect(codeOnly()).toMatch(/export const GymNoteSection/);
    expect(codeOnly().length).toBeLessThan(src.length);
  });
});

describe("🔴 5枚のテンプレートすべてに出る", () => {
  for (const f of TEMPLATES) {
    it(`${f} が gymNote を描いている`, () => {
      const src = readFileSync(join(TEMPLATE_DIR, f), "utf8");
      // 体験2枚は splitNoteLines（キャンセル案内の行分割）も同じファイルから import する
      expect(src).toMatch(/import \{ [^}]*GymNoteSection[^}]*\} from '\.\/gym-note\.tsx'/);
      expect(src).toMatch(/gymNote\?: string \| null/);
      expect(src).toMatch(/<GymNoteSection note=\{gymNote\}/);
      // 既定は null＝渡されなければ何も出ない（既存の店のメールが変わらない）
      expect(src).toMatch(/gymNote = null,/);
      // プレビュー画面でも空にならないよう previewData に値がある
      expect(src).toMatch(/gymNote: '/);
    });
  }

  it("走査対象が実在する（空振りしていない）", () => {
    for (const f of TEMPLATES) {
      expect(readFileSync(join(TEMPLATE_DIR, f), "utf8").length).toBeGreaterThan(1000);
    }
  });
});

describe("🔴 5つの送信元すべてが値を渡している", () => {
  for (const [file, template] of SENDERS) {
    it(`${file} が ${template} に gymNote を渡す`, () => {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} が ${template} を送っていません`).toContain(template);
      expect(src, `${file} が gymNote を渡していません`).toMatch(/gymNote/);
    });
  }

  it("サーバー側は tenants から列を読んでいる", () => {
    // 列を select に足し忘れると undefined になり、静かに何も出なくなる。
    expect(readFileSync("supabase/functions/trial-book/index.ts", "utf8")).toMatch(/booking_email_note/);
    expect(readFileSync("supabase/functions/drop-in-book/index.ts", "utf8")).toMatch(/booking_email_note/);
    expect(readFileSync("supabase/functions/send-trial-reminders/index.ts", "utf8")).toMatch(/reminder_email_note/);
    expect(readFileSync("supabase/functions/push-booking-reminder/index.ts", "utf8")).toMatch(/reminder_email_note/);
  });

  it("確認メールは booking_email_note、リマインドは reminder_email_note を使う", () => {
    // 取り違えると「予約したのに前日案内が届く」ことになる。
    const trial = readFileSync("supabase/functions/trial-book/index.ts", "utf8");
    expect(trial).toMatch(/booking_email_note/);
    expect(trial, "確認メールがリマインド用の列を読んでいます").not.toMatch(/reminder_email_note/);

    const reminder = readFileSync("supabase/functions/send-trial-reminders/index.ts", "utf8");
    expect(reminder).toMatch(/reminder_email_note/);
    expect(reminder, "リマインドが確認メール用の列を読んでいます").not.toMatch(/booking_email_note/);
  });
});

describe("DB と設定画面", () => {
  const dir = "supabase/migrations";
  const allSql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");

  it("列と長さの CHECK がある", () => {
    expect(allSql).toMatch(/ADD COLUMN IF NOT EXISTS booking_email_note\s+TEXT/);
    expect(allSql).toMatch(/ADD COLUMN IF NOT EXISTS reminder_email_note TEXT/);
    expect(allSql).toMatch(new RegExp(`char_length\\(booking_email_note\\) <= ${EMAIL_NOTE_MAX_LENGTH}`));
    expect(allSql).toMatch(new RegExp(`char_length\\(reminder_email_note\\) <= ${EMAIL_NOTE_MAX_LENGTH}`));
  });

  it("🔴 既定文を backfill していない", () => {
    expect(allSql).not.toMatch(/UPDATE public\.tenants[\s\S]{0,200}(booking|reminder)_email_note\s*=/);
  });

  it("設定画面が空欄を null で保存する", () => {
    const src = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");
    expect(src).toMatch(/booking_email_note: normalizeEmailNote\(bookingEmailNote\)/);
    expect(src).toMatch(/reminder_email_note: normalizeEmailNote\(reminderEmailNote\)/);
    expect(src).toMatch(/maxLength=\{EMAIL_NOTE_MAX_LENGTH\}/);
  });

  it("ログイン側のカラム取得と既定値に載っている", () => {
    const cols = readFileSync("src/lib/tenantColumns.ts", "utf8");
    expect(cols).toMatch(/booking_email_note, reminder_email_note/);
    expect(cols).toMatch(/booking_email_note: null/);
    expect(cols).toMatch(/reminder_email_note: null/);
  });
});
