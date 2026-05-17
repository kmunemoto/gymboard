import { useQuestProgress } from "@/hooks/useQuestProgress";
import { useBossProgress, useCombatStats } from "@/hooks/useQuestBattle";
import { getBossIcon } from "@/lib/questBosses";
import { ChevronRight, Sparkles, Castle, Swords } from "lucide-react";

interface Props {
  onOpen: () => void;
}

const QuestCard = ({ onOpen }: Props) => {
  const { data, loading } = useQuestProgress();
  const { bosses, progress } = useBossProgress();
  const { stats } = useCombatStats();
  if (loading) return null;

  // Fallback: no progress data yet → invite to start
  if (!data) {
    return (
      <button
        onClick={onOpen}
        className="w-full rounded-2xl p-5 text-left text-white shadow-lg transition active:scale-[0.99]"
        style={{ background: "linear-gradient(135deg, #1f2937 0%, #374151 100%)" }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Castle className="w-4 h-4" />
          <p className="text-[10px] font-bold tracking-wider uppercase opacity-80">王国復興クエスト</p>
        </div>
        <p className="font-bold text-base">冒険を始めよう！</p>
        <p className="text-[11px] opacity-80 mt-1">眠れる王国を取り戻す旅へ</p>
      </button>
    );
  }

  const stage = data.stages.find((s) => s.stage_number === data.current_stage);
  const allDone = data.completed_stage_ids.length >= 8;

  // All cleared
  if (allDone || !stage) {
    return (
      <button
        onClick={onOpen}
        className="w-full rounded-2xl p-5 text-left text-white shadow-lg transition active:scale-[0.99]"
        style={{ background: "linear-gradient(135deg, #fde68a 0%, #ffffff 100%)" }}
      >
        <div className="flex items-center gap-2 mb-1 text-foreground">
          <Sparkles className="w-4 h-4" />
          <p className="text-xs font-bold tracking-wider uppercase">王国復興クエスト</p>
        </div>
        <p className="font-bold text-foreground text-lg">ルミナス王国 完全復活</p>
        <p className="text-xs text-foreground/70 mt-1">全8エリアを取り戻しました</p>
      </button>
    );
  }

  const boss = bosses.find((b) => b.stage_id === stage.id);
  const bp = progress.find((p) => p.stage_id === stage.id);
  const Icon = boss ? getBossIcon(boss.boss_icon) : Castle;
  const maxHp = boss?.boss_hp ?? 0;
  const curHp = bp?.boss_current_hp ?? maxHp;
  const justDefeated = bp?.defeated;
  const hpPct = maxHp > 0 ? Math.max(0, (curHp / maxHp) * 100) : 0;
  const bg = justDefeated
    ? `linear-gradient(135deg, ${stage.theme_gradient_from} 0%, ${stage.theme_gradient_to} 100%)`
    : `linear-gradient(135deg, ${stage.theme_dark_from} 0%, ${stage.theme_dark_to} 100%)`;
  const bgUrl = stage.background_image_url;
  const overlayBg = justDefeated ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.45)";

  return (
    <button
      onClick={onOpen}
      className="w-full rounded-2xl text-left text-white shadow-lg transition active:scale-[0.99] relative overflow-hidden"
      style={{ background: bg }}
    >
      {bgUrl && (
        <img
          src={bgUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
          style={{ zIndex: 0 }}
        />
      )}
      <div className="absolute inset-0" style={{ background: overlayBg, zIndex: 1 }} />
      <div className="relative p-5" style={{ zIndex: 2 }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-wider opacity-80">第{stage.stage_number}章 · {justDefeated ? stage.name : stage.name_before}</p>
            <p className="font-bold text-base leading-tight break-all">{boss?.boss_name || "ボス"}</p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 opacity-70" />
      </div>

      {justDefeated ? (
        <div className="rounded-xl bg-white/25 backdrop-blur-sm px-3 py-2 text-center">
          <p className="text-sm font-bold">復興完了！報酬を受け取る</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="opacity-90">ボスHP</span>
            <span className="font-bold opacity-95">{curHp.toLocaleString()} / {maxHp.toLocaleString()}</span>
          </div>
          <div className="h-2.5 rounded-full bg-black/30 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${hpPct}%`, background: "#ef4444" }} />
          </div>
          {stats && (
            <div className="flex items-center gap-2 text-[10px] opacity-90 pt-1">
              <Swords className="w-3 h-3" /> ATK {stats.total_atk} · DEF {stats.total_def}
            </div>
          )}
        </div>
      )}
      </div>
    </button>
  );
};

export default QuestCard;