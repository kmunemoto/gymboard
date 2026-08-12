/**
 * 定型文の差し込み。
 *
 * 本文に `{{name}}` と書くと、送る相手の表示名に置き換わる。
 *
 * ## 名前が取れないときは「丸ごと消す」
 * 「{{name}}様、こんにちは」で名前が無いとき、素朴に空文字へ置換すると
 * **「様、こんにちは」**になる。お客様に送る文面としては事故。
 * 敬称や助詞ごと落としたいので、`{{name}}` に続く敬称・読点も一緒に消す。
 */

/** 差し込みに使えるキー。増やすときは replaceTemplateVars と管理UIの説明も一緒に。 */
export const TEMPLATE_VARS = ["name"] as const;

/** `{{name}}` の直後に付きがちな敬称と句読点。名前が無いときはここまで一緒に消す。 */
const HONORIFIC_TAIL = /^\s*(?:様|さん|さま|サン)?\s*[、,]?\s*/;

export interface TemplateContext {
  /** 送信先の表示名。未設定・取得できない場合は null */
  name?: string | null;
}

/**
 * 本文の差し込みを解決する。
 * 未知の `{{...}}` は**そのまま残す**（消すと、書いたつもりの文が黙って欠ける）。
 */
export function replaceTemplateVars(body: string, ctx: TemplateContext): string {
  const name = ctx.name?.trim();
  return body.replace(/\{\{name\}\}(.*)/g, (_m, rest: string) =>
    name ? `${name}${rest}` : rest.replace(HONORIFIC_TAIL, ""),
  );
}

/** 管理UIで使う、差し込みが入っているかの判定。 */
export function usesTemplateVars(body: string): boolean {
  return /\{\{name\}\}/.test(body);
}

/**
 * すでに入力欄に文字があるときに定型文を入れる。
 * 上書きすると書きかけが消えるので、**末尾に足す**（間に改行を1つ入れる）。
 */
export function appendTemplate(current: string, insertion: string): string {
  const base = current.replace(/\s+$/, "");
  if (!base) return insertion;
  return `${base}\n${insertion}`;
}
