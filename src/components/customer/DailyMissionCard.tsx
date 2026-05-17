import { Card, CardContent } from "@/components/ui/card";
import { Check, Loader2, Target } from "lucide-react";
import RenderIcon from "@/components/RenderIcon";
import { Gift } from "lucide-react";
import { useDailyMissions } from "@/hooks/useDailyMissions";
import { getMissionDef, MISSION_BONUS_EXP } from "@/lib/missionSystem";

const TIFFANY = "hsl(174, 65%, 50%)";

const DailyMissionCard = () => {
  const { mission, hasBookingToday, loading } = useDailyMissions();

  const shouldShow = hasBookingToday;
  if (!shouldShow || loading || !mission) {
    if (loading && shouldShow) {
      return (
        <Card>
          <CardContent className="p-3 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  const completed = new Set(mission.completed_keys || []);
  const remaining = mission.mission_keys.filter((k) => !completed.has(k)).length;
  const allDone = mission.all_completed;

  return (
    <>
      <style>{`
        @keyframes mission-sparkle {
          0%, 100% { box-shadow: 0 0 0 rgba(212,175,55,0); }
          50% { box-shadow: 0 0 24px rgba(212,175,55,0.6); }
        }
        .mission-complete-glow { animation: mission-sparkle 2s ease-in-out infinite; }
      `}</style>
      <Card className={allDone ? "mission-complete-glow border-amber-300" : ""}>
        <CardContent className="p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Target className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-bold">今日のミッション</h3>
          </div>
          <div className="space-y-2">
            {mission.mission_keys.map((key) => {
              const def = getMissionDef(key);
              if (!def) return null;
              const done = completed.has(key);
              return (
                <div
                  key={key}
                  className="rounded-lg px-3 py-2 transition"
                  style={done ? { backgroundColor: "rgba(10, 186, 181, 0.05)" } : { backgroundColor: "transparent" }}
                >
                  <div className="flex items-center gap-2">
                    {done ? (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: TIFFANY }}
                      >
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-muted flex-shrink-0" />
                    )}
                    <span
                      className="text-sm font-bold flex-1 flex items-center gap-1.5"
                      style={{ color: done ? TIFFANY : undefined }}
                    >
                      <RenderIcon name={def.icon} size={14} color={done ? TIFFANY : "#666"} />
                      {def.name}
                    </span>
                    <span
                      className="text-xs font-bold"
                      style={{ color: done ? TIFFANY : "#999" }}
                    >
                      +{def.exp} EXP
                    </span>
                  </div>
                  <p
                    className="text-[12px] pl-7 mt-0.5"
                    style={{ color: done ? TIFFANY : "#999" }}
                  >
                    {def.description}
                  </p>
                </div>
              );
            })}
          </div>
          <div
            className="mt-3 pt-3 border-t flex items-center justify-between"
            style={{ borderColor: "rgba(0,0,0,0.06)" }}
          >
            <span className="text-xs font-bold flex items-center gap-1"><Gift className="w-3.5 h-3.5" />全達成ボーナス</span>
            {allDone ? (
              <span className="text-xs font-extrabold" style={{ color: "#D4AF37", fontWeight: 800 }}>
                COMPLETE! +{MISSION_BONUS_EXP} EXP
              </span>
            ) : (
              <span className="text-xs font-bold text-muted-foreground">
                +{MISSION_BONUS_EXP} EXP（あと{remaining}つ！）
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
};

export default DailyMissionCard;