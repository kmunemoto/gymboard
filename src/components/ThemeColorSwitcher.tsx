import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Palette, Check, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  THEME_COLORS, THEME_FAMILIES, THEME_TONES, DEFAULT_THEME_ID,
  applyThemeColor, getStoredThemeColor, applyGlassMode, getStoredGlassMode, findThemeColor,
  type ThemeFamily, type ThemeTone,
} from "@/lib/themeColor";

// 設定画面用: アクセントカラーを 64 色（16の色 × 4つのトーン）から選ぶ。お客様側・ジム側共通。
//
// 🔴 64個の丸を並べると、スマホでは1つが指より小さくなる（2026-09-24 宗本さん
//    「このまま色を選ぶシステムだと64色難しい」）。そこで2段にした:
//
//    1. 色（4×4）… 1枚の札に、その色の4つのトーンを縦縞で見せる（64色がひと目で見える）
//    2. トーン（4つ）… 選んだ色の ビビッド／ソフト／くすみ／ディープ を大きな丸で
//
//    色を変えてもトーンはそのまま（くすみが好きな人は、くすみのまま色だけ替えられる）。
//    どちらも押した瞬間にアプリ全体の色が変わる（見比べながら選べる）。
interface ThemeColorSwitcherProps {
  variant?: "customer" | "trainer";
}

const ThemeColorSwitcher = ({ variant = "customer" }: ThemeColorSwitcherProps) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>(getStoredThemeColor());
  const [glass, setGlass] = useState<boolean>(getStoredGlassMode());

  const current =
    THEME_COLORS.find((p) => p.id === selected) ?? THEME_COLORS.find((p) => p.id === DEFAULT_THEME_ID)!;
  const colorName = (family: ThemeFamily, tone: ThemeTone) =>
    t("settings.themeColorName", {
      family: t(`settings.themeColors.${family}`),
      tone: t(`settings.themeTones.${tone}`),
    });

  const pick = (family: ThemeFamily, tone: ThemeTone) => {
    const preset = findThemeColor(family, tone);
    setSelected(preset.id);
    applyThemeColor(preset.id);
  };

  const handleGlass = (on: boolean) => {
    setGlass(on);
    applyGlassMode(on);
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
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">{t("settings.themeColor")}</p>
              <p className="text-[11px] text-muted-foreground mb-3">{t("settings.themeColorDescription")}</p>

              {/* 選択中の色の名前（「ティール・ソフト」） */}
              <div className="flex items-center gap-2 mb-3" data-testid="theme-current">
                <span
                  className="w-4 h-4 rounded-full shrink-0"
                  style={{ backgroundColor: `hsl(${current.swatch})` }}
                  aria-hidden="true"
                />
                <span className="text-xs font-bold">{colorName(current.family, current.tone)}</span>
              </div>

              {/* 1. 色（16）。札の縦縞は左から ビビッド／ソフト／くすみ／ディープ */}
              <p className="text-[11px] font-bold text-muted-foreground mb-1.5">{t("settings.themeFamilyLabel")}</p>
              <div className="grid grid-cols-4 gap-2" role="group" aria-label={t("settings.themeFamilyLabel")}>
                {THEME_FAMILIES.map((f) => {
                  const active = current.family === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => pick(f.id, current.tone)}
                      aria-label={t(`settings.themeColors.${f.id}`)}
                      aria-pressed={active}
                      title={t(`settings.themeColors.${f.id}`)}
                      data-testid={`theme-family-${f.id}`}
                      className={`h-11 rounded-xl overflow-hidden flex transition-transform ${
                        active ? "ring-2 ring-offset-2 ring-foreground/50" : "hover:scale-[1.03]"
                      }`}
                    >
                      {THEME_TONES.map((tone) => {
                        const p = findThemeColor(f.id, tone);
                        return (
                          <span
                            key={tone}
                            className="flex-1 h-full flex items-center justify-center"
                            style={{ backgroundColor: `hsl(${p.swatch})` }}
                          >
                            {active && current.tone === tone && <Check className="w-3 h-3 text-white" />}
                          </span>
                        );
                      })}
                    </button>
                  );
                })}
              </div>

              {/* 2. トーン（4）。選んでいる色の4つ */}
              <p className="text-[11px] font-bold text-muted-foreground mt-4 mb-1.5">{t("settings.themeToneLabel")}</p>
              <div className="grid grid-cols-4 gap-2" role="group" aria-label={t("settings.themeToneLabel")}>
                {THEME_TONES.map((tone) => {
                  const p = findThemeColor(current.family, tone);
                  const active = current.tone === tone;
                  return (
                    <button
                      key={tone}
                      type="button"
                      onClick={() => pick(current.family, tone)}
                      aria-label={colorName(current.family, tone)}
                      aria-pressed={active}
                      data-testid={`theme-tone-${tone}`}
                      className="flex flex-col items-center gap-1"
                    >
                      <span
                        className={`w-11 h-11 rounded-full flex items-center justify-center transition-transform ${
                          active ? "ring-2 ring-offset-2 ring-foreground/50 scale-105" : "hover:scale-105"
                        }`}
                        style={{ backgroundColor: `hsl(${p.swatch})` }}
                      >
                        {active && <Check className="w-4 h-4 text-white" />}
                      </span>
                      <span className={`text-[10px] ${active ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                        {t(`settings.themeTones.${tone}`)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ガラス仕様（すりガラス）トグル */}
              <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 text-accent shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{t("settings.glassMode")}</p>
                    <p className="text-[11px] text-muted-foreground">{t("settings.glassModeDescription")}</p>
                  </div>
                </div>
                <Switch checked={glass} onCheckedChange={handleGlass} aria-label={t("settings.glassMode")} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};

export default ThemeColorSwitcher;
