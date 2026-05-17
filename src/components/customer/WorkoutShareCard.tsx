import { forwardRef } from "react";
import { useGymSettings } from "@/hooks/useGymSettings";
import { formatShareDate, type WorkoutSession } from "@/lib/workoutShare";
import { ACHIEVEMENTS } from "@/lib/avatarSystem";
import { getAchievementIconComponent } from "./BadgeIcon";

export type ShareTheme = "dark" | "light" | "transparent";

interface Props {
  session: WorkoutSession;
  theme: ShareTheme;
  streakWeeks: number;
  totalSessions: number;
  featuredBadges?: string[];
}

const WorkoutShareCard = forwardRef<HTMLDivElement, Props>(
  ({ session, theme, featuredBadges }, ref) => {
    const { settings } = useGymSettings();

    const isLight = theme === "light";
    const isTransparent = theme === "transparent";

    // Color palette per theme
    const bg = isTransparent ? "transparent" : isLight ? "#FAF9F6" : "#0F0F0F";
    const nameColor = isTransparent ? "#FFFFFF" : isLight ? "#111111" : "#FFFFFF";
    const valueColor = isTransparent
      ? "rgba(255,255,255,0.85)"
      : isLight
        ? "#777777"
        : "#888888";
    const subtleColor = isTransparent
      ? "rgba(255,255,255,0.75)"
      : isLight
        ? "#999999"
        : "#666666";
    const accent = "#0ABAB5";

    const shadow = isTransparent
      ? "0 2px 8px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.6)"
      : "none";

    const dateStr = formatShareDate(session.date);
    const visibleExercises = session.exercises.slice(0, 6);
    const hiddenCount = session.exercises.length - visibleExercises.length;

    return (
      <div
        ref={ref}
        id="share-card-content"
        style={{
          width: 1080,
          height: 1920,
          background: bg,
          fontFamily:
            "'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif",
          padding: "200px 100px 140px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          boxSizing: "border-box",
          textShadow: shadow,
        }}
      >
        {/* Time */}
        <div style={{ marginBottom: 90 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 300,
              letterSpacing: "0.3em",
              color: subtleColor,
              marginBottom: 18,
            }}
          >
            トレーニング時間
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 500,
              lineHeight: 1,
              color: nameColor,
              letterSpacing: "0.02em",
            }}
          >
            {session.durationMin}
            <span
              style={{
                fontSize: 36,
                fontWeight: 300,
                marginLeft: 8,
                color: subtleColor,
              }}
            >
              分
            </span>
          </div>
        </div>

        {/* Exercises */}
        {visibleExercises.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 44,
              marginBottom: 90,
            }}
          >
            {visibleExercises.map((ex) => (
              <div key={ex.exercise_id}>
                <div
                  style={{
                    fontSize: 38,
                    fontWeight: 500,
                    color: nameColor,
                    lineHeight: 1.2,
                    marginBottom: 10,
                  }}
                >
                  {ex.exercise_name}
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 400,
                    color: valueColor,
                    letterSpacing: "0.04em",
                  }}
                >
                  {ex.maxWeight}kg <span style={{ margin: "0 6px" }}>×</span> {ex.totalReps}
                </div>
              </div>
            ))}
            {hiddenCount > 0 && (
              <div style={{ fontSize: 22, color: subtleColor, fontWeight: 300 }}>
                +{hiddenCount} more
              </div>
            )}
          </div>
        )}

        {/* Date */}
        <div
          style={{
            fontSize: 22,
            fontWeight: 300,
            letterSpacing: "0.25em",
            color: subtleColor,
          }}
        >
          {dateStr}
        </div>

        {featuredBadges && featuredBadges.length > 0 && (
          <div style={{ display: "flex", gap: 16, marginTop: 32 }}>
            {featuredBadges.slice(0, 3).map((k) => {
              const def = ACHIEVEMENTS.find((a) => a.key === k);
              const Icon = getAchievementIconComponent(k);
              const color = def?.rarity === "epic" ? "#D4AF37" : def?.rarity === "rare" ? "#0ABAB5" : nameColor;
              return (
                <div
                  key={k}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    border: `2px solid ${color}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isTransparent ? "rgba(255,255,255,0.08)" : isLight ? "#FFFFFF" : "rgba(255,255,255,0.06)",
                  }}
                >
                  <Icon size={28} color={color} />
                </div>
              );
            })}
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Footer logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {settings?.logo_url && (
            <img
              src={settings.logo_url}
              alt=""
              crossOrigin="anonymous"
              style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 8 }}
            />
          )}
          <div style={{ textAlign: "left" }}>
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "0.02em",
              }}
            >
              <span style={{ color: accent }}>Salute</span>
              <span style={{ color: nameColor, marginLeft: 8 }}>御所南</span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: subtleColor,
                fontWeight: 300,
                letterSpacing: "0.45em",
                marginTop: 6,
              }}
            >
              PERSONAL GYM
            </div>
          </div>
        </div>
      </div>
    );
  }
);

WorkoutShareCard.displayName = "WorkoutShareCard";

export default WorkoutShareCard;
