import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Flag, MapPin, Mountain, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useWeightJourney, checkWeightMilestones } from "@/hooks/useWeightJourney";
import { useMeasurements } from "@/hooks/useMeasurements";
import { useAvatar } from "@/hooks/useAvatar";
import { getRankInfo } from "@/lib/avatarSystem";
import { toast } from "sonner";

interface Checkpoint {
  kg: number;          // kg lost at this point
  label: string;
}

function computeCheckpoints(totalGoalKg: number): Checkpoint[] {
  if (totalGoalKg <= 0) return [];
  const cps: Checkpoint[] = [];
  if (totalGoalKg <= 5) {
    for (let k = 1; k <= Math.floor(totalGoalKg); k++) {
      cps.push({ kg: k, label: `-${k}kg` });
    }
  } else if (totalGoalKg < 10) {
    [1, 3, 5].forEach((k) => {
      if (k < totalGoalKg) cps.push({ kg: k, label: `-${k}kg` });
    });
  } else {
    const half = Math.round((totalGoalKg / 2) * 10) / 10;
    [1, 3, 5, half].forEach((k) => {
      if (k < totalGoalKg) cps.push({ kg: k, label: `-${k}kg` });
    });
  }
  cps.push({ kg: totalGoalKg, label: "ゴール" });
  // dedupe by kg
  const seen = new Set<number>();
  return cps.filter((c) => {
    if (seen.has(c.kg)) return false;
    seen.add(c.kg);
    return true;
  });
}

