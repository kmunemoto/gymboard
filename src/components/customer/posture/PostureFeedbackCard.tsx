import { CheckCircle2, AlertTriangle, XCircle, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import type { PostureFeedback } from "./types";

type Props = {
  feedbacks: PostureFeedback[];
  score: number;
};

const scoreColor = (score: number) => {
  if (score >= 80) return "text-accent";
  if (score >= 60) return "text-warning";
  return "text-destructive";
};

const SeverityIcon = ({ severity }: { severity: string }) => {
  switch (severity) {
    case "good":
      return <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-accent" />;
    case "warning":
      return <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />;
    case "bad":
      return <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />;
    default:
      return null;
  }
};

const PostureFeedbackCard = ({ feedbacks, score }: Props) => {
  const { t } = useTranslation();

  const scoreLabel = (s: number) => {
    if (s >= 90) return t("posture.feedback.scoreVeryGood");
    if (s >= 80) return t("posture.feedback.scoreGood");
    if (s >= 60) return t("posture.feedback.scoreOk");
    return t("posture.feedback.scoreBad");
  };

  if (feedbacks.length === 0) return null;

  return (
    <Card className="border-accent/40">
      <CardContent className="p-4 space-y-4">
        {/* Score header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="w-4 h-4 text-accent" />
            <span>{t("posture.feedback.title")}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-muted/40 rounded-xl p-3">
          <div className={`text-3xl font-bold ${scoreColor(score)}`}>
            {score}<span className="text-base font-normal">{t("posture.feedback.scoreUnit")}</span>
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold">{t("posture.feedback.scoreLabel")}</p>
            <p className="text-[11px] text-muted-foreground">{scoreLabel(score)}</p>
          </div>
          {/* Mini bar */}
          <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${score}%`,
                backgroundColor: score >= 80 ? "hsl(var(--accent))" : score >= 60 ? "hsl(var(--warning, 38 92% 50%))" : "hsl(var(--destructive))",
              }}
            />
          </div>
        </div>

        {/* Feedback list */}
        <ul className="space-y-3">
          {feedbacks.map((fb, i) => (
            <li key={i} className="space-y-1">
              <div className="flex items-start gap-2 text-sm">
                <SeverityIcon severity={fb.severity} />
                <div className="flex-1">
                  <span className="font-semibold text-xs">{fb.category}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">{fb.message}</p>
                  {fb.exercises && fb.exercises.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {fb.exercises.map((ex) => (
                        <span key={ex} className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
                          {ex}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

export default PostureFeedbackCard;
