/**
 * 予約時のカスタム質問（事前アンケート）。`booking_questions` の解釈を1箇所に集める。
 *
 * ## 何のためか（2026-08-20）
 *
 * カウンセリング（`counseling_responses`）は項目がコードに固定されていて、
 * 入会時にしか使えない。エアリザーブの「アンケート」に当たる
 * 「**店が自分で質問を作って、予約のときに聞く**」がジムボードには無かった。
 * 業種で聞きたいことは違う（ジム=目標/既往歴、整骨=痛む部位、ピラティス=経験）ので、
 * **コードではなく店ごとの設定として持つ**のが正しい置き場所になる。
 *
 * ## 🔴 回答は「スナップショット」で保存する
 *
 * 回答は質問テーブルへの参照ではなく、**そのとき聞いた文言ごと**
 * `bookings.custom_answers` / `trial_bookings.custom_answers`（jsonb）に焼き付ける。
 *
 * ```json
 * [{ "question_id": "…", "label": "本日の体調", "value": "良い" }]
 * ```
 *
 * 店が後から質問文を直したり質問を消したりしても、**過去の回答は「実際に聞かれた質問」
 * のまま残る**。参照にすると、質問を消した瞬間に過去の回答が意味不明になる
 * （「はい」とだけ残って何に対する「はい」か分からない）。
 * 予約の付随データという性質上、正しさより「後から読める」ほうが価値が高い。
 *
 * ## 聞く場所
 *
 * | `ask_on_member` | お客様の予約（CustomerBooking）・店側の代理予約 |
 * | `ask_on_trial`  | 体験予約（/trial）・ドロップイン（/drop-in） |
 *
 * 両方 false の質問は**どこにも出ない**（下書き扱い）。`is_active = false` も同じ。
 */

/** 入力欄の種類。増やすときは UI と DB の CHECK 制約の両方を直すこと。 */
export const QUESTION_INPUT_TYPES = ["text", "textarea", "select", "checkbox"] as const;
export type QuestionInputType = (typeof QUESTION_INPUT_TYPES)[number];

/** 質問文の最大長。DB 側の CHECK と同じ値にすること（テストが一致を見張る）。 */
export const QUESTION_LABEL_MAX = 120;
/** 補足説明の最大長。 */
export const QUESTION_HELP_MAX = 200;
/** 回答の最大長。長文を書かれてもメール・一覧が壊れない範囲。 */
export const ANSWER_MAX_LENGTH = 500;
/** 1テナントが持てる質問の数。多すぎると予約完了率が落ちるので上限を置く。 */
export const MAX_QUESTIONS_PER_TENANT = 10;
/** 選択肢（select）の最大数。 */
export const MAX_QUESTION_OPTIONS = 20;

export interface BookingQuestion {
  id: string;
  label: string;
  help_text: string | null;
  input_type: string;
  /** `select` のときの選択肢。それ以外では無視される。 */
  options: string[] | null;
  required: boolean;
  sort_order: number;
  is_active: boolean;
  ask_on_member: boolean;
  ask_on_trial: boolean;
}

/** 保存される回答1件。**質問文ごと焼き付ける**（上の設計メモ参照）。 */
export interface BookingAnswer {
  question_id: string;
  label: string;
  value: string;
}

/** 質問を出す画面。 */
export type QuestionSurface = "member" | "trial";

/** 入力欄の種類として解釈できる値か。未知の値は `text` として扱う（画面を壊さない）。 */
export const resolveInputType = (raw: unknown): QuestionInputType =>
  (QUESTION_INPUT_TYPES as readonly string[]).includes(raw as string)
    ? (raw as QuestionInputType)
    : "text";

/** その画面で実際に聞く質問だけを、表示順に並べて返す。 */
export const questionsForSurface = (
  questions: ReadonlyArray<BookingQuestion> | null | undefined,
  surface: QuestionSurface,
): BookingQuestion[] =>
  (questions ?? [])
    .filter((q) => q.is_active && (surface === "member" ? q.ask_on_member : q.ask_on_trial))
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));

/** 回答を1件ぶん整える（前後の空白を落とし、長すぎれば切る）。 */
export const normalizeAnswerValue = (raw: unknown): string => {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, ANSWER_MAX_LENGTH);
};

/**
 * 必須なのに空の質問を返す（画面のエラー表示用）。空配列なら送信してよい。
 *
 * `checkbox` は「チェックが入っている＝`"はい"`」で保存するので、
 * 必須のチェックボックスは**チェックしないと通らない**（同意欄に使える）。
 */
export const missingRequiredQuestions = (
  questions: ReadonlyArray<BookingQuestion>,
  values: Readonly<Record<string, string>>,
): BookingQuestion[] =>
  questions.filter((q) => q.required && normalizeAnswerValue(values[q.id]) === "");

/**
 * 保存用のスナップショットを作る。**空の回答は入れない**
 * （任意項目を飛ばした予約に空文字が並ぶと、店側の一覧が読みにくくなる）。
 */
export const buildAnswerSnapshot = (
  questions: ReadonlyArray<BookingQuestion>,
  values: Readonly<Record<string, string>>,
): BookingAnswer[] => {
  const out: BookingAnswer[] = [];
  for (const q of questions) {
    const value = normalizeAnswerValue(values[q.id]);
    if (!value) continue;
    out.push({ question_id: q.id, label: q.label, value });
  }
  return out;
};

/**
 * 保存済みの回答（jsonb）を安全に読み出す。
 *
 * DB に何が入っていても画面を落とさないのが目的。形が違う行は捨てる。
 */
export const parseAnswerSnapshot = (raw: unknown): BookingAnswer[] => {
  if (!Array.isArray(raw)) return [];
  const out: BookingAnswer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label.trim() : "";
    const value = typeof rec.value === "string" ? rec.value.trim() : "";
    if (!label || !value) continue;
    out.push({
      question_id: typeof rec.question_id === "string" ? rec.question_id : "",
      label,
      value,
    });
  }
  return out;
};