const WeightJourneyMapCard = () => {
  const { user } = useAuth();
  const { journey, milestones, loading, refetch } = useWeightJourney(user?.id);
  const { latest, loading: mLoading } = useMeasurements(user?.id);
  const { avatar } = useAvatar(false);
  const checkedRef = useRef(false);

  // Auto-evaluate milestones when latest weight is available
  useEffect(() => {
    if (!user || !journey || !latest?.weight || checkedRef.current) return;
    checkedRef.current = true;
    (async () => {
      const res = await checkWeightMilestones(user.id);
      if (res?.granted && res.granted.length > 0) {
        for (const g of res.granted) {
          // toast suppressed: badge unlock notifications hidden
        }
        await refetch();
      }
    })();
  }, [user, journey, latest, refetch]);

  const totalGoalForMemo = journey ? Number(journey.start_weight) - Number(journey.target_weight) : 0;
  const checkpoints = useMemo(() => computeCheckpoints(totalGoalForMemo), [totalGoalForMemo]);

  if (loading || mLoading || !journey) return null;

  const startW = Number(journey.start_weight);
  const targetW = Number(journey.target_weight);
  const totalGoal = startW - targetW;
  const currentW = latest?.weight != null ? Number(latest.weight) : null;

  if (totalGoal <= 0) return null;

  const lost = currentW != null ? Math.max(0, startW - currentW) : 0;
  const progress = currentW != null ? Math.min(100, Math.max(0, (lost / totalGoal) * 100)) : 0;
  const remaining = currentW != null ? Math.max(0, currentW - targetW) : totalGoal;

  // Avatar image
  const gender = (avatar?.gender as "male" | "female") ?? "female";
  const hairColor = (avatar?.hair_color as any) ?? "orange";
  const level = avatar?.level ?? 1;
  const avatarImg = getRankInfo(level, gender, hairColor).image;

  // Map % progress -> position on SVG path. y goes from bottom (start) to top (goal).
  // We'll use percentage of height, where 0% = start (bottom-left), 100% = top (mountain peak)
  const HEIGHT = 280;
  const PADDING_BOTTOM = 32;
  const PADDING_TOP = 28;
  const usableH = HEIGHT - PADDING_BOTTOM - PADDING_TOP;

  const yForPercent = (p: number) => PADDING_TOP + (1 - p / 100) * usableH;
  // Slope: x goes from ~12% (bottom-left) to ~52% (peak center)
  const xForPercent = (p: number) => 12 + (p / 100) * 40;

  const avatarX = xForPercent(progress);
  const avatarY = yForPercent(progress);

  return (
    <Card className="overflow-hidden border-0 shadow-md">
      <CardContent className="p-0">
        {/* Header */}
        <div className="px-4 pt-4 pb-2 bg-gradient-to-r from-sky-100 to-sky-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Mountain className="w-4 h-4 text-accent" />
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                ダイエットジャーニー
              </span>
            </div>
            <span className="text-[11px] font-bold text-accent">{progress.toFixed(0)}%</span>
          </div>
          <p className="mt-1 text-2xl font-extrabold text-foreground">
            目標まであと <span className="text-accent">{remaining.toFixed(1)}</span>
            <span className="text-base ml-1">kg</span>
          </p>
        </div>

        {/* Mountain map */}
        <div
          className="relative w-full"
          style={{
            height: HEIGHT,
            background:
              "linear-gradient(to bottom, hsl(200, 90%, 92%) 0%, hsl(200, 80%, 88%) 40%, hsl(120, 35%, 80%) 75%, hsl(100, 30%, 72%) 100%)",
          }}
        >
          {/* Sun */}
          <div
            className="absolute rounded-full"
            style={{
              top: 14,
              right: 24,
              width: 36,
              height: 36,
              background: "radial-gradient(circle, hsl(45, 100%, 75%), hsl(35, 100%, 65%))",
              boxShadow: "0 0 24px hsl(45, 100%, 70%, 0.6)",
            }}
          />

          {/* Mountain SVG */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
          >
            {/* Back mountain */}
            <polygon
              points="55,15 95,95 15,95"
              fill="hsl(35, 25%, 55%)"
              opacity="0.5"
            />
            {/* Front mountain */}
            <polygon
              points="50,10 90,95 10,95"
              fill="url(#mountainGrad)"
            />
            {/* Snow cap */}
            <polygon
              points="50,10 58,26 42,26"
              fill="hsl(0, 0%, 98%)"
              opacity="0.9"
            />
            <defs>
              <linearGradient id="mountainGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(30, 30%, 65%)" />
                <stop offset="100%" stopColor="hsl(30, 25%, 45%)" />
              </linearGradient>
            </defs>
          </svg>

          {/* Goal flag at peak */}
          <div
            className="absolute flex flex-col items-center"
            style={{ left: "50%", top: PADDING_TOP - 24, transform: "translateX(-50%)" }}
          >
            <Flag
              className="w-6 h-6"
              style={{ color: "hsl(174, 65%, 50%)", fill: "hsl(174, 65%, 50%)" }}
            />
            <span className="text-[10px] font-bold text-foreground bg-white/80 px-1.5 py-0.5 rounded mt-0.5 whitespace-nowrap">
              目標 {targetW.toFixed(1)}kg
            </span>
          </div>

          {/* Checkpoints */}
          {checkpoints.map((cp, idx) => {
            const cpPercent = (cp.kg / totalGoal) * 100;
            if (cpPercent >= 99) return null; // skip goal (already drawn)
            const isAchieved = lost >= cp.kg;
            const left = `${xForPercent(cpPercent)}%`;
            const top = yForPercent(cpPercent);
            return (
              <div
                key={idx}
                className="absolute flex flex-col items-center"
                style={{ left, top, transform: "translate(-50%, -50%)" }}
              >
                <div className="relative">
                  <Flag
                    className="w-4 h-4"
                    style={{
                      color: isAchieved ? "hsl(174, 65%, 50%)" : "hsl(0, 0%, 60%)",
                      fill: isAchieved ? "hsl(174, 65%, 50%)" : "hsl(0, 0%, 75%)",
                    }}
                  />
                  {isAchieved && (
                    <Sparkles
                      className="w-3 h-3 absolute -top-1 -right-2 text-yellow-400 animate-pulse"
                    />
                  )}
                </div>
                <span
                  className={`text-[9px] font-bold mt-0.5 px-1 rounded whitespace-nowrap ${
                    isAchieved ? "bg-accent/20 text-accent" : "bg-white/70 text-muted-foreground"
                  }`}
                >
                  {cp.label}
                </span>
              </div>
            );
          })}

          {/* Avatar climbing */}
          {currentW != null && (
            <div
              className="absolute flex flex-col items-center transition-all duration-700 ease-out"
              style={{
                left: `${avatarX}%`,
                top: avatarY,
                transform: "translate(-50%, -100%)",
                zIndex: 10,
              }}
            >
              <div
                className="w-12 h-12 rounded-full overflow-hidden border-2 border-white shadow-lg bg-white"
              >
                <img
                  src={avatarImg}
                  alt="avatar"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/placeholder.svg";
                  }}
                />
              </div>
              <span className="mt-1 text-[10px] font-extrabold bg-foreground text-background px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                {currentW.toFixed(1)}kg
              </span>
            </div>
          )}

          {/* Start marker */}
          <div
            className="absolute flex items-center gap-1"
            style={{ left: 8, bottom: 6 }}
          >
            <MapPin className="w-3.5 h-3.5 text-foreground" />
            <span className="text-[10px] font-bold text-foreground bg-white/80 px-1 rounded">
              スタート {startW.toFixed(1)}kg
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-4 py-3 bg-background">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-muted-foreground">
              {lost > 0 ? `-${lost.toFixed(1)}kg` : "0.0kg"} / 目標 -{totalGoal.toFixed(1)}kg
            </span>
            <span className="text-[11px] font-bold text-accent">{progress.toFixed(0)}% 達成</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(to right, hsl(174, 65%, 60%), hsl(174, 65%, 45%))",
              }}
            />
          </div>
          {currentW == null && (
            <p className="mt-2 text-[11px] text-muted-foreground text-center">
              体重を記録するとアバターが山を登ります
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default WeightJourneyMapCard;
