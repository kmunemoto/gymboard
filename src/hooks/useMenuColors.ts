import { useMemo } from "react";
import type { BookingMenu } from "@/lib/bookingMenus";
import { currentThemeRef, menuColorMap, menuColorOf, menuGradientStyle } from "@/lib/menuColors";

/**
 * 店側の予定表の、メニューごとの色（2026-11-19。決まりは src/lib/menuColors.ts）。
 *
 * テーマ色は端末ごと（localStorage）なので描くたびに読む（設定で変えて戻ってきたら新しい色になる）。
 * TrainerSchedule が大きいので、ここに出してある（qualityRatchet の上限）。
 */
export function useMenuColors(menus: ReadonlyArray<BookingMenu>) {
  const theme = currentThemeRef();
  const menuColors = useMemo(
    () => menuColorMap(menus, { family: theme.family, tone: theme.tone }),
    [menus, theme.family, theme.tone],
  );
  /** 日の予定表のカード・頭文字の塗り。トレーニング以外のメニューだけ（それ以外は今の accent-gradient） */
  const menuCardStyle = (b: { isBlocked?: boolean; menuId?: string | null }) => {
    const c = b.isBlocked ? null : menuColorOf(menuColors, b.menuId);
    return c ? menuGradientStyle(c) : undefined;
  };
  return { menuColors, menuCardStyle };
}
