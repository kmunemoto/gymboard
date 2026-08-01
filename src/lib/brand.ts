/**
 * この製品（＝このリポジトリから出荷する1つのアプリ）の固有情報。
 *
 * **兄弟アプリ（業種特化版）を作るときに差し替えるのは、原則このファイルだけ。**
 * ピラボード・セッコツボード・パーソナルストレッチ版などは GymBoard のフォークとして
 * 作られ、`git merge upstream/main` で上流の修正を取り込み続ける。そのとき、
 * ブランド名やドメインが各ファイルに散っていると毎回コンフリクトするため、
 * 「フォークごとに違う値」をここ1箇所に集めている。
 *
 * 手順の全体像は `mem/ops/vertical-fork.md` を参照。
 *
 * ## ここに入れてよいもの / いけないもの
 * - ○ 製品ごとに必ず違う値（製品名・URLスキーム・本番ドメイン・問い合わせ先）
 * - × 店ごとに違う値 … `tenants` の列にする（営業時間・ロゴ・テーマ色など）。
 *     ここに入れると「全店同じ」を固定してしまう。
 * - × 秘密情報 … このファイルはリポジトリにコミットされる。
 *     Stripe の秘密鍵・サービスアカウントJSON等は環境変数／Supabase Secrets へ。
 */

/**
 * 製品名の3つの表記。
 *
 * ロケールJSONからは `{{brandJa}}` / `{{brandEn}}` / `{{brandApp}}` として参照する
 * （i18n.ts の `interpolation.defaultVariables` で注入）。
 * こうすることで `src/locales/*.json` に製品名の文字列が一切入らなくなり、
 * **フォーク間でロケールファイルがバイト一致する**＝マージが衝突しない。
 *
 * 変数を言語別ではなく表記別にしているのは、`defaultVariables` が言語をまたいで
 * 共通のため。「日本語表記を使うか英字表記を使うか」は各ロケールJSON側が
 * どちらの変数を書くかで選ぶ（例: ja.json は `{{brandJa}}`、en.json は `{{brandEn}}`。
 * 法務ページのように全言語で日本語表記のままにしたい箇所は全ロケールで `{{brandJa}}`）。
 */
export const BRAND = {
  /** 日本語表記。日本語UI・法務ページで使う */
  ja: "ジムボード",
  /** 英字表記。他言語UI・ロゴ的な文脈で使う */
  en: "GymBoard",
  /** 小文字の識別子。法務ページの「〜アプリ」表記で使う */
  app: "gymboard",
} as const;

/**
 * ネイティブアプリの URL スキーム（`capacitor.config.ts` の appId と必ず一致させる）。
 * メール確認・OAuth からアプリに戻るディープリンクに使う。
 * **不一致でもビルドもテストも通ってしまい、実機でだけ戻ってこられなくなる**ので注意。
 */
export const NATIVE_APP_SCHEME = "app.gymboard.mobile:";

/**
 * 本番の Web ドメイン。
 * ネイティブアプリ内では `window.location.origin` が `capacitor://localhost` になり、
 * 招待リンク・体験予約リンクなど「コピーして他人に共有するリンク」が開けなくなるため、
 * ネイティブ時はここへフォールバックする。
 */
export const PRODUCTION_WEB_ORIGIN = "https://app.kyoto-salute.com";

/**
 * Stripe を live（実課金）で動かすホスト。ここに無いホストは sandbox 扱いになる。
 * **新しいドメインを足し忘れると、画面上は決済成功に見えて実際には課金されない。**
 */
export const STRIPE_LIVE_HOSTS: readonly string[] = [
  "gymboard.lovable.app",
  "app.kyoto-salute.com",
];

/** マーケティングサイト（LP）のURL */
export const MARKETING_SITE_URL = "https://gymboard-app.lovable.app";

/** SNSシェア画像・公開ページに出す控えめなブランド表記 */
export const POWERED_BY_LABEL = `Powered by ${BRAND.en}`;

/**
 * サービス運営者への問い合わせ先。
 * **各ジムの連絡先（`tenants.email`）とは別物**。お客様がジムに連絡する導線には
 * 必ず `tenants.email` を使うこと（体験予約の確認メール等）。
 */
export const SUPPORT_EMAIL = "k.munemoto@kyoto-salute.com";

/**
 * 予約に紐づくジム名が取れなかったときの表示上のフォールバック。
 * （Googleカレンダーの予定名・ジム名解決の失敗時など）
 */
export const BRAND_FALLBACK_GYM_NAME = BRAND.ja;
