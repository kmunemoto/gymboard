/**
 * 「アクティブ顧客」の数え方と、ひとりひとりの通い具合の分け方。
 *
 * 実店舗の要望（2026-09-23 宗本さん）:
 *
 * > アクティブ顧客って何を基準に数えてるの？ 本当に今通っている人だけの数字を出して欲しい。
 * > 僕の場合は次回の予約が入ってない人はアクティブ顧客に数えないで欲しい。
 * > その辺、設定できるようにできる？ジムごとに
 *
 * それまでの「アクティブ顧客」は**在籍している全員**（休会・退会にしていない人）で、
 * 実際に来ているかは見ていなかった（本番の自社ジムで 42名。次の予約がある人は 22名）。
 *
 * ## ひとりを必ず1つに分ける
 *
 * | 分類 | 条件 |
 * |---|---|
 * | coming（通っている） | 今日以降に予約がある。今日来る人は、来たあとも今日いっぱい |
 * | awaiting（予約待ち） | 次の予約は無いが、最後の来店（または登録）から目安日数が経っていない |
 * | away（離れている） | 次の予約が無く、目安日数以上来ていない／一度も来ていない |
 * | suspended（休会） | 休会中。どこにも数えない |
 *
 * 🔴 **away は、ホーム画面の「フォローが必要な顧客」と同じ人たち。**
 * 同じ関数で判定しているので、「離れている 15名」と一覧の人数は必ず一致する。
 * 別々に数えると、片方だけ直されて食い違う（このリポジトリで何度も起きた形）。
 *
 * ## 🔴 日数の数え方は「フォローが必要な顧客」の旧実装と1日も変えていない
 *
 * 最後の来店からの日数は「その日が終わってから何日経ったか」
 * （`floor((今 - 来店日の 23:59:59 JST) / 1日)`）。
 * 登録からの日数は `floor((今 - 登録時刻) / 1日)`。どちらも旧実装のまま。
 * 数え方を「在籍の全員」にしている店（既定・20店中19店）では、
 * フォロー一覧に出る人が**1人も変わらない**ようにするため
 * （`src/test/activeClients.test.ts` が旧実装と突き合わせている）。
 *
 * ## 「今日いっぱい数える」理由
 *
 * セッションが終わるたびに数字が減ると、朝と夜で違う数字になり「壊れた」と見える。
 */
import { isActiveMember } from "@/lib/memberLifecycle";

export const ACTIVE_CLIENT_BASES = ["enrolled", "next_booking"] as const;
export type ActiveClientBasis = (typeof ACTIVE_CLIENT_BASES)[number];

/** フォローの目安日数の既定。旧実装の `INACTIVE_DAYS = 14` と同じ。 */
export const DEFAULT_FOLLOW_UP_AFTER_DAYS = 14;
/** 設定画面で選べる目安日数。DB の CHECK（3〜90）の内側に収めること。 */
export const FOLLOW_UP_DAY_CHOICES = [7, 10, 14, 21, 30] as const;
export const FOLLOW_UP_DAYS_MIN = 3;
export const FOLLOW_UP_DAYS_MAX = 90;

const DAY_MS = 86_400_000;

/** 読めない・未知の値は「在籍の全員」（今まで通り）に倒す。 */
export const resolveActiveClientBasis = (v: unknown): ActiveClientBasis =>
  v === "next_booking" ? "next_booking" : "enrolled";

/** 読めない・範囲外の値は既定の 14日に倒す。 */
export const resolveFollowUpAfterDays = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= FOLLOW_UP_DAYS_MIN && v <= FOLLOW_UP_DAYS_MAX
    ? v
    : DEFAULT_FOLLOW_UP_AFTER_DAYS;

/** ISO 日時 → JST の暦日（yyyy-MM-dd）。 */
export const jstDateKey = (iso: string | Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);

