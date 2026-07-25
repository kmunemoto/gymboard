/**
 * 本番ビルド用のスタブ。`vite.config.ts` の alias で、production のときだけ
 * `@/dev/fixtureClient` がこのファイルに差し替わる。
 *
 * 開発用ダミーデータ（架空のジム名・お客様名など）が本番バンドルに混入しないようにするため、
 * tree-shaking に頼らず物理的に置き換えている。実際、ダミーデータを作る処理が
 * モジュール読み込み時に走る形だと Rollup は副作用ありと判断して残してしまい、
 * 本番の JS に「デモ・フィットネススタジオ」等の文字列が入っていた。
 *
 * 本番では `import.meta.env.DEV` が false なので、この関数は決して呼ばれない。
 */
export function createFixtureClient(): never {
  throw new Error("createFixtureClient は開発用です（本番ビルドには含まれません）");
}
