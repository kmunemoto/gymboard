import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import type { SkeletalDiagnosis, SkeletalType } from "./types";

const TYPE_COLORS: Record<SkeletalType, string> = {
  straight: "hsl(174, 65%, 50%)",
  wave: "hsl(280, 45%, 55%)",
  natural: "hsl(160, 40%, 45%)",
};

type Props = {
  diagnosis: SkeletalDiagnosis | null;
};

const SkeletalTypeCard = ({ diagnosis }: Props) => {
  const { t } = useTranslation();

  if (!diagnosis) return null;

  const color = TYPE_COLORS[diagnosis.type];
  const label = t(`posture.skeletal.types.${diagnosis.type}.label`);
  const desc = t(`posture.skeletal.types.${diagnosis.type}.desc`);
  const traits = t(`posture.skeletal.types.${diagnosis.type}.traits`, { returnObjects: true }) as string[];

  return (
    <Card className="border-accent/40 bg-gradient-to-br from-accent/5 to-accent/10">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent" />
          <span className="text-sm font-bold">{t("posture.skeletal.title")}</span>
        </div>

        {/* Result badge */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-16 h-16 rounded-2xl text-white font-bold text-lg shrink-0"
            style={{ backgroundColor: color }}
          >
            {label.slice(0, 2)}
          </div>
          <div>
            <p className="text-lg font-bold" style={{ color }}>
              {t("posture.skeletal.typeLabel", { label })}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({diagnosis.confidence}%)
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </div>
        </div>

        {/* Score bars */}
        <div className="space-y-2">
          {(["straight", "wave", "natural"] as const).map((typeKey) => {
            const tLabel = t(`posture.skeletal.types.${typeKey}.label`);
            const tColor = TYPE_COLORS[typeKey];
            return (
              <div key={typeKey} className="space-y-0.5">
                <div className="flex justify-between text-xs">
                  <span className="font-medium">{tLabel}</span>
                  <span className="text-muted-foreground">{diagnosis.scores[typeKey]}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${diagnosis.scores[typeKey]}%`, backgroundColor: tColor }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Traits */}
        <div className="pt-1">
          <p className="text-xs font-semibold mb-1.5">{t("posture.skeletal.traitsTitle", { label })}</p>
          <ul className="space-y-1">
            {traits.map((trait, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                {trait}
              </li>
            ))}
          </ul>
        </div>

        {/* Metrics (collapsible details) */}
        <details className="pt-1">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
            {t("posture.skeletal.measureData")}
          </summary>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="bg-background/60 rounded-lg p-2">
              <p className="text-[10px] text-muted-foreground">{t("posture.skeletal.shoulderHipRatio")}</p>
              <p className="text-sm font-bold">{diagnosis.metrics.shoulderHipRatio}</p>
            </div>
            <div className="bg-background/60 rounded-lg p-2">
              <p className="text-[10px] text-muted-foreground">{t("posture.skeletal.upperBodyRatio")}</p>
              <p className="text-sm font-bold">{(diagnosis.metrics.upperBodyRatio * 100).toFixed(0)}%</p>
            </div>
            <div className="bg-background/60 rounded-lg p-2">
              <p className="text-[10px] text-muted-foreground">{t("posture.skeletal.limbTorsoRatio")}</p>
              <p className="text-sm font-bold">{diagnosis.metrics.limbTorsoRatio}</p>
            </div>
          </div>
        </details>

        <p className="text-[10px] text-muted-foreground">
          {t("posture.skeletal.photoDisclaimer")}
        </p>
      </CardContent>
    </Card>
  );
};

export default SkeletalTypeCard;
