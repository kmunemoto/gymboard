import { useTranslation } from "react-i18next";
import { defaultMenu, type BookingMenu } from "@/lib/bookingMenus";
import type { TenantStaff } from "@/lib/tenantStaff";

/**
 * 店の代理予約の「メニュー」と「担当」（2026-10-28 に TrainerSchedule から切り出し）。
 *
 * - メニュー … 予約メニューが2つ以上ある店だけ出す。選ぶと担当をそのメニューの担当に合わせる
 *   （担当のいないメニューなら「誰でも」）。何も選ばなければ既定のメニュー（担当のいない先頭）
 * - 担当 … 今まで通り、スタッフが2人以上いる店だけ出す。メニューで決まった担当を店が替えてもよい
 *   （先生のお休みの日に代わりの人が見る、など。DB も代理予約の担当は書き換えない）
 *
 * どちらも、選び直すと空き枠の見え方が変わるので、呼び出し側が選択中の時刻を外す。
 */
interface Props {
  /** 選べるメニュー（`selectableMenus`） */
  menus: ReadonlyArray<BookingMenu>;
  /** 選んだメニュー。"" は既定のメニュー */
  menuId: string;
  staff: ReadonlyArray<TenantStaff>;
  staffSelectable: boolean;
  /** 選んだ担当。"" は指名なし */
  staffId: string;
  onChange: (next: { menuId: string; staffId: string }) => void;
}

const SELECT_CLASS =
  "w-full h-11 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";

const ProxyStaffMenuSelect = ({ menus, menuId, staff, staffSelectable, staffId, onChange }: Props) => {
  const { t } = useTranslation();
  const current = menus.find((m) => m.id === menuId) ?? defaultMenu(menus);
  return (
    <>
      {menus.length >= 2 && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("bookingMenus.pickerLabel")}</label>
          <select
            value={current?.id ?? ""}
            onChange={(e) => {
              const next = menus.find((m) => m.id === e.target.value);
              onChange({ menuId: e.target.value, staffId: next?.staff_user_id ?? "" });
            }}
            className={SELECT_CLASS}
            aria-label={t("bookingMenus.pickerLabel")}
          >
            {menus.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      )}
      {/* 担当スタッフ。1人しか居ないジムには出さない（選ぶ意味が無い）。 */}
      {staffSelectable && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("staff.selectLabel")}</label>
          <select
            value={staffId}
            onChange={(e) => onChange({ menuId, staffId: e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="">{t("staff.anyone")}</option>
            {staff.map((sm) => (
              <option key={sm.user_id} value={sm.user_id}>{sm.display_name}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
};

export default ProxyStaffMenuSelect;
