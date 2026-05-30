import { useTranslation } from "react-i18next";
import { Languages, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import i18n, { SUPPORTED_LANGUAGES, SupportedLanguage } from "@/lib/i18n";

const LANGUAGE_OPTIONS: { code: SupportedLanguage; nativeLabel: string; subLabel: string }[] = [
  { code: "ja", nativeLabel: "日本語", subLabel: "Japanese" },
  { code: "en", nativeLabel: "English", subLabel: "英語" },
  { code: "ko", nativeLabel: "한국어", subLabel: "Korean" },
];

interface LanguageSwitcherProps {
  variant?: "customer" | "trainer";
}

const LanguageSwitcher = ({ variant = "customer" }: LanguageSwitcherProps) => {
  const { t } = useTranslation();
  const currentLang = (i18n.resolvedLanguage || i18n.language || "ja").split("-")[0];

  const handleChange = (lng: SupportedLanguage) => {
    if (lng === currentLang) return;
    i18n.changeLanguage(lng);
    try {
      localStorage.setItem("i18nextLng", lng);
    } catch {
      // ignore
    }
  };

  return (
    <section>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <Languages className="w-3.5 h-3.5" />
        {t("settings.language")} / Language
      </h2>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-accent/10">
              <Languages className="w-4 h-4 text-accent" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold">{t("settings.language")}</p>
              <p className="text-[11px] text-muted-foreground mb-3">
                {t("settings.languageDescription")}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {SUPPORTED_LANGUAGES.map((code) => {
                  const opt = LANGUAGE_OPTIONS.find((o) => o.code === code)!;
                  const active = currentLang === code;
                  return (
                    <Button
                      key={code}
                      type="button"
                      variant="outline"
                      onClick={() => handleChange(code)}
                      className={cn(
                        "h-auto py-2.5 px-3 justify-between text-left",
                        active && "border-accent bg-accent/5 text-foreground"
                      )}
                    >
                      <span className="flex flex-col items-start">
                        <span className="text-sm font-bold leading-tight">{opt.nativeLabel}</span>
                        <span className="text-[10px] text-muted-foreground leading-tight">{opt.subLabel}</span>
                      </span>
                      {active && <Check className="w-4 h-4 text-accent shrink-0" />}
                    </Button>
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

export default LanguageSwitcher;
