// 食事の写真の分析（analyze-meal）に使う AI のモデルと、失敗したときの聞き直し（2026-11-09）。
//
// 宗本さん「アプリの食事管理の AI の精度、一番賢いまで上げて」。
//
// ■ どのモデルか
// - 主: google/gemini-4-argon
//   Lovable AI Gateway で使えるモデルの一覧（2026-11-09 に Lovable のエージェントが listModels で取得）で
//   Google の最上位（"Frontier Gemini model"・正式版・廃止予定なし）。今の呼び方（/v1/chat/completions・画像つき）のまま使える。
//   OpenAI の最上位（openai/gpt-6-astra）や Claude の最上位（anthropic/claude-fable-5-1。messages 専用で呼び方が違う）も
//   同じクラスだが、食事の写真でどれが一番かを比べた公表データは無い。比べるなら実際の写真で比べること。
// - 予備: google/gemini-3.8-flash（速い正式版）
//   主が失敗した・時間切れ・答えが JSON として読めない、ときだけ使う（分析そのものが止まらないように）。
// - 以前の google/gemini-2.5-flash は**廃止予定で、廃止日（2026-10-20）を過ぎている**ので、もう使わない。
//
// ■ やり直さないもの
// 429（混雑）・402（クレジット不足）はモデルを替えても同じなので、予備で聞き直さずにそのまま返す
// （呼ぶ側が今まで通りの案内を出す）。
//
// ■ 時間
// Edge Function は全体で約150秒まで。1段目（写真→料理）は主 50秒＋予備 25秒、2段目（栄養の計算）は主 40秒＋予備 25秒。
// 最悪でも 140秒で終わる（テストが合計を見張る）。
//
// import なし（src/test/mealAiModel.test.ts がそのまま読み込んで試す）。

export const MEAL_PRIMARY_MODEL = "google/gemini-4-argon";
export const MEAL_FALLBACK_MODEL = "google/gemini-3.8-flash";

export const MEAL_STAGE_TIMEOUTS = {
  /** 1段目（写真から料理を特定する） */
  dishes: { primary: 50_000, fallback: 25_000 },
  /** 2段目（栄養の計算とアドバイス） */
  nutrition: { primary: 40_000, fallback: 25_000 },
} as const;

/** AI を1回呼ぶ（モデル・時間切れまでのミリ秒）。答えの本文を返す。失敗は status つきの Error で投げる */
export type AiCaller = (model: string, timeoutMs: number) => Promise<string>;

/** モデルを替えても変わらない失敗（混雑・クレジット不足）。予備で聞き直さない */
export const isAccountLevelAiError = (e: unknown): boolean => {
  const status = (e as { status?: unknown } | null)?.status;
  return status === 429 || status === 402;
};

/**
 * 主のモデルで聞き、失敗（429・402 以外）・時間切れ・読めない答えなら、予備のモデルで1回だけ聞き直す。
 *
 * @param accept 答えの本文から結果を取り出す。取り出せなければ null（＝読めない答え）
 * @returns result は予備でも読めなければ null（呼ぶ側が「もう一度お試しください」を返す）。model はどちらが答えたか
 */
export const askWithFallback = async <T>(
  call: AiCaller,
  accept: (text: string) => T | null,
  timeouts: { primary: number; fallback: number },
  log: (message: string, detail?: unknown) => void = () => {},
): Promise<{ result: T | null; model: string; raw: string }> => {
  try {
    const text = await call(MEAL_PRIMARY_MODEL, timeouts.primary);
    const result = accept(text);
    if (result !== null) return { result, model: MEAL_PRIMARY_MODEL, raw: text };
    log(`${MEAL_PRIMARY_MODEL} の答えを読めませんでした。${MEAL_FALLBACK_MODEL} で聞き直します`, text.slice(0, 500));
  } catch (e) {
    if (isAccountLevelAiError(e)) throw e;
    log(`${MEAL_PRIMARY_MODEL} が失敗しました（時間切れを含む）。${MEAL_FALLBACK_MODEL} で聞き直します`, e);
  }
  const text = await call(MEAL_FALLBACK_MODEL, timeouts.fallback);
  return { result: accept(text), model: MEAL_FALLBACK_MODEL, raw: text };
};
