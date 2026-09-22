/**
 * 次回分の入金が確認できるまで、次回分の予約を受け付けない
 * （`tenants.next_cycle_payment_required`。既定 OFF）。
 *
 * 実店舗の要望（2026-09-22 宗本さん）:
 *
 * > お店側が次回分の料金を払ってないと次回分の予約が取れないようにするシステム。
 * > 今回の最後の予約時に次回の支払いをしてもらい、次回分の予約が取れるようになる。
 * > まだ今回の予約の途中だけど次回分の予約を取りたいなら……支払う。
 *
 * ## 🔴 規則は1文
 *
 *     次回分の予約は、次回分のお支払いが確認できてから取れる。
 *
 * 「最後の予約のときに払う」は**決まりではなく、いちばん多いタイミング**。
 * 途中で払ってもいい。**「どれが最後の予約か」をアプリに判定させない**——
 * キャンセルや日時変更で動くので、判定すれば必ずズレる。見るのは「払ったか」だけ。
 *
 * 「次回の1回目までは払わずに取れる」案は**入れない**（2026-09-22 に検討して落とした）。
 * 途中でも払えるので逃げ道が要らず、残すと規則が2文になり、1回分を払わずに
 * 受けられる穴が構造として残る。
 *
 * ## 何が「次回分」か
 *
 * **暦のサイクル窓**（`plan_cycle_window` / `getCycleWindow`）。起算日の応当日ベースで、
 * 予約の入り方に左右されない。窓は連続していて、どの日付もちょうど1つの窓に属する。
 *
 * ⚠️ 画面の「利用期間」（`resolveEffectiveCycle`）の**使い切りロールは使わない**。
 * あちらの移動先は「(上限+1)回目の予約日」なので**予約が入って初めて決まる**。
 * 「その予約を入れていいか」を決める側が参照すると循環する。
 *
 * 回数の超過そのもの（月4回の5回目）を止めたいなら、それは既にある
 * `tenant_plans.allow_overflow = false`（GB004）の仕事。別の設定として重ねられる。
 *
 * ## 🔴 判定は DB の関数1本
 *
 * `member_first_unpaid_cycle_start` が「この日以降は入金が要る」1つの日付を返し、
 * **お客様の画面（RPC `get_my_next_cycle_payment_gate`）も予約のトリガー（GB009）も
 * 同じそれを呼ぶ**。規則を画面側に写さないので、
 * 「画面は取れると見せたのに DB が断る」が構造的に起きない。
 * ここにあるのは、その1つの日付の**使い方**だけ。
 */
import { addDays, format, parseISO } from "date-fns";

/** 「次回分が未入金です」を表す SQLSTATE。 */
export const NEXT_CYCLE_PAYMENT_CODE = "GB009";

/** 次回分が未入金で断られたか。 */
export const isNextCyclePaymentError = (error: unknown): boolean =>
  !!error && typeof error === "object"
  && (error as { code?: string }).code === NEXT_CYCLE_PAYMENT_CODE;

/**
 * その日付は「入金待ち」で取れないか。
 *
 * @param gate `get_my_next_cycle_payment_gate` の戻り（yyyy-MM-dd）。
 *   null＝止めるものが無い（設定OFF・プラン未確定・サブスク以外・全部払い済み）。
 *   🔴 **読めなかったときも null にすること。** 予約が取れなくなるより、
 *   従来どおり取れるほうが安全（最終判定は DB の GB009 が持っている）。
 * @param dateKey 判定したい日（yyyy-MM-dd）
 */
export const isBlockedByNextCyclePayment = (
  gate: string | null | undefined,
  dateKey: string,
): boolean => !!gate && !!dateKey && dateKey >= gate;

/**
 * サイクル窓をお客様・店に見せる形にする。
 *
 * 🔴 窓の終わり（`cycle_end`）は**含まない**（半開区間 `[start, end)`）ので、
 * そのまま出すと1日先に見える。表示は必ず前日にする。
 * 例: `[2026-10-18, 2026-11-19)` → `2026/10/18〜2026/11/18`
 */
export const formatCycleRange = (
  cycleStart: string | null | undefined,
  cycleEndExclusive: string | null | undefined,
): string => {
  if (!cycleStart || !cycleEndExclusive) return "";
  const start = parseISO(cycleStart);
  const lastDay = addDays(parseISO(cycleEndExclusive), -1);
  return `${format(start, "M/d")}〜${format(lastDay, "M/d")}`;
};
