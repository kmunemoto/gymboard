/**
 * 開発時だけ出るログ。
 *
 * `console.log` を直接書くと、お客様の名前・予約内容・トレーニング記録といった
 * 個人情報がブラウザのコンソールに出る。`vite.config.ts` の `pure` 指定により
 * **本番ビルドでは除去される**ものの、`build:dev` で作った検証ビルドや、
 * 誰かが `pure` の設定を外した瞬間にそのまま漏れる。
 *
 * 判定を `import.meta.env.DEV` として明示しておけば、ビルド設定に関わらず
 * 本番では出ないことがコードから読み取れる（かつ本番ビルドでは呼び出しごと畳まれる）。
 *
 * 使い分け:
 *   - `devLog`  : 動作確認のための一時的なログ。個人情報を含みうるものは必ずこちら
 *   - `console.warn` / `console.error` : 障害調査に必要なもの。本番でも残る
 *     （個人情報そのものではなく、IDやエラーメッセージを出す）
 */
export const devLog = (...args: unknown[]): void => {
  if (import.meta.env.DEV) console.log(...args);
};
