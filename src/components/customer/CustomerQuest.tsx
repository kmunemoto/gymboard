import { useState } from "react";
import { ArrowLeft, Lock, Check, Loader2, Shirt, Heart, Swords, Shield as ShieldIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuestProgress } from "@/hooks/useQuestProgress";
import { useBossProgress, useCombatStats } from "@/hooks/useQuestBattle";
import { getBossIcon } from "@/lib/questBosses";
import EquipmentDialog from "./EquipmentDialog";
import QuestBossVisual from "./QuestBossVisual";
import QuestStoryDialog from "./QuestStoryDialog";

const CustomerQuest = ({ onBack }: { onBack: () => void }) => {
  const { data, loading } = useQuestProgress();
  const { bosses, progress } = useBossProgress();
  const { stats } = useCombatStats();
  const [equipOpen, setEquipOpen] = useState(false);
  const [openStage, setOpenStage] = useState<number | null>(null);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  const completedSet = new Set(data.completed_stage_ids);
  const currentStage = data.stages.find((s) => s.stage_number === data.current_stage);
  const allDone = completedSet.size >= 8;
  const restorePct = Math.round((completedSet.size / 8) * 100);

  const headerBg = currentStage && !allDone
    ? `linear-gradient(135deg, ${currentStage.theme_dark_from} 0%, ${currentStage.theme_dark_to} 100%)`
    : `linear-gradient(135deg, #fde68a 0%, #ffffff 100%)`;

  const eqBonus = (k: "atk" | "def" | "hp") => {
    if (!stats) return 0;
    return [stats.equipped_weapon, stats.equipped_shield, stats.equipped_amulet]
      .reduce((s, e) => s + (e ? (e as any)[`${k}_bonus`] : 0), 0);
  };

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <div
        className="px-4 py-6 text-white relative"
        style={{ background: headerBg }}
      >
        <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold mb-3 opacity-90">
          <ArrowLeft className="w-4 h-4" /> 戻る
        </button>
        <h1 className="text-2xl font-bold">ルミナス王国</h1>
        <p className="text-sm opacity-90 mt-1">復興率 {restorePct}%（{completedSet.size}/8 エリア）</p>
        <div className="h-2 mt-3 bg-white/20 rounded-full overflow-hidden">
          <div className="h-full bg-white/80 transition-all" style={{ width: `${restorePct}%` }} />
        </div>
      </div>

      {/* Player stats panel */}
      {stats && (
        <div className="mx-4 -mt-4 mb-2 rounded-2xl bg-white shadow-md p-4 border border-border">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-bold tracking-wider opacity-70">プレイヤー</p>
              <p className="text-sm font-bold">Lv.{stats.level}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEquipOpen(true)} className="text-xs h-8">
              <Shirt className="w-3.5 h-3.5 mr-1" /> 装備
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "HP", icon: Heart, val: stats.total_hp, base: stats.base_hp, color: "#0ABAB5" },
              { label: "ATK", icon: Swords, val: stats.total_atk, base: stats.base_atk, color: "#ef4444" },
              { label: "DEF", icon: ShieldIcon, val: stats.total_def, base: stats.base_def, color: "#3b82f6" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-secondary/50 p-2">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <s.icon className="w-3 h-3" style={{ color: s.color }} />
                  <span className="text-[10px] font-bold opacity-70">{s.label}</span>
                </div>
                <p className="text-base font-bold leading-none">
                  {s.val}
                  {s.val > s.base && <span className="text-[9px] opacity-60 ml-0.5">+{s.val - s.base}</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-4 space-y-3">
        {data.stages.map((stage, i) => {
          const isCompleted = completedSet.has(stage.id);
          const isCurrent = !isCompleted && stage.stage_number === data.current_stage;
          const isLocked = !isCompleted && !isCurrent;
          const boss = bosses.find((b) => b.stage_id === stage.id);
          const bp = progress.find((p) => p.stage_id === stage.id);
          const Icon = boss ? getBossIcon(boss.boss_icon) : Lock;
          const maxHp = boss?.boss_hp ?? 0;
          const curHp = bp?.boss_current_hp ?? maxHp;
          const hpPct = maxHp > 0 ? Math.max(0, (curHp / maxHp) * 100) : 0;

          const bgUrl = stage.background_image_url;
          const fallbackBg = isCompleted
            ? `linear-gradient(135deg, ${stage.theme_gradient_from} 0%, ${stage.theme_gradient_to} 100%)`
            : isCurrent
              ? `linear-gradient(135deg, ${stage.theme_dark_from} 0%, ${stage.theme_dark_to} 100%)`
              : `linear-gradient(135deg, #e5e7eb 0%, #9ca3af 100%)`;
          const overlayBg = isCompleted
            ? "rgba(255,255,255,0.15)"
            : isCurrent
              ? "rgba(0,0,0,0.45)"
              : "rgba(0,0,0,0.55)";

          return (
            <div key={stage.id} className="relative">
              {i > 0 && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 w-1 h-3"
                  style={{
                    background: completedSet.has(stage.id - 1) ? "#0ABAB5" : "transparent",
                    borderLeft: completedSet.has(stage.id - 1) ? "none" : "2px dashed #d1d5db",
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => setOpenStage(stage.stage_number)}
                className="w-full text-left rounded-2xl text-white shadow-md transition-transform active:scale-[0.98] relative overflow-hidden"
                style={{ background: fallbackBg }}
              >
                {bgUrl && (
                  <img
                    src={bgUrl}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{
                      zIndex: 0,
                      filter: isLocked ? "grayscale(100%) brightness(0.3)" : undefined,
                    }}
                  />
                )}
                <div
                  className="absolute inset-0"
                  style={{ background: overlayBg, zIndex: 1 }}
                />
                <div className="relative p-5" style={{ zIndex: 2 }}>
                <div className="flex items-center gap-3">
                  <div className="shrink-0">
                    <QuestBossVisual
                      stageNumber={stage.stage_number}
                      Icon={isCompleted ? Check : Icon}
                      size={64}
                      locked={isLocked}
                      completed={isCompleted}
                      imageUrl={boss?.boss_image_url}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold tracking-wider opacity-80">第{stage.stage_number}章</p>
                    <p className="font-bold text-base leading-tight break-all">
                      {isLocked ? "？？？" : isCompleted ? stage.name : stage.name_before}
                    </p>
                    {isCurrent && boss && (
                      <p className="text-[11px] opacity-90 mt-0.5 break-all">{boss.boss_name}</p>
                    )}
                    {!isLocked && (
                      <p className="text-[10px] opacity-70 mt-1">タップで物語を見る</p>
                    )}
                  </div>
                </div>

                {isCurrent && boss && (
                  <div className="mt-3 space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-[11px] mb-0.5">
                        <span className="opacity-90">ボスHP</span>
                        <span className="font-bold">{curHp.toLocaleString()}/{maxHp.toLocaleString()}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-black/30 overflow-hidden">
                        <div className="h-full transition-all duration-700" style={{ width: `${hpPct}%`, background: "#ef4444" }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] opacity-90">
                      <div className="bg-black/20 rounded px-2 py-1">ATK {boss.boss_atk} · DEF {boss.boss_def}</div>
                      <div className="bg-black/20 rounded px-2 py-1 text-right">ターン {bp?.total_turns ?? 0}</div>
                    </div>
                    <p className="text-[10px] opacity-80 leading-snug break-all">{boss.boss_description}</p>
                  </div>
                )}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      <EquipmentDialog open={equipOpen} onClose={() => setEquipOpen(false)} />

      {openStage !== null && (() => {
        const stage = data.stages.find((s) => s.stage_number === openStage);
        if (!stage) return null;
        const isCompleted = completedSet.has(stage.id);
        const isCurrent = !isCompleted && stage.stage_number === data.current_stage;
        const isLocked = !isCompleted && !isCurrent;
        const boss = bosses.find((b) => b.stage_id === stage.id);
        const bp = progress.find((p) => p.stage_id === stage.id);
        const Icon = boss ? getBossIcon(boss.boss_icon) : Lock;
        const storyText = isCompleted
          ? (stage.story_complete || stage.story_intro)
          : stage.story_intro;
        return (
          <QuestStoryDialog
            open
            onClose={() => setOpenStage(null)}
            stageNumber={stage.stage_number}
            stageName={isCompleted ? stage.name : stage.name_before}
            storyText={storyText}
            bossName={boss?.boss_name}
            bossHp={boss?.boss_hp}
            bossAtk={boss?.boss_atk}
            bossDef={boss?.boss_def}
            curHp={bp?.boss_current_hp ?? boss?.boss_hp}
            Icon={Icon}
            locked={isLocked}
            completed={isCompleted}
            bossImageUrl={boss?.boss_image_url}
            backgroundImageUrl={stage.background_image_url}
          />
        );
      })()}
    </div>
  );
};

export default CustomerQuest;