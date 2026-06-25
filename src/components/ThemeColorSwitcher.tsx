import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Palette, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { THEME_COLORS, applyThemeColor, getStoredThemeColor } from "@/lib/themeColor";

// 設定画面用: アクセントカラーを 6 色から選ぶ。お客様側・ジム側共通。
interface ThemeColorSwitcherProps {
  variant?: "customer" | "trainer";
}

const ThemeColorSwitcher = ({ variant = "customer" }: ThemeColorSwitcherProps) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>(getStoredThemeColor());

  const handleSelect = (id: string) => {
    setSelected(id);
    applyThemeColor(id);
  };

  return (
    <section data-variant={variant}>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <Palette className="w-3.5 h-3.5" />
        {t("settings.themeColor")}
      </h2>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-accent/10">
              <Palette className="w-4 h-4 text-accent" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold">{t("settings.themeColor")}</p>
              <p className="text-[11px] text-muted-foreground mb-3">{t("settings.themeColorDescription")}</p>
              <div className="flex flex-wrap gap-3">
                {THEME_COLORS.map((preset) => {
                  const active = selected === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelect(preset.id)}
                      aria-label={t(preset.nameKey)}
                      aria-pressed={active}
                      title={t(preset.nameKey)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform ${
                        active ? "ring-2 ring-offset-2 ring-foreground/50 scale-110" : "hover:scale-105"
                      }`}
                      style={{ backgroundColor: `hsl(${preset.swatch})` }}
                    >
                      {active && <Check className="w-4 h-4 text-white" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};

export default ThemeColorSwitcher;
