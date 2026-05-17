import { useEffect, useState } from "react";
import { Coins, Sparkles, Trophy, Award, X, Shield as ShieldIcon, Gem } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getQuestIcon } from "@/lib/questIcons";
import { getTitleDef } from "@/lib/titleSystem";
import type { QuestStage } from "@/hooks/useQuestProgress";

const STAGE_EQUIPMENT: Record<number, { name: string; type: "shield" | "amulet"; rarity: "rare" | "epic" | "legendary"; image: string }> = {
  3: { name: "氷の盾", type: "shield", rarity: "rare", image: "/equipment/shield_ice.png" },
  4: { name: "森の護符", type: "amulet", rarity: "rare", image: "/equipment/amulet_forest.png" },
  7: { name: "嵐の障壁", type: "shield", rarity: "epic", image: "/equipment/shield_storm.png" },
  8: { name: "光の王冠", type: "amulet", rarity: "legendary", image: "/equipment/amulet_crown.png" },
};

const RARITY_COLOR: Record<string, string> = {
  rare: "#3b82f6",
  epic: "#8b5cf6",
  legendary: "#f59e0b",
};

interface Props {
  stage: QuestStage;
  nextStage?: QuestStage;
  open: boolean;
  onClose: () => void;
}

const QuestStageClearDialog = ({ stage, nextStage, open, onClose }: Props) => {
  const [phase, setPhase] = useState<"flash" | "complete" | "intro">("flash");

  useEffect(() => {
    if (!open) return;
    setPhase("flash");
    const t1 = setTimeout(() => setPhase("complete"), 1200);
    return () => clearTimeout(t1);
  }, [open]);

  if (!open) return null;

  const titleDef = stage.reward_title ? getTitleDef(stage.reward_title) : null;
  const Icon = getQuestIcon(stage.theme_icon);
  const equipReward = STAGE_EQUIPMENT[stage.stage_number];

  const bgComplete = `linear-gradient(135deg, ${stage.theme_gradient_from} 0%, ${stage.theme_gradient_to} 100%)`;
  const bgIntro = nextStage
    ? `linear-gradient(135deg, ${nextStage.theme_dark_from} 0%, ${nextStage.theme_dark_to} 100%)`
    : bgComplete;

  const bg = phase === "intro" ? bgIntro : bgComplete;
  const isFinal = stage.stage_number === 8;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-700"
      style={{ background: bg }}
    >
      {/* Flash overlay */}
      {phase === "flash" && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${stage.theme_gradient_from} 0%, transparent 70%)`,
            animation: "questFlash 1.2s ease-out",
          }}
        />
      )}

      {/* Particle effect for stage 8 */}
      {isFinal && phase === "complete" && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="absolute w-2 h-2 rounded-full bg-yellow-300"
              style={{
                left: `${(i * 17) % 100}%`,
                top: `${(i * 23) % 100}%`,
                animation: `questParticle ${2 + (i % 3)}s ease-in-out ${i * 0.1}s infinite`,
                boxShadow: "0 0 12px rgba(253, 224, 71, 0.9)",
              }}
            />
          ))}
        </div>
      )}

      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white"
        aria-label="閉じる"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="relative max-w-sm w-full text-white text-center space-y-6 fade-in">
        {phase !== "intro" ? (
          <>
            <div className="space-y-2">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-white/25 backdrop-blur flex items-center justify-center">
                <Icon className="w-10 h-10" />
              </div>
              <p className="text-xs font-bold tracking-widest opacity-80">第{stage.stage_number}章 復興完了</p>
              <h2 className="text-2xl font-bold">{stage.name}</h2>
              {isFinal && (
                <p className="text-lg font-bold mt-2">
                  ルミナス王国は完全に復活した
                </p>
              )}
            </div>

            <p className="text-sm leading-relaxed text-left bg-black/25 backdrop-blur rounded-2xl p-4">
              {stage.story_complete}
            </p>

            <div className="space-y-2 bg-white/15 backdrop-blur rounded-2xl p-4">
              <p className="text-xs font-bold tracking-wider opacity-80">獲得報酬</p>
              <div className="flex items-center justify-center gap-4 text-sm">
                <span className="flex items-center gap-1 font-bold"><Coins className="w-4 h-4" />{stage.reward_coins}</span>
                <span className="flex items-center gap-1 font-bold"><Sparkles className="w-4 h-4" />{stage.reward_exp} EXP</span>
              </div>
              {titleDef && (
                <div className="flex items-center justify-center gap-1 text-sm font-bold pt-1">
                  <Trophy className="w-4 h-4" /> 称号「{titleDef.name}」
                </div>
              )}
              {stage.reward_badge_key && (
                <div className="flex items-center justify-center gap-1 text-sm font-bold pt-1">
                  <Award className="w-4 h-4" /> 限定バッジ獲得
                </div>
              )}
              {stage.reward_frame && (
                <div className="flex items-center justify-center gap-1 text-sm font-bold pt-1">
                  <Sparkles className="w-4 h-4" /> 黄金フレーム獲得
                </div>
              )}
            </div>

            {equipReward && (
              <div
                className="rounded-2xl p-4 bg-white/15 backdrop-blur space-y-2"
                style={{ boxShadow: `inset 0 0 0 2px ${RARITY_COLOR[equipReward.rarity]}` }}
              >
                <p className="text-xs font-bold tracking-wider opacity-80 flex items-center justify-center gap-1">
                  {equipReward.type === "shield" ? <ShieldIcon className="w-3.5 h-3.5" /> : <Gem className="w-3.5 h-3.5" />}
                  装備品を入手
                </p>
                <div className="flex items-center justify-center gap-3">
                  <img
                    src={equipReward.image}
                    alt={equipReward.name}
                    className="w-16 h-16 object-contain"
                    style={{ filter: `drop-shadow(0 0 8px ${RARITY_COLOR[equipReward.rarity]})` }}
                  />
                  <div className="text-left">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: RARITY_COLOR[equipReward.rarity] }}>
                      {equipReward.rarity}
                    </p>
                    <p className="text-base font-bold">{equipReward.name}</p>
                  </div>
                </div>
              </div>
            )}

            {nextStage ? (
              <Button
                className="w-full bg-white text-foreground hover:bg-white/90 font-bold"
                onClick={() => setPhase("intro")}
              >
                次のエリアへ
              </Button>
            ) : (
              <Button className="w-full bg-white text-foreground hover:bg-white/90 font-bold" onClick={onClose}>
                マップへ戻る
              </Button>
            )}
          </>
        ) : (
          nextStage && (
            <>
              <div className="space-y-2">
                <p className="text-xs font-bold tracking-widest opacity-80">第{nextStage.stage_number}章</p>
                <h2 className="text-2xl font-bold">{nextStage.name_before}</h2>
              </div>
              <p className="text-sm leading-relaxed text-left bg-black/30 backdrop-blur rounded-2xl p-4">
                {nextStage.story_intro}
              </p>
              <Button className="w-full bg-white text-foreground hover:bg-white/90 font-bold" onClick={onClose}>
                マップを見る
              </Button>
            </>
          )
        )}
      </div>

      <style>{`
        @keyframes questFlash {
          0% { opacity: 0; transform: scale(0.2); }
          50% { opacity: 1; transform: scale(1.5); }
          100% { opacity: 0; transform: scale(2.2); }
        }
        @keyframes questParticle {
          0%,100% { transform: translateY(0) scale(1); opacity: 0.4; }
          50% { transform: translateY(-30px) scale(1.4); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default QuestStageClearDialog;