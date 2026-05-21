import { useTranslation } from "react-i18next";
import { Flame, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StreakCardProps {
  currentStreak: number;
  bestStreak: number;
  hasFutureBookingThisWeek: boolean;
}

const getStreakMessageKey = (streak: number): string => {
  if (streak >= 13) return "streak.msg13";
  if (streak >= 9) return "streak.msg9";
  if (streak >= 5) return "streak.msg5";
  if (streak >= 3) return "streak.msg3";
  if (streak >= 1) return "streak.msg1";
  return "streak.msg0";
};

const StreakCard = ({ currentStreak, bestStreak, hasFutureBookingThisWeek }: StreakCardProps) => {
  const { t } = useTranslation();
  const isActive = currentStreak > 0;

  return (
    <Card className={`border-l-4 ${isActive ? 'border-l-orange-500 bg-orange-50 dark:bg-orange-950/20' : 'border-l-muted'}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isActive ? 'bg-orange-100 dark:bg-orange-900/30' : 'bg-muted'}`}>
            <Flame className={`w-6 h-6 ${isActive ? 'text-orange-500' : 'text-muted-foreground'}`} />
          </div>
          <div className="flex-1">
            {isActive ? (
              <>
                <p className="text-lg font-extrabold flex items-center gap-1.5">
                  <Flame className="w-5 h-5 text-orange-500" />
                  {t(
                    hasFutureBookingThisWeek && currentStreak > 0 ? 'streak.weeksActive' : 'streak.weeksOngoing',
                    { count: currentStreak } as any
                  ) as string}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t(getStreakMessageKey(currentStreak))}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-muted-foreground">
                  {t(getStreakMessageKey(0))}
                </p>
              </>
            )}
            {bestStreak > 0 && (
              <div className="flex items-center gap-1 mt-1">
                <Trophy className="w-3 h-3 text-accent" />
                <span className="text-xs text-muted-foreground">{t('streak.bestRecord', { count: bestStreak } as any) as string}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default StreakCard;
