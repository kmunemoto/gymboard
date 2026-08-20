import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ANSWER_MAX_LENGTH,
  MAX_QUESTIONS_PER_TENANT,
  MAX_QUESTION_OPTIONS,
  QUESTION_HELP_MAX,
  QUESTION_INPUT_TYPES,
  QUESTION_LABEL_MAX,
  buildAnswerSnapshot,
  missingRequiredQuestions,
  normalizeAnswerValue,
  parseAnswerSnapshot,
  questionsForSurface,
  resolveInputType,
  type BookingQuestion,
} from "@/lib/bookingQuestions";

// 予約時のカスタム質問（事前アンケート）。
//
// このテストが守る不変条件:
//   1. 🔴 回答は**参照ではなくスナップショット**（質問を消しても過去の回答が読める）
//   2. 会員専用の質問が公開ページ（体験・ドロップイン）に漏れない
//   3. 必須項目はクライアントが止める（DB は必須を強制しない）
//   4. 未ログインから来た回答をそのまま信用しない（Edge Function で削る）
//
// 変異検証（2026-08-20、6件すべて赤を確認）:
//   - buildAnswerSnapshot が label を落として question_id だけ残す → 「スナップショット」が赤
//   - questionsForSurface の member/trial の分岐を反転 → 「漏れない」2件が赤
//   - missingRequiredQuestions の required 判定を外す → 「必須」が赤
//   - normalizeAnswerValue の slice を外す → 「長さを切る」が赤
//   - Edge Function の sanitize を素通しに → 「そのまま信用しない」が赤
//   - RPC の ask_on_trial 条件を外す → 「会員専用が公開ページに出ない」が赤

const q = (over: Partial<BookingQuestion> = {}): BookingQuestion => ({
  id: "q1",
  label: "本日の体調",
  help_text: null,
  input_type: "text",
  options: null,
  required: false,
  sort_order: 0,
  is_active: true,
  ask_on_member: true,
  ask_on_trial: false,
  ...over,
});

describe("resolveInputType", () => {
  it("既知の種類はそのまま", () => {
    for (const t of QUESTION_INPUT_TYPES) expect(resolveInputType(t)).toBe(t);
  });

  it("未知の値は text に倒す（画面を壊さない）", () => {
    for (const bad of ["radio", "", null, undefined, 3, {}]) {
      expect(resolveInputType(bad)).toBe("text");
    }
  });
});

describe("questionsForSurface（どの画面で聞くか）", () => {
  const list = [
    q({ id: "m", label: "会員だけ", ask_on_member: true, ask_on_trial: false, sort_order: 2 }),
    q({ id: "t", label: "体験だけ", ask_on_member: false, ask_on_trial: true, sort_order: 1 }),
    q({ id: "b", label: "両方", ask_on_member: true, ask_on_trial: true, sort_order: 0 }),
    q({ id: "off", label: "停止中", ask_on_member: true, ask_on_trial: true, is_active: false }),
    q({ id: "draft", label: "下書き", ask_on_member: false, ask_on_trial: false }),
  ];

  it("🔴 会員専用の質問が体験予約に漏れない", () => {
    expect(questionsForSurface(list, "trial").map((x) => x.id)).toEqual(["b", "t"]);
  });

  it("🔴 体験専用の質問が会員の予約に漏れない", () => {
    expect(questionsForSurface(list, "member").map((x) => x.id)).toEqual(["b", "m"]);
  });

  it("停止中・どこでも聞かない質問は出ない", () => {
    for (const s of ["member", "trial"] as const) {
      const ids = questionsForSurface(list, s).map((x) => x.id);
      expect(ids).not.toContain("off");
      expect(ids).not.toContain("draft");
    }
  });

  it("表示順で並ぶ（同順なら id で安定）", () => {
    const same = [q({ id: "b2", sort_order: 5 }), q({ id: "a1", sort_order: 5 })];
    expect(questionsForSurface(same, "member").map((x) => x.id)).toEqual(["a1", "b2"]);
  });

  it("null/undefined でも落ちない", () => {
    expect(questionsForSurface(null, "member")).toEqual([]);
    expect(questionsForSurface(undefined, "trial")).toEqual([]);
  });

  it("元の配列を書き換えない", () => {
    const src = [q({ id: "z", sort_order: 9 }), q({ id: "a", sort_order: 1 })];
    const before = src.map((x) => x.id);
    questionsForSurface(src, "member");
    expect(src.map((x) => x.id)).toEqual(before);
  });
});

describe("normalizeAnswerValue", () => {
  it("前後の空白を落とす", () => {
    expect(normalizeAnswerValue("  チェック済み  ")).toBe("チェック済み");
    expect(normalizeAnswerValue("   ")).toBe("");
  });

  it("🔴 長すぎる回答は切る（一覧とメールが壊れない）", () => {
    const long = "あ".repeat(ANSWER_MAX_LENGTH + 50);
    expect(normalizeAnswerValue(long)).toHaveLength(ANSWER_MAX_LENGTH);
  });

  it("文字列以外は空", () => {
    for (const bad of [null, undefined, 3, {}, []]) expect(normalizeAnswerValue(bad)).toBe("");
  });
});

describe("missingRequiredQuestions", () => {
  it("🔴 必須が空なら止める", () => {
    const qs = [q({ id: "a", required: true }), q({ id: "b", required: false })];
    expect(missingRequiredQuestions(qs, {}).map((x) => x.id)).toEqual(["a"]);
    expect(missingRequiredQuestions(qs, { a: "   " }).map((x) => x.id)).toEqual(["a"]);
    expect(missingRequiredQuestions(qs, { a: "回答あり" })).toEqual([]);
  });

  it("必須でない項目は空でも通る", () => {
    expect(missingRequiredQuestions([q({ required: false })], {})).toEqual([]);
  });

  it("必須のチェックボックスはチェックしないと通らない（同意欄に使える）", () => {
    // チェック時に入る値は i18n（bookingQuestions.checked）から来るが、この関数は
    // 「空かどうか」しか見ない。**ここでは実際の文言を書かない**
    // （書くと ja.json の値と重なり、フォークがオーバーレイした瞬間に落ちる。
    //  src/test/forkHostileTests.test.ts の指摘どおり）。
    const CHECKED = "チェック済み";
    const qs = [q({ id: "agree", input_type: "checkbox", required: true })];
    expect(missingRequiredQuestions(qs, { agree: "" })).toHaveLength(1);
    expect(missingRequiredQuestions(qs, { agree: CHECKED })).toHaveLength(0);
  });
});

describe("🔴 buildAnswerSnapshot（参照ではなく文言ごと焼き付ける）", () => {
  it("聞いた文言が回答と一緒に残る", () => {
    // 参照だけにすると、店が質問を消した瞬間に「はい」だけが残って
    // 何に対する「はい」か分からなくなる。
    const qs = [q({ id: "q1", label: "本日の体調" })];
    expect(buildAnswerSnapshot(qs, { q1: "良い" })).toEqual([
      { question_id: "q1", label: "本日の体調", value: "良い" },
    ]);
  });

  it("空の回答は入れない（任意項目を飛ばした予約が空文字で埋まらない）", () => {
    const qs = [q({ id: "a" }), q({ id: "b" })];
    expect(buildAnswerSnapshot(qs, { a: "回答あり", b: "  " })).toEqual([
      { question_id: "a", label: "本日の体調", value: "回答あり" },
    ]);
    expect(buildAnswerSnapshot(qs, {})).toEqual([]);
  });
});

describe("parseAnswerSnapshot（DB に何が入っていても画面を落とさない）", () => {
  it("正しい形はそのまま読める", () => {
    expect(parseAnswerSnapshot([{ question_id: "q1", label: "体調", value: "良い" }])).toEqual([
      { question_id: "q1", label: "体調", value: "良い" },
    ]);
  });

  it("壊れた行は捨てる", () => {
    const raw = [
      { label: "体調", value: "良い" }, // question_id 欠け → 空文字で通す
      { label: "", value: "x" }, // 文言なし → 捨てる
      { label: "y", value: "" }, // 回答なし → 捨てる
      "文字列",
      null,
      42,
    ];
    expect(parseAnswerSnapshot(raw)).toEqual([{ question_id: "", label: "体調", value: "良い" }]);
  });

  it("配列でなければ空", () => {
    for (const bad of [null, undefined, {}, "x", 3]) expect(parseAnswerSnapshot(bad)).toEqual([]);
  });
});

