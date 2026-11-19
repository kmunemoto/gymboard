import { useTranslation } from "react-i18next";
import type { BookingMenu } from "@/lib/bookingMenus";
import { hslCss, type MenuColor } from "@/lib/menuColors";

interface Props {
  /** そのジムのメニュー（並び順） */
  menus: ReadonlyArray<BookingMenu>;
  /** menuColorMap の結果。null のメニューは今の色（テーマ色） */
  colors: ReadonlyMap<string, MenuColor | null>;
  /** 表示中の週の予約のメニュー（メニューの無い予約は null） */
  menuIds: ReadonlyArray<string | null | undefined>;
  className?: string;
}

/**
 * 予定表の色の凡例（どの色がどのメニューか・2026-11-19）。何をなぜ色分けするかは src/lib/menuColors.ts。
 *
 * 色の付いたメニュー（トレーニング以外）の予約が、表示中の週に1件でもあるときだけ出す。
 * トレーニングだけの週・メニューが1つの店は今まで通り、何も足さない。
 */
const MenuColorLegend = ({ menus, colors, menuIds, className = "" }: Props) => {
  const { t } = useTranslation();
  const present = new Set(menuIds);
  const colored = menus.filter((m) => present.has(m.id) && colors.get(m.id));
  if (colored.length === 0) return null;
  // 今の色（テーマ色）のメニュー＝トレーニング。メニューの無い予約もこの色
  const base = menus.find((m) => colors.has(m.id) && colors.get(m.id) === null);
  const entries = [
    ...(base ? [{ id: base.id, name: base.name, color: null as MenuColor | null }] : []),
    ...colored.map((m) => ({ id: m.id, name: m.name, color: colors.get(m.id) ?? null })),
  ];
  return (
    <div
      role="group"
      aria-label={t("schedule.menuColorLegend")}
      data-testid="menu-color-legend"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}
    >
      {entries.map((e) => (
        <span key={e.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            data-testid="menu-color-swatch"
            className={`w-3 h-3 rounded shrink-0 ${e.color ? "" : "bg-accent"}`}
            style={e.color ? { backgroundColor: hslCss(e.color.accent) } : undefined}
          />
          {e.name}
        </span>
      ))}
    </div>
  );
};

export default MenuColorLegend;
