import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface MilestoneGoalCardProps {
  milestoneGoal?: string | null;
}

// お客様側はオプトイン: 中目標(milestone_goal)が未設定のお客様には
// 見出し・空状態メッセージを含め、一切何も表示しない。
const MilestoneGoalCard = ({ milestoneGoal }: MilestoneGoalCardProps) => {
  const { t } = useTranslation();
  if (!milestoneGoal) return null;

  return (
    <Card className="border-l-4 border-l-accent">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
            <Target className="w-5 h-5 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {t("home.milestoneGoalLabel")}
            </p>
            <p className="text-sm font-medium mt-1 whitespace-pre-wrap break-all leading-relaxed">
              {milestoneGoal}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MilestoneGoalCard;
