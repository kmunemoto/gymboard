import { Dumbbell, Target, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import type { SkeletalType, PostureFeedback } from "./types";

type TrainingTip = {
  area: string;
  exercises: string[];
  reason: string;
};

type RecommendationData = {
  summary: string;
  tips: TrainingTip[];
};

const TYPE_COLORS: Record<SkeletalType, string> = {
  straight: "hsl(174, 65%, 50%)",
  wave: "hsl(280, 45%, 55%)",
  natural: "hsl(160, 40%, 45%)",
};

type Props = {
  skeletalType: SkeletalType | null;
  feedbacks?: PostureFeedback[];
};

const TrainingRecommendationCard = ({ skeletalType, feedbacks = [] }: Props) => {
  const { t } = useTranslation();

  if (!skeletalType) return null;

  const color = TYPE_COLORS[skeletalType];

  const rec: RecommendationData = {
    summary: t(`posture.recommendation.types.${skeletalType}.summary`),
    tips: t(`posture.recommendation.types.${skeletalType}.tips`, { returnObjects: true }) as TrainingTip[],
  };

  const POSTURE_EXERCISES: Record<string, TrainingTip> = {
    "頭部の前傾（ストレートネック）": t("posture.recommendation.postureExercises.straightNeck", { returnObjects: true }) as TrainingTip,
    "猫背（胸椎の丸まり）": t("posture.recommendation.postureExercises.roundedBack", { returnObjects: true }) as TrainingTip,
    "骨盤の前傾/後傾": t("posture.recommendation.postureExercises.pelvicTilt", { returnObjects: true }) as TrainingTip,
  };

  // Build posture-based extra tips from warnings/bad feedbacks
  const postureTips: TrainingTip[] = [];
  for (const fb of feedbacks) {
    if (fb.severity !== "good" && POSTURE_EXERCISES[fb.category]) {
      postureTips.push(POSTURE_EXERCISES[fb.category]);
    }
  }

  return (
    <Card className="border-accent/30">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-accent" />
          <span className="text-sm font-bold">{t("posture.recommendation.title")}</span>
        </div>

        <p className="text-xs text-muted-foreground">{rec.summary}</p>

        <div className="space-y-3">
          {rec.tips.map((tip, i) => (
            <div key={i} className="bg-muted/40 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Dumbbell className="w-3.5 h-3.5 shrink-0" style={{ color }} />
                <span className="text-xs font-bold">{tip.area}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tip.exercises.map((ex) => (
                  <span key={ex} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${color}20`, color }}>
                    {ex}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{tip.reason}</p>
            </div>
          ))}
        </div>

        {/* Posture-based additional exercises */}
        {postureTips.length > 0 && (
          <>
            <div className="flex items-center gap-2 pt-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <span className="text-xs font-bold">{t("posture.recommendation.postureExerciseTitle")}</span>
            </div>
            <div className="space-y-3">
              {postureTips.map((tip, i) => (
                <div key={`posture-${i}`} className="bg-warning/5 border border-warning/20 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Dumbbell className="w-3.5 h-3.5 shrink-0 text-warning" />
                    <span className="text-xs font-bold">{tip.area}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tip.exercises.map((ex) => (
                      <span key={ex} className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-warning/10 text-warning">
                        {ex}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{tip.reason}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default TrainingRecommendationCard;