/** 分けるのに要る、ひとり分の材料（`useAllCustomerProfiles` がそのまま持っている）。 */
export interface ClientPresenceInput {
  user_id: string;
  /** `tenant_members.status` */
  status: string | null;
  /** いまより後の、いちばん近い予約（ISO）。キャンセル・同日キャンセル消化は除いたもの。 */
  next_booking_date: string | null;
  /** いまより前の、いちばん新しい予約（ISO）。同上。 */
  last_visit_date: string | null;
  created_at: string | null;
  /**
   * profiles の行があるか。
   * ⚠️ 行が無いと画面側は created_at に「いま」を入れてしまう（`useAllCustomerProfiles`）。
   *    それを信じると、何か月も前の空アカウントが永遠に「新規」に見える。
   */
  has_profile: boolean;
}

export type ClientPresence =
  | { kind: "coming" }
  | { kind: "awaiting"; reason: "recent"; lastVisit: string; days: number }
  | { kind: "awaiting"; reason: "new"; days: number }
  | { kind: "away"; reason: "lapsed"; lastVisit: string; days: number }
  | { kind: "away"; reason: "neverBooked"; days: number | null }
  | { kind: "suspended" };

/** ひとりを1つに分ける。 */
export const classifyClientPresence = (
  p: ClientPresenceInput,
  nowMs: number,
  followUpAfterDays: number,
): ClientPresence => {
  if (!isActiveMember(p.status)) return { kind: "suspended" };

  const today = jstDateKey(new Date(nowMs));
  const lastVisit = p.last_visit_date ? jstDateKey(p.last_visit_date) : null;
  // 今日以降に予約がある。今日来た人は、来たあとも今日いっぱい数える
  if (p.next_booking_date || lastVisit === today) return { kind: "coming" };

  if (lastVisit) {
    // 旧実装と同じ: 来店日が**終わってから**何日経ったか
    const days = Math.floor((nowMs - Date.parse(`${lastVisit}T23:59:59+09:00`)) / DAY_MS);
    return days >= followUpAfterDays
      ? { kind: "away", reason: "lapsed", lastVisit, days }
      : { kind: "awaiting", reason: "recent", lastVisit, days };
  }

  // 一度も来ていない。プロフィールが無い＝登録日が分からない空アカウントは「離れている」
  if (!p.has_profile) return { kind: "away", reason: "neverBooked", days: null };
  const joined = p.created_at ? Math.floor((nowMs - Date.parse(p.created_at)) / DAY_MS) : 0;
  return joined >= followUpAfterDays
    ? { kind: "away", reason: "neverBooked", days: joined }
    : { kind: "awaiting", reason: "new", days: joined };
};

export type Classified<T> = { client: T; presence: ClientPresence };

export interface ClientPresenceSummary<T> {
  /** 在籍の全員（休会・退会を除く）。「在籍の全員」で数える店の数字 */
  enrolled: number;
  coming: Classified<T>[];
  /** 急ぐ順（最後の来店・登録が古い順） */
  awaiting: Classified<T>[];
  /** 旧「フォローが必要な顧客」と同じ並び（日数の多い順。登録日の分からない空アカウントは最後） */
  away: Classified<T>[];
}

const daysOf = (p: ClientPresence): number =>
  "days" in p && typeof p.days === "number" ? p.days : -1;

/** 全員を分けて、数と一覧を返す。 */
export const summarizeClientPresence = <T extends ClientPresenceInput>(
  clients: readonly T[],
  nowMs: number,
  followUpAfterDays: number,
): ClientPresenceSummary<T> => {
  const out: ClientPresenceSummary<T> = { enrolled: 0, coming: [], awaiting: [], away: [] };
  for (const client of clients) {
    const presence = classifyClientPresence(client, nowMs, followUpAfterDays);
    if (presence.kind === "suspended") continue;
    out.enrolled += 1;
    out[presence.kind].push({ client, presence });
  }
  const byDaysDesc = (a: Classified<T>, b: Classified<T>) => daysOf(b.presence) - daysOf(a.presence);
  out.awaiting.sort(byDaysDesc);
  out.away.sort(byDaysDesc);
  return out;
};

/** ホーム画面の大きい数字。 */
export const activeClientCount = (
  basis: ActiveClientBasis,
  summary: Pick<ClientPresenceSummary<unknown>, "enrolled" | "coming">,
): number => (basis === "next_booking" ? summary.coming.length : summary.enrolled);
