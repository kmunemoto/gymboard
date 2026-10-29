import { useTranslation } from "react-i18next";
import { CalendarClock, LayoutList, UserRound } from "lucide-react";
import { menuStartLabel, upcomingMenuStart, type BookingMenu } from "@/lib/bookingMenus";
import { getJSTToday } from "@/lib/timezone";
import type { TenantStaff } from "@/lib/tenantStaff";

/**
 * お客様の予約画面の「メニュー」または「担当」の選択（2026-10-28 に CustomerBooking から切り出し）。
 *
 * - 予約メニューを使っている店（`booking_menus` がある）… メニューを選ぶ（2つ以上あるときだけ出す）。
 *   担当はメニューで決まるので、担当の選択は出さない（src/lib/bookingMenus.ts）。
 *   🔴 担当（先生）の名前も出さない。宗本さん「先生の名前は出さなくていい。トレーニングかマシンピラティスを
 *   選べるようにだけして」（2026-10-29）
 * - 使っていない店 … 今まで通り、スタッフが2人以上いれば担当を選ぶ
 * - まだ始まっていないメニュー（開始日が今日より後）は、名前に「11/25〜」を添え、選んだら開始日を案内する
 *   （開始日より前の日付はカレンダーで選べない。src/lib/bookingCalendarDay.ts）
 *
 * どちらも、選び直すと空き枠の見え方が変わるので、呼び出し側が選択中の枠を外す。
 */
interface Props {
  /** お客様が選べるメニュー（`selectableMenus`）。空ならメニューを使っていない店 */
  menus: ReadonlyArray<BookingMenu>;
  selectedMenuId: string | null;
  onPickMenu: (menu: BookingMenu) => void;
  staff: ReadonlyArray<TenantStaff>;
  /** 担当を選べる店か（`canSelectStaff`） */
  staffSelectable: boolean;
  selectedStaffId: string | null;
  onPickStaff: (staffId: string | null) => void;
}

const chipClass = (selected: boolean) =>
  `px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-[44px] ${
    selected ? "bg-accent text-accent-foreground shadow-sm" : "bg-secondary text-muted-foreground hover:text-foreground"
  }`;

const BookingStaffMenuPicker = ({
  menus, selectedMenuId, onPickMenu, staff, staffSelectable, selectedStaffId, onPickStaff,
}: Props) => {
  const { t } = useTranslation();

  if (menus.length > 0) {
    // メニューが1つだけなら選ぶものが無い（そのメニューで予約する）
    if (menus.length < 2) return null;
    const selected = menus.find((m) => m.id === selectedMenuId) ?? null;
    const today = getJSTToday();
    const selectedStart = upcomingMenuStart(selected, today);
    return (
      <div className="mb-3" data-testid="booking-menu-picker">
        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <LayoutList className="w-3.5 h-3.5" />
          {t("bookingMenus.pickerLabel")}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {menus.map((m) => {
            const start = upcomingMenuStart(m, today);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onPickMenu(m)}
                aria-pressed={selectedMenuId === m.id}
                className={chipClass(selectedMenuId === m.id)}
              >
                {m.name}
                {start && (
                  <span className="ml-1 text-[10px] font-semibold opacity-80">
                    {t("bookingMenus.startsOnChip", { date: menuStartLabel(start) })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {selected && selectedStart && (
          <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1" data-testid="booking-menu-starts-on">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
            {t("bookingMenus.startsOnNotice", { name: selected.name, date: menuStartLabel(selectedStart) })}
          </p>
        )}
      </div>
    );
  }

  // 担当の指名。スタッフが2人以上いるジムでだけ出す。
  if (!staffSelectable) return null;
  return (
    <div className="mb-3">
      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <UserRound className="w-3.5 h-3.5" />
        {t("staff.selectLabel")}
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onPickStaff(null)}
          aria-pressed={selectedStaffId === null}
          className={chipClass(selectedStaffId === null)}
        >
          {t("staff.anyone")}
        </button>
        {staff.map((s) => (
          <button
            key={s.user_id}
            type="button"
            onClick={() => onPickStaff(s.user_id)}
            aria-pressed={selectedStaffId === s.user_id}
            className={chipClass(selectedStaffId === s.user_id)}
          >
            {s.display_name}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5">{t("staff.selectHint")}</p>
    </div>
  );
};

export default BookingStaffMenuPicker;
