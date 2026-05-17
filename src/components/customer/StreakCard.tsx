import { Flame, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StreakCardProps {
  currentStreak: number;
  bestStreak: number;
  hasFutureBookingThisWeek: boolean;
}

const getStreakMessage = (streak: number): string => {
  if (streak >= 13) return "圧巻の継続力！トレーナーも感動しています";
  if (streak >= 9) return "3ヶ月近く継続中！もはやプロです";
  if (streak >= 5) return "素晴らしい継続力です！";
  if (streak >= 3) return "習慣になってきましたね！";
  if (streak >= 1) return "いいスタートです！";
  return "今週の来店で記録をスタートしましょう！";
};

const StreakCard = ({ currentStreak, bestStreak, hasFutureBookingThisWeek }: StreakCardProps) => {
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
                  {currentStreak}週連続トレーニング{hasFutureBookingThisWeek && currentStreak > 0 ? '継続中' : '中'}！
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {getStreakMessage(currentStreak)}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-muted-foreground">
                  {getStreakMessage(0)}
                </p>
              </>
            )}
            {bestStreak > 0 && (
              <div className="flex items-center gap-1 mt-1">
                <Trophy className="w-3 h-3 text-accent" />
                <span className="text-xs text-muted-foreground">自己ベスト：{bestStreak}週</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default StreakCard;
