/**
 * 予約メニュー（booking_menus・2026-10-28）。
 *
 * 宗本さん（パーソナルピラティスを始める）:
 *   「お客様用にも、筋トレの予約とピラティスの予約で分けて予約できるようにしてほしい」
 *   「お客さんは、ヨガかマシンピラティスのどっちかを選べる」
 *
 * - 担当（staff_user_id）のいるメニューの予約は、その担当の予約になる。
 *   画面はそのメニューを選んだら「担当を指名した」のと同じ枠の出し方をする（シフトの時間だけ）
 * - 担当のいないメニュー（トレーニング）は今まで通り
 * - 回数・料金・時間はプランのまま（メニューで変えない）
 *
 * ## 🔴 担当のいるメニューの時間は、そのメニュー専用（tenants.menu_staff_hours_exclusive）
 *
 * `get_tenant_booked_slots` が、その時間を**担当つきのブロック**（`isBlock` かつ `staffUserId` あり）
 * として返す（`isReservedBlock`）。
 *   - 担当のいるメニュー（＝担当を決めた予約）では無視する（`isFootprintBlocked`）
 *   - 担当のいないメニューでは普通のブロック。枠ごと出さない（`overlapsReservedBlock`）。
 *     「満枠」と見せると、空くことの無い枠にキャンセル待ちが付く
 *   - 公開の体験ページ・古いアプリでは普通のブロック（体験は入れない）
 * 最終判定は DB（`apply_booking_menu` の GB011）。
 * `supabase/migrations/20261028030000_booking_menus.sql`
 *
 * ## 開始日（starts_on・2026-10-29）
 *
 * 宗本さん「今すぐ（オンに）だが、11/25 以降からマシンピラティスの予約は可能」。
 * メニューはオンのまま出し、開始日より前の日付だけ選べなくする（カレンダーは `menuStartsOn`）。
 * DB も開始日より前は、そのメニューを選んだ予約（GB012）・その先生の指名（GB002）を断り、
 * 担当のシフトの時間を専用にしない（トレーニングの枠を始まる前から塞がない）。
 * `supabase/migrations/20261029020000_booking_menu_starts_on.sql`
 */
import { footprintOverlaps } from "@/lib/bookingOptions";
import { parseTimeToMinutes } from "@/lib/businessHours";

export interface BookingMenu {
  id: string;
  name: string;
  /** 担当。いれば、このメニューの予約はこの人の予約になる */
  staff_user_id: string | null;
  /** お客様に出すか */
  is_active: boolean;
  sort_order: number;
  /** この日から予約できる（yyyy-MM-dd・JST）。null はすぐ */
  starts_on?: string | null;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** DB の行を読む。壊れた行は捨てる。並びは sort_order（同じなら読んだ順） */
export const parseMenus = (rows: unknown): BookingMenu[] =>
  (Array.isArray(rows) ? rows : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string")
    .map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "").trim(),
      staff_user_id: typeof r.staff_user_id === "string" ? r.staff_user_id : null,
      is_active: r.is_active !== false,
      sort_order: typeof r.sort_order === "number" ? r.sort_order : 0,
      // 読めない値は「すぐ」に倒す（選べない日を勝手に作らない。最終判定は DB）
      starts_on: typeof r.starts_on === "string" && DATE_KEY.test(r.starts_on) ? r.starts_on : null,
    }))
    .filter((m) => m.name !== "")
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.sort_order - b.m.sort_order || a.i - b.i)
    .map(({ m }) => m);

/**
 * お客様が選べるメニュー。オンのもの、かつ担当がいるならその人が今もスタッフであるもの
 * （外したスタッフのメニューを出すと、押しても DB に断られる）。
 */
export const selectableMenus = (
  menus: ReadonlyArray<BookingMenu>,
  staffIds: ReadonlyArray<string>,
): BookingMenu[] => menus.filter((m) => m.is_active && (!m.staff_user_id || staffIds.includes(m.staff_user_id)));

/**
 * 何も選んでいないときのメニュー。担当のいない先頭（トレーニング）、無ければ先頭。
 * DB も、メニューを送ってこない予約を「担当のいない先頭のメニュー」として記録する。
 */
export const defaultMenu = (menus: ReadonlyArray<BookingMenu>): BookingMenu | null =>
  menus.find((m) => !m.staff_user_id) ?? menus[0] ?? null;

/** そのメニューを、その日（yyyy-MM-dd）に予約できるか（開始日より前なら false） */
export const isMenuOpenOn = (menu: Pick<BookingMenu, "starts_on"> | null | undefined, dateKey: string): boolean =>
  !menu?.starts_on || dateKey >= menu.starts_on;

/** まだ始まっていないメニューの開始日（今日より後なら返す）。お客様の画面に「11/25〜」と出す */
export const upcomingMenuStart = (menu: Pick<BookingMenu, "starts_on"> | null | undefined, today: string): string | null =>
  menu?.starts_on && menu.starts_on > today ? menu.starts_on : null;

/** yyyy-MM-dd を「11/25」の形にする */
export const menuStartLabel = (dateKey: string): string => {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
};

/**
 * 予約に添えるメニューの名前。メニューが2つ以上ある店だけ（1つなら全部同じ名前なので出さない）。
 * 外したメニューの予約にも名前は出す（過去の予約は消えない）。
 */
export const menuNameOf = (menus: ReadonlyArray<BookingMenu>, menuId: string | null | undefined): string | null =>
  menus.length >= 2 && menuId ? (menus.find((m) => m.id === menuId)?.name ?? null) : null;

/** 担当のいるメニューの時間（専用）を表す、担当つきのブロックか */
export const isReservedBlock = (slot: { isBlock: boolean; staffUserId: string | null }): boolean =>
  slot.isBlock && slot.staffUserId !== null;

/**
 * その開始時刻からの占有（1枠＋オプション＋間）が、担当のいるメニューの時間（専用）に重なるか。
 * 担当のいないメニューの枠から外すのに使う（重なりの数え方は DB の menu_reserved_overlaps と同じ）。
 */
export const overlapsReservedBlock = (
  slotsOnDate: ReadonlyArray<{ startTime: string; endTime: string; isBlock: boolean; staffUserId: string | null }>,
  startMinutes: number,
  footprintMinutes: number,
): boolean =>
  slotsOnDate.some((s) => {
    if (!isReservedBlock(s)) return false;
    const startMin = parseTimeToMinutes(s.startTime);
    const endMin = parseTimeToMinutes(s.endTime);
    if (startMin === null || endMin === null) return false;
    // 終わりが 00:00（24:00）の行は、その日の終わりまで
    return footprintOverlaps(startMinutes, footprintMinutes, { startMin, endMin: endMin <= startMin ? 24 * 60 : endMin });
  });

const codeOf = (error: unknown): unknown =>
  error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;

/** その時間は担当のいるメニュー専用（DB の GB011） */
export const isMenuReservedError = (error: unknown): boolean => codeOf(error) === "GB011";

/** そのメニューは今は予約できない（外した・別のジムのメニュー。DB の GB012） */
export const isMenuUnavailableError = (error: unknown): boolean => codeOf(error) === "GB012";
