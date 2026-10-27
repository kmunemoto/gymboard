/**
 * お知らせの配信対象（2026-10-27）。
 *
 * 宗本さん「この文章の対象を1人だけ除いて送れる様にとかもできるようにして、その辺考えて実装して」。
 *
 * `announcements.target` の値:
 *   - `all`       … 全員（今まで通り）
 *   - `except`    … 全員から、選んだ人を除く
 *   - `only`      … 選んだ人だけ（複数可。画面の「個別」）
 *   - `<user_id>` … 1人だけ（今までの「個別」。古いアプリが書く。編集を開くと `only` の1人になる）
 *
 * 選んだ人は `announcement_audience` に1行ずつ（店のスタッフだけが読める）。
 * - 🔴 出し分けは DB の読み取り権限（RLS）。お客様の画面は表を直接読んでいるので、
 *   除いた人には**古いアプリでも**出ない。画面側で絞る処理は持たない
 * - 🔴 保存は `save_announcement`（行と選んだ人を1つのトランザクションで書く）。別々に書くと、
 *   間に配信の定期実行が挟まって「除く人がまだ居ない」状態で全員に送りうる
 * - プッシュ通知は `push-announcements` が同じ規則で送る
 *
 * 詳細は `supabase/migrations/20261027020000_announcement_audience.sql`。
 */

export type AudienceMode = "all" | "except" | "only";

/** 保存済みの target から、画面の選択を決める */
export const audienceModeOf = (target: string): AudienceMode =>
  target === "all" ? "all" : target === "except" ? "except" : "only";

/** 保存済みのお知らせで選ばれている人。古い `target=<user_id>` はその1人 */
export const audienceUserIdsOf = (
  target: string,
  rows: ReadonlyArray<{ user_id: string }> | null | undefined,
): string[] => {
  if (target === "all") return [];
  if (target === "except" || target === "only") return (rows ?? []).map((r) => r.user_id);
  return [target];
};

/** `save_announcement` に渡す配信対象。全員なら選んだ人は送らない。重複は落とす */
export const audienceSaveArgs = (
  mode: AudienceMode,
  userIds: ReadonlyArray<string>,
): { p_target: AudienceMode; p_user_ids: string[] } => ({
  p_target: mode,
  p_user_ids: mode === "all" ? [] : [...new Set(userIds)],
});

/** 保存できないときの文言キー（`announcement.*`）。保存できるなら null */
export const audienceErrorKey = (mode: AudienceMode, userIds: ReadonlyArray<string>): string | null => {
  if (mode === "all" || userIds.length > 0) return null;
  return mode === "except" ? "announcement.errExcept" : "announcement.errTarget";
};

/**
 * 一覧に出す配信対象の文言（キーと差し込み値）。名前が分からない人は数だけ出す。
 * 例: 全員 / 全員（A を除く）/ 全員（3人を除く）/ A / A ほか2人
 */
export const audienceLabel = (
  target: string,
  userIds: ReadonlyArray<string>,
  nameOf: (userId: string) => string | null | undefined,
): { key: string; values?: Record<string, string | number> } => {
  const mode = audienceModeOf(target);
  if (mode === "all") return { key: "announcement.targetAll" };
  const firstName = userIds.length > 0 ? nameOf(userIds[0]) : null;
  if (mode === "except") {
    return userIds.length === 1 && firstName
      ? { key: "announcement.labelExceptOne", values: { name: firstName } }
      : { key: "announcement.labelExceptMany", values: { count: userIds.length } };
  }
  if (!firstName) return { key: "announcement.labelOnlyCount", values: { count: userIds.length } };
  return userIds.length === 1
    ? { key: "announcement.labelOnlyOne", values: { name: firstName } }
    : { key: "announcement.labelOnlyMany", values: { name: firstName, rest: userIds.length - 1 } };
};
