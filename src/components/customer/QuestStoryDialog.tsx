import { useEffect } from "react";
import { X, Heart, Swords, Shield as ShieldIcon, Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import QuestBossVisual, { getChapterTheme } from "./QuestBossVisual";

interface Props {
  open: boolean;
  onClose: () => void;
  stageNumber: number;
  stageName: string;
  storyText: string;
  bossName?: string;
  bossHp?: number;
  bossAtk?: number;
  bossDef?: number;
  Icon: LucideIcon;
  locked?: boolean;
  completed?: boolean;
  curHp?: number;
  bossImageUrl?: string | null;
  backgroundImageUrl?: string | null;
}

const QuestStoryDialog = ({
  open, onClose, stageNumber, stageName, storyText,
  bossName, bossHp, bossAtk, bossDef, Icon, locked, completed, curHp,
  bossImageUrl, backgroundImageUrl,
}: Props) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  const theme = getChapterTheme(stageNumber);
  const headerBg = `linear-gradient(135deg, ${theme.from} 0%, ${theme.to} 100%)`;
  const hpPct = bossHp ? Math.max(0, ((curHp ?? bossHp) / bossHp) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative px-5 py-6 text-white overflow-hidden" style={{ background: headerBg }}>
          {!locked && backgroundImageUrl && (
            <>
              <img
                src={backgroundImageUrl}
                alt=""
                aria-hidden
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />
            </>
          )}
          <div className="relative">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/30 flex items-center justify-center"
            aria-label="閉じる"
          >
            <X className="w-4 h-4" />
          </button>
          <p className="text-[11px] font-bold tracking-widest opacity-80">第{stageNumber}章</p>
          <h2 className="text-xl font-bold mt-1 break-all">{locked ? "？？？" : stageName}</h2>

          <div className="flex justify-center mt-4">
            <QuestBossVisual stageNumber={stageNumber} Icon={locked ? Lock : Icon} locked={locked} completed={completed} imageUrl={bossImageUrl} />
          </div>
          {!locked && bossName && (
            <p className="text-center font-bold mt-3 break-all">{bossName}</p>
          )}
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          {locked ? (
            <p className="text-sm text-muted-foreground text-center leading-relaxed">
              この章はまだ封印されている。<br />前の章のボスを倒して道を切り開け。
            </p>
          ) : (
            <>
              {bossHp != null && bossAtk != null && bossDef != null && (
                <>
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="opacity-70 font-bold">ボスHP</span>
                      <span className="font-bold">{(curHp ?? bossHp).toLocaleString()} / {bossHp.toLocaleString()}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full transition-all duration-700" style={{ width: `${hpPct}%`, background: "#ef4444" }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { l: "HP", v: bossHp, c: "#0ABAB5", I: Heart },
                      { l: "ATK", v: bossAtk, c: "#ef4444", I: Swords },
                      { l: "DEF", v: bossDef, c: "#3b82f6", I: ShieldIcon },
                    ].map((s) => (
                      <div key={s.l} className="rounded-xl bg-secondary/50 p-2">
                        <div className="flex items-center justify-center gap-1 mb-0.5">
                          <s.I className="w-3 h-3" style={{ color: s.c }} />
                          <span className="text-[10px] font-bold opacity-70">{s.l}</span>
                        </div>
                        <p className="text-sm font-bold leading-none">{s.v.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="rounded-xl bg-secondary/40 p-3">
                <p className="text-[11px] font-bold opacity-70 mb-1">物語</p>
                <p className="text-sm leading-relaxed break-all whitespace-pre-wrap">{storyText}</p>
              </div>
            </>
          )}
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-foreground text-background font-bold text-sm"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuestStoryDialog;
