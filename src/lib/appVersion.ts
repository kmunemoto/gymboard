/**
 * アプリの版数を比べて、「更新のお願い」を出すかどうかを決める。
 *
 * 実店舗の要望（2026-09-07 宗本さん）:
 *
 * > 新しいバージョンをアップロードして、まだアップデートしていないお客様に
 * > アップデートしてもらえるように、こういう画面をアプリに出すようにしてほしい。
 * > それぞれボタンを押したら iOS / Android のアプリに各飛ぶように。
 *
 * ## 🔴 出すのは「お願い」だけ。閉じられないダイアログは作らない
 *
 * 設計を3つの観点で反証したところ、必須更新（閉じられないダイアログ）には
 * **潰しきれないブリック経路**があった:
 *
 *   - Play の段階公開・機種非対応・国別公開 … 更新したくてもできない層が必ず残る
 *   - OS の最低要件を満たさない端末 … **二度と更新できない**
 *   - 版数の入力ミス1つで全端末が同時に止まり、復旧は本番DBの書き換え待ち
 *
 * なので判定の答えに「必須」は無い。呼ぶ側は必ず閉じられる形で出すこと。
 *
 * ## 版数の形
 *
 * iOS は `CFBundleShortVersionString`（＝`MARKETING_VERSION`。例 `1.6.9`）、
 * Android は `versionName`（例 `9.5`）。**体系がまったく別**で、しかも
 * Android の versionName は任意の文字列を入れられる。
 *
 * ここで受け付けるのは `1〜4個の数字をドットで繋いだもの`だけ。
 * `1.7.0 (149)` / `v1.7.0` / `1.7.0-beta` / 空白混じり は**読めない**として扱い、
 * 呼ぶ側は何も出さない。読めないものを無理に数値化すると `NaN` が黙って
 * 勝敗を決めてしまう（これが実際にいちばん危ない）。
 *
 * ## 🔴 桁上がり（1.10.0 と 1.9.0）
 *
 * 文字列比較や `parseFloat` だと `1.10.0 < 1.9.0` になる。Android は既に 9.x まで
 * 来ているので `9.10` は遠くない。**必ず区切りごとに数として比べること。**
 */

/** 受け付ける版数の形。1〜4個の数字をドットで繋いだものだけ */
const VERSION_RE = /^\d{1,3}(?:\.\d{1,4}){0,3}$/;

/** 比較のために揃える桁数 */
const SEGMENTS = 4;

/**
 * 版数を数の配列にする。読めなければ null。
 * `1.7` は `[1,7,0,0]` として `1.7.0` と同じに扱う。
 */
export const parseVersion = (raw: string | null | undefined): number[] | null => {
  const s = (raw ?? "").trim();
  if (!VERSION_RE.test(s)) return null;
  const parts = s.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  while (parts.length < SEGMENTS) parts.push(0);
  return parts;
};

/**
 * 版数の大小。a > b なら正、a < b なら負、同じなら 0。
 * どちらかが読めなければ null（＝比べられない。呼ぶ側は何も出さない）。
 */
export const compareVersions = (
  a: string | null | undefined,
  b: string | null | undefined,
): number | null => {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < SEGMENTS; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
};

/**
 * 「最新版」がいまの版よりメジャーで何個以上離れていたら設定ミスとみなすか。
 *
 * 🔴 これは**行の取り違え**を止めるための床。iOS は 1.x、Android は 9.x と
 *    体系がまったく別なので、ios の行に Android の `9.5` を貼り間違えると
 *    全 iOS 利用者に「9.5 に更新してください」と出てしまう（そんな版は存在しない）。
 *    メジャーが2つ以上離れていたら、更新の案内ではなく設定ミスとして扱う。
 */
export const MAX_MAJOR_GAP = 1;

/** 判定の答え。理由まで返すのは、テストと調査で「なぜ出なかったか」を言えるようにするため */
export type UpdatePromptDecision =
  /** 新しい版が出ている。お願いを出す */
  | "show"
  /** すでに最新（または最新より新しい＝TestFlight・開発ビルド） */
  | "up-to-date"
  /** どちらかの版数が読めない。何も出さない */
  | "unreadable"
  /** 離れすぎ。設定ミスとみなして何も出さない */
  | "implausible";

/**
 * 更新のお願いを出すか。
 *
 * `running` は端末で動いている版（`App.getInfo().version`）、
 * `latest` は DB の `app_releases.latest_version`（＝**ストアに出ている版**）。
 *
 * ⚠️ `latest` に「次に出す版」を入れないこと。`ios-build.yml` の
 *    `MARKETING_VERSION` はリリース済みを記録した時点で次へ進めてあるので、
 *    そのまま入れると**存在しない版への更新**を促すことになる。
 */
export const updatePromptDecision = (
  running: string | null | undefined,
  latest: string | null | undefined,
): UpdatePromptDecision => {
  const r = parseVersion(running);
  const l = parseVersion(latest);
  if (!r || !l) return "unreadable";
  if (l[0] - r[0] > MAX_MAJOR_GAP) return "implausible";
  const diff = compareVersions(latest, running);
  if (diff === null) return "unreadable";
  return diff > 0 ? "show" : "up-to-date";
};

/** 一度「あとで」を押したら、この時間だけ同じ版については出さない */
export const DISMISS_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 「あとで」の記憶キー。
 *
 * 🔴 **版数をキーに含めること。** 含めないと、次の新しい版が出ても
 *    24時間は誰にも出ない（前に閉じた記録が効き続ける）。
 */
export const dismissKey = (platform: string, latestVersion: string): string =>
  `app-update-dismissed:${platform}:${latestVersion}`;
