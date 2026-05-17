import { Lock, type LucideIcon } from "lucide-react";

export type ChapterTheme = {
  from: string;
  to: string;
  deco: "ember" | "snow" | "bubble" | "flash" | "sand" | "dark" | "none";
};

// Map stage_number -> visual theme matching the quest world
export const CHAPTER_THEMES: Record<number, ChapterTheme> = {
  1: { from: "#374151", to: "#1F2937", deco: "none" },
  2: { from: "#065F46", to: "#4C1D95", deco: "none" },
  3: { from: "#06B6D4", to: "#0E7490", deco: "bubble" },
  4: { from: "#EA580C", to: "#DC2626", deco: "ember" },
  5: { from: "#D97706", to: "#FDE68A", deco: "sand" },
  6: { from: "#1E3A5F", to: "#0F172A", deco: "bubble" },
  7: { from: "#6366F1", to: "#F59E0B", deco: "flash" },
  8: { from: "#0A0A0A", to: "#4C1D95", deco: "dark" },
};

export const getChapterTheme = (n: number): ChapterTheme =>
  CHAPTER_THEMES[n] || { from: "#374151", to: "#1F2937", deco: "none" };

interface Props {
  stageNumber: number;
  Icon: LucideIcon;
  size?: number;
  locked?: boolean;
  completed?: boolean;
  imageUrl?: string | null;
}

const QuestBossVisual = ({ stageNumber, Icon, size = 120, locked, completed, imageUrl }: Props) => {
  const theme = getChapterTheme(stageNumber);
  const glow =
    stageNumber >= 8 ? "quest-glow-3" :
    stageNumber >= 6 ? "quest-glow-3" :
    stageNumber >= 4 ? "quest-glow-2" : "quest-glow-1";

  const showRing = stageNumber === 6 || stageNumber === 7;
  const showFinalAura = stageNumber === 8;

  const bg = locked
    ? "linear-gradient(135deg, #6b7280 0%, #374151 100%)"
    : `linear-gradient(135deg, ${theme.from} 0%, ${theme.to} 100%)`;

  const decoCls = !locked && theme.deco !== "none" ? `quest-deco quest-deco-${theme.deco}` : "";

  // Pre-positioned decoration particles
  const particles = decoCls
    ? Array.from({ length: theme.deco === "flash" ? 1 : 6 }).map((_, i) => {
        const left = `${(i * 17 + 8) % 90}%`;
        const top = theme.deco === "snow" || theme.deco === "sand"
          ? `${(i * 11) % 30}%`
          : `${50 + (i * 7) % 40}%`;
        const delay = `${(i * 0.35).toFixed(2)}s`;
        return <span key={i} style={{ left, top, animationDelay: delay }} />;
      })
    : null;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      {showFinalAura && <div className="quest-aura-final" />}
      {showRing && <div className="quest-ring" />}
      <div
        className={`relative rounded-full flex items-center justify-center ${glow}`}
        style={{ width: size, height: size, background: bg }}
      >
        {decoCls && <div className={decoCls}>{particles}</div>}
        {!locked && imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover rounded-full drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
            style={{ filter: completed ? "saturate(0.85)" : undefined }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : locked ? (
          <Lock className="text-white/90 relative" style={{ width: size * 0.4, height: size * 0.4 }} />
        ) : (
          <Icon className="text-white relative drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]" style={{ width: size * 0.4, height: size * 0.4 }} />
        )}
        {completed && (
          <div className="absolute inset-0 rounded-full bg-emerald-500/30 flex items-center justify-center">
            <span className="text-white font-bold text-sm bg-emerald-600 px-2 py-0.5 rounded-full shadow">CLEAR</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuestBossVisual;
