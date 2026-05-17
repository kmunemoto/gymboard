import { Card, CardContent } from "@/components/ui/card";
import { useSeasonEvents } from "@/hooks/useSeasonEvents";
import { differenceInDays, parseISO } from "date-fns";
import { Check, Sparkles, Gift } from "lucide-react";
import RenderIcon from "@/components/RenderIcon";
import { getJSTToday } from "@/lib/timezone";

const TIFFANY = "hsl(174, 65%, 50%)";

const SeasonEventCard = () => {
  const { bundles, loading } = useSeasonEvents();
  if (loading || bundles.length === 0) return null;
  const today = getJSTToday();

  return (
    <>
      <style>{`
        @keyframes event-sparkle {
          0%, 100% { box-shadow: 0 0 0 rgba(212,175,55,0); }
          50% { box-shadow: 0 0 24px rgba(212,175,55,0.6); }
        }
        .event-complete-glow { animation: event-sparkle 2s ease-in-out infinite; }
      `}</style>
      <div className="space-y-3">
        {bundles.map(({ event, tasks, progress, completed }) => {
          const remaining = Math.max(0, differenceInDays(parseISO(event.end_date), parseISO(today)));
          const totalTasks = tasks.length;
          const doneTasks = tasks.filter((t) => progress[t.id]?.completed).length;
          return (
            <Card key={event.id} className={completed ? "event-complete-glow border-amber-300" : ""}>
              <CardContent className="p-4">
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="text-sm font-extrabold flex items-center gap-1.5">
                    <RenderIcon name={event.event_icon} size={16} color={TIFFANY} />
                    {event.event_name}
                  </h3>
                  {completed && (
                    <span className="text-[11px] font-extrabold flex items-center gap-1" style={{ color: "#D4AF37" }}>
                      <Sparkles className="w-3 h-3" /> COMPLETE!
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mb-3">
                  {event.start_date.replace(/-/g, "/")}〜{event.end_date.replace(/-/g, "/")} 残り{remaining}日
                </p>

                <div className="space-y-2">
                  {tasks.map((t) => {
                    const p = progress[t.id];
                    const done = p?.completed;
                    const cur = Math.min(p?.current_value || 0, t.target_value);
                    const pct = Math.round((cur / t.target_value) * 100);
                    return (
                      <div key={t.id}>
                        <div className="flex items-center gap-2">
                          {done ? (
                            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TIFFANY }}>
                              <Check className="w-3 h-3 text-white" strokeWidth={3} />
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-full border-2 border-muted flex-shrink-0" />
                          )}
                          <span className="text-sm font-bold flex-1 flex items-center gap-1.5" style={{ color: done ? TIFFANY : undefined }}>
                            <RenderIcon name={t.task_icon} size={14} color={done ? TIFFANY : "#666"} />
                            {t.task_name}
                          </span>
                          <span className="text-[11px] font-bold" style={{ color: done ? TIFFANY : "#999" }}>
                            {cur.toLocaleString()}/{t.target_value.toLocaleString()}
                          </span>
                        </div>
                        {!done && (
                          <div className="ml-7 mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: TIFFANY }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 pt-3 border-t text-[11px] space-y-0.5" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
                  <p className="font-bold flex items-center gap-1"><Gift className="w-3.5 h-3.5" />完走報酬: {event.reward_exp} EXP + {event.reward_coins}コイン</p>
                  {event.badge_name && (
                    <p className="flex items-center gap-1">＋限定バッジ「{event.badge_name}」<RenderIcon name={event.badge_icon} size={12} /></p>
                  )}
                  <p className="text-muted-foreground">進捗: {doneTasks}/{totalTasks} タスク完了</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
};

export default SeasonEventCard;