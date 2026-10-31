/**
 * メニューの体験予約（例: マシンピラティス専用の体験予約ページ）。2026-10-31
 *
 * 宗本さん「マシンピラティス専用の体験予約受付サイトをつくってほしい。
 *           マシンピラティスの時間の枠だけが表示されるように」
 *
 * - ページは `/trial/:tenantId/menu/:menuId`（`src/pages/TrialBooking.tsx` をメニューの体験として開く）
 * - 出す枠は**担当（先生）のシフト ∩ 営業時間**だけ（`staffBookingSlotMinutes`。シフトの無い担当は営業時間どおり）
 * - 開始日（starts_on）より前の日は選べない
 * - 「何日先まで」は体験と同じ。ただし**開始日がまだ先なら、開始日の前日を「今日」とみなす**
 *   （開始日から N 日分を前もって受け付ける。宗本さんが選んだ・2026-10-31）
 * - 料金・案内文はメニューごと（トレーニングの体験の案内文は「体験トレーニングの料金は…」なので流用しない）
 *
 * 予約は trial-book（`menu_id` を送る）。担当・開始日・シフトは DB（`apply_trial_menu`）も見る。
 * サーバーの同じ判定は `supabase/functions/_shared/trialRules.ts`（ここと同じ答えを返すこと）。
 * `supabase/migrations/20261031010000_menu_trials.sql`
 */
import { addDays, format } from "date-fns";
import { getJSTNow } from "@/lib/timezone";
import { bookingWindowEndDateKey, LEGACY_GUEST_WINDOW_DAYS } from "@/lib/bookingWindow";
import { weekdayOfDateKey, type OperatingHours } from "@/lib/businessHours";
import { staffBookingSlotMinutes, type StaffScheduleRow } from "@/lib/staffSchedule";

/** 担当のシフトの1行（公開ページには担当の user_id を渡さない） */
export interface MenuTrialShift {
  weekday: number;
  start_time: string;
  end_time: string;
}

/** `get_menu_trial_public` の1行 */
export interface MenuTrialInfo {
  menuId: string;
  tenantId: string;
  name: string;
  /** この日から予約できる（yyyy-MM-dd・JST）。null はすぐ */
  startsOn: string | null;
  /** 体験の料金（税込・円）。null は「料金を表示しない」で 0 とは違う（hasTrialPrice で見る） */
  priceYen: number | null;
  infoTitle: string | null;
  infoBody: string | null;
  shifts: MenuTrialShift[];
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** RPC の1行を読む。読めなければ null（＝このメニューの体験は受け付けていない） */
export const parseMenuTrial = (row: unknown): MenuTrialInfo | null => {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.menu_id !== "string" || typeof r.tenant_id !== "string") return null;
  const name = text(r.name);
  if (!name) return null;
  const shifts = (Array.isArray(r.shifts) ? r.shifts : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .filter((s) => typeof s.weekday === "number" && TIME.test(String(s.start_time)) && TIME.test(String(s.end_time)))
    .map((s) => ({ weekday: s.weekday as number, start_time: String(s.start_time), end_time: String(s.end_time) }));
  return {
    menuId: r.menu_id,
    tenantId: r.tenant_id,
    name,
    startsOn: typeof r.starts_on === "string" && DATE_KEY.test(r.starts_on) ? r.starts_on : null,
    priceYen: typeof r.trial_price_yen === "number" ? r.trial_price_yen : null,
    infoTitle: text(r.trial_info_title),
    infoBody: text(r.trial_info_body),
    shifts,
  };
};

/** 担当の行として扱うための仮の id（staffSchedule.ts の関数は user_id で絞るため） */
const MENU_STAFF = "menu-staff";

/**
 * その日に並べる開始時刻（分）。担当のシフト ∩ 営業時間・開店（シフトの始まり）から15分刻み・1枠が収まるもの。
 * シフトの無い担当は営業時間どおり（GB002 と同じ）。担当の休みの曜日・定休日は空。
 */
export const menuTrialSlotMinutes = (
  hours: OperatingHours | null | undefined,
  sessionMinutes: number,
  dateKey: string,
  shifts: ReadonlyArray<MenuTrialShift>,
): number[] => {
  const rows: StaffScheduleRow[] = shifts.map((s) => ({ user_id: MENU_STAFF, ...s }));
  return staffBookingSlotMinutes(hours, sessionMinutes, weekdayOfDateKey(dateKey), rows, MENU_STAFF);
};

/** 開始日より前か */
export const isBeforeMenuStart = (menu: Pick<MenuTrialInfo, "startsOn">, dateKey: string): boolean =>
  !!menu.startsOn && dateKey < menu.startsOn;

/**
 * 「何日先まで」の最終日（その日は含む）。開始日がまだ先なら、開始日の前日を「今日」とみなして数える。
 * 例: 10日先まで・開始日 11/25・今日 10/31 → 12/4 まで。開始日を過ぎたら体験と同じ（今日から10日先まで）。
 */
export const menuTrialWindowEndKey = (
  startsOn: string | null | undefined,
  configuredDays: number | null | undefined,
  now: Date = getJSTNow(),
): string => {
  let anchor = now;
  if (startsOn && DATE_KEY.test(startsOn) && startsOn > format(now, "yyyy-MM-dd")) {
    const [y, m, d] = startsOn.split("-").map(Number);
    anchor = addDays(new Date(y, m - 1, d), -1);
  }
  return bookingWindowEndDateKey(configuredDays, { days: LEGACY_GUEST_WINDOW_DAYS }, anchor);
};

/** 開始日の表示（「11/25」）。bookingMenus.ts の menuStartLabel と同じ形 */
export { menuStartLabel } from "@/lib/bookingMenus";

/** 店がお客様に送るリンク（`getWebOrigin()` を渡す。ネイティブでは capacitor:// になるため） */
export const menuTrialPath = (tenantId: string, menuId: string): string => `/trial/${tenantId}/menu/${menuId}`;