describe("🔴 DB とクライアントの制限値が一致している", () => {
  const dir = "supabase/migrations";
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .filter((s) => /booking_questions/.test(s))
    .join("\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("マイグレーションが実在する（空振りしていない）", () => {
    expect(sql.length).toBeGreaterThan(500);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.booking_questions/);
  });

  it("入力欄の種類が両方で同じ", () => {
    // 片方だけ増やすと、保存できない種類が設定画面に出る。
    for (const t of QUESTION_INPUT_TYPES) {
      expect(sql, `${t} が DB の CHECK にありません`).toMatch(new RegExp(`'${t}'`));
    }
    const m = /input_type IN \(([^)]+)\)/.exec(sql);
    expect(m, "input_type の CHECK が見つかりません").toBeTruthy();
    const dbTypes = m![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    expect(dbTypes).toEqual([...QUESTION_INPUT_TYPES].sort());
  });

  it("長さの上限が両方で同じ", () => {
    expect(QUESTION_LABEL_MAX).toBe(120);
    expect(QUESTION_HELP_MAX).toBe(200);
    expect(MAX_QUESTION_OPTIONS).toBe(20);
    expect(sql).toMatch(/char_length\(btrim\(label\)\) BETWEEN 1 AND 120/);
    expect(sql).toMatch(/char_length\(help_text\) <= 200/);
    expect(sql).toMatch(/jsonb_array_length\(options\) <= 20/);
  });

  it("回答の大きさを DB でも縛っている", () => {
    // お客様は bookings の任意の列を書ける。巨大な jsonb を入れられると
    // 予定表の読み込みが丸ごと重くなる。
    expect(sql).toMatch(/bookings_custom_answers_shape/);
    expect(sql).toMatch(/trial_bookings_custom_answers_shape/);
    expect(sql).toMatch(/jsonb_typeof\(custom_answers\) = 'array'/);
    expect(sql).toMatch(new RegExp(`jsonb_array_length\\(custom_answers\\) <= ${MAX_QUESTIONS_PER_TENANT}`));
  });

  it("🔴 公開ページ用の RPC は体験用の質問だけを返す", () => {
    // ask_on_trial を外すと、会員専用の質問が未ログインの人に見えてしまう。
    const fn = sql.slice(sql.indexOf("FUNCTION public.get_tenant_booking_questions"));
    expect(fn).toMatch(/AND q\.is_active/);
    expect(fn).toMatch(/AND q\.ask_on_trial/);
    expect(fn).toMatch(/t\.status IN \('active', 'trial'\)/);
    expect(fn).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_booking_questions\(uuid\) TO anon/);
  });

  it("テーブル自体には anon の口を開けていない", () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.booking_questions FROM anon/);
    expect(sql).toMatch(/CREATE POLICY tenant_isolation ON public\.booking_questions AS RESTRICTIVE/);
  });

  it("ジムを閉じるときに消える", () => {
    const all = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    expect(all).toMatch(/DELETE FROM public\.booking_questions\s+WHERE tenant_id = v_tenant_id/);
  });

  it("types.ts に載っている", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    expect(types).toMatch(/\n {6}booking_questions: \{/);
    expect(types).toMatch(/get_tenant_booking_questions: \{/);
    for (const t of ["bookings", "trial_bookings"]) {
      const block = types.slice(types.indexOf(`\n      ${t}: {`), types.indexOf(`\n      ${t}: {`) + 1200);
      expect(block, `${t}.custom_answers が types.ts にありません`).toMatch(/custom_answers: Json \| null/);
    }
  });
});

describe("🔴 未ログインから来た回答をそのまま信用しない", () => {
  for (const f of ["supabase/functions/trial-book/index.ts", "supabase/functions/drop-in-book/index.ts"]) {
    it(`${f} が回答を削ってから保存する`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/function sanitizeCustomAnswers\(/);
      // 件数・長さを実際に削っていること
      expect(src).toMatch(/raw\.slice\(0, 10\)/);
      expect(src).toMatch(new RegExp(`slice\\(0, ${ANSWER_MAX_LENGTH}\\)`));
      // body の値を直接 insert に渡していないこと
      expect(src).not.toMatch(/custom_answers: body\.custom_answers/);
      expect(src).toMatch(/custom_answers: customAnswers/);
    });
  }
});

describe("🔴 画面が質問を出している", () => {
  it("会員の予約・体験・ドロップイン・代理予約の4画面に同じ入力欄が出る", () => {
    for (const f of [
      "src/components/customer/CustomerBooking.tsx",
      "src/components/trainer/TrainerSchedule.tsx",
      "src/pages/TrialBooking.tsx",
      "src/pages/DropInBooking.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} が入力欄を出していません`).toMatch(/<BookingQuestionFields/);
      expect(src, `${f} が必須チェックをしていません`).toMatch(/missingRequiredQuestions\(/);
      expect(src, `${f} が回答を保存していません`).toMatch(/buildAnswerSnapshot\(/);
    }
  });

  it("店側が回答を読める", () => {
    const src = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
    expect(src).toMatch(/bookingQuestions\.answersTitle/);
    expect(src).toMatch(/booking\.customAnswers/);
  });

  it("🔴 予約が成立したら回答を消す（2件目に持ち越さない）", () => {
    // 「本日の体調」のような質問は予約ごとに聞き直す前提。残すと2件目に
    // **前回の回答が黙って付いてくる**（店は今日の回答だと思って読む）。
    for (const f of [
      "src/components/customer/CustomerBooking.tsx",
      "src/pages/TrialBooking.tsx",
      "src/pages/DropInBooking.tsx",
    ]) {
      expect(readFileSync(f, "utf8"), `${f} が回答を消していません`).toMatch(/setAnswers\(\{\}\)/);
    }
    // 代理予約はダイアログを閉じるときに消す
    expect(readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8")).toMatch(
      /setProxyAnswers\(\{\}\)/,
    );
  });

  it("質問が読めないときは空配列＝聞かずに予約させる", () => {
    const hook = readFileSync("src/hooks/useBookingQuestions.ts", "utf8");
    expect(hook).toMatch(/if \(error \|\| !data\) \{\s*setQuestions\(\[\]\);/);
  });
});
