/**
 * 会員の在籍状態（在籍 / 休会 / 退会）の扱いを1箇所にまとめる。
 *
 * ── なぜライブラリにするか ──────────────────────────────────
 * `status === "active"` の判定はクライアントの6箇所に散っている
 * （useTenant / useProfile / tenantHelper ×2 / tenantLookup / tenantStaff）。
 * 休会・退会を足すと「どこを在籍扱いにするか」の判断が増えるので、
 * 文字列比較を各所に書くとズレる。ここを唯一の正にする。
 *
 * ⚠️ **DB 側にも同じ判断がある**（`is_tenant_over_limit` の席数カウント）。
 *    あちらは「退会だけ除外・休会は数える」。理由はマイグレーションのコメント参照。
 *    ここを変えるときは向こうも見ること。
 */

/** tenant_members.status に入りうる値 */
export type MemberStatus = "active" | "suspended" | "withdrawn" | "cancelled";

export const MEMBER_STATUSES: readonly MemberStatus[] = [
  "active",
  "suspended",
  "withdrawn",
  "cancelled",
];

/**
 * 画面に出す日本語ラベル。
 * `cancelled` はレガシー値（`is_tenant_over_limit` が元から見ていた）。
 * 新規に付けることはないが、既存行があったときに「不明」と出さないため持つ。
 */
export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  active: "在籍中",
  suspended: "休会中",
  withdrawn: "退会",
  cancelled: "退会",
};

/**
 * ジム側の一覧・集計で「いま通っている人」として扱うか。
 *
 * ⚠️ **休会は false。** 休会中の人を今月の稼働や未収の対象に入れると、
 *    「払っていない人」として毎月出続けてしまう。
 */
export const isActiveMember = (status: string | null | undefined): boolean =>
  (status ?? "active") === "active";

/**
 * 会員数の上限に対して席を1つ食っているか。
 * 休会は食う（席は確保したまま休んでいる）。退会は食わない。
 *
 * ⚠️ **DB の `is_tenant_over_limit` と1文字単位で同じ判断にすること。**
 *    向こうは `status NOT IN ('cancelled','withdrawn')` で数えている。
 *
 * 🔴 **null は false**（＝数えない）。`isActiveMember` が null を「在籍」と見るのと
 *    わざと食い違わせている。SQL の三値論理では NULL の行は `NOT IN (...)` が偽になり、
 *    **元から人数に入っていない**。ここで「未設定なら在籍でしょう」と true を返すと、
 *    画面の人数と上限判定がズレて「一覧では上限未満なのに予約が通らない」になる。
 *    合わせたくなったら DB 側を先に決めること。
 */
export const occupiesSeat = (status: string | null | undefined): boolean => {
  if (status == null) return false;
  return status !== "withdrawn" && status !== "cancelled";
};

/** 退会済みか（休会は含まない） */
export const isWithdrawn = (status: string | null | undefined): boolean => {
  const s = status ?? "active";
  return s === "withdrawn" || s === "cancelled";
};

/** 休会中か */
export const isSuspended = (status: string | null | undefined): boolean =>
  (status ?? "active") === "suspended";

/**
 * 休会期間の説明文。UI にそのまま出せる形で返す。
 * 終了日が無い休会（期限を決めていない）も表現する。
 */
export function suspensionLabel(
  from: string | null | undefined,
  until: string | null | undefined,
): string | null {
  if (!from && !until) return null;
  // ⚠️ replaceAll は使わない。tsconfig の target/lib が ES2021 未満なので落ちる。
  const fmt = (d: string) => d.split("-").join("/");
  if (from && until) return `${fmt(from)} 〜 ${fmt(until)}`;
  if (from) return `${fmt(from)} 〜（期限未定）`;
  return `〜 ${fmt(until!)}`;
}

/**
 * 休会の入力が妥当か。妥当でなければ理由（日本語）を返す。
 *
 * DB 側にも同じ CHECK（`tenant_members_suspend_range`）がある。
 * ここは「保存を押す前に画面で気づける」ようにするためのもので、
 * **DB 側の制約を消してこちらだけにしないこと。**
 */
export function validateSuspension(
  from: string,
  until: string,
): string | null {
  if (!from) return "休会の開始日を入れてください";
  if (until && from > until) return "終了日は開始日より後にしてください";
  return null;
}
