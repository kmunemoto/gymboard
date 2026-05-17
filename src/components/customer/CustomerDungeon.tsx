import { useState, useEffect } from "react";
import { ArrowLeft, Lock, Check, Loader2, Zap, Swords, AlertTriangle } from "lucide-react";
import { useDungeonStages, useStamina, startDungeonRun, type DungeonStage } from "@/hooks/useDungeon";
import { useAuth } from "@/contexts/AuthContext";
import { useAvatar } from "@/hooks/useAvatar";
import { toast } from "sonner";
import DungeonBattle from "./DungeonBattle";

const CustomerDungeon = ({ onBack }: { onBack: () => void }) => {
  const { user } = useAuth();
  const { stages, clearedKeys, loading, refetch } = useDungeonStages();
  const { stamina, refetch: refetchStamina } = useStamina();
  const { avatar } = useAvatar(false);
  const playerLevel = avatar?.level ?? 1;
  const [busy, setBusy] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<{ stage: DungeonStage; runId: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const isFull = stamina ? stamina.current_stamina >= stamina.max_stamina : false;
  let countdownText = "";
  if (stamina && !isFull && stamina.next_recovery_at) {
    const diff = new Date(stamina.next_recovery_at).getTime() - now;
    if (diff > 0) {
      const totalMin = Math.ceil(diff / 60_000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      countdownText = h > 0 ? `${h}時間${m}分` : `${m}分`;
    } else {
      countdownText = "まもなく";
    }
  }

  const handleStart = async (stage: DungeonStage) => {
    if (!user) return;
    if (!stamina || stamina.current_stamina < 1) {
      toast.error("スタミナが足りません");
      return;
    }
    setBusy(stage.stage_key);
    try {
      const r = await startDungeonRun(user.id, stage.stage_key);
      setActiveRun({ stage, runId: r.run_id });
      refetchStamina();
    } catch (e: any) {
      toast.error("ダンジョンを開始できません", { description: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleBattleClose = () => {
    setActiveRun(null);
    refetch();
    refetchStamina();
  };

  const handleBattleRetry = () => {
    if (!activeRun) return;
    const stage = activeRun.stage;
    setActiveRun(null);
    refetch();
    refetchStamina();
    setTimeout(() => handleStart(stage), 200);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <div className="px-4 py-5 text-white" style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)" }}>
        <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold mb-3 opacity-90">
          <ArrowLeft className="w-4 h-4" /> 戻る
        </button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Swords className="w-6 h-6" /> ダンジョン探索
        </h1>
        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur">
          <Zap className="w-4 h-4 text-amber-300" />
          <span className="text-sm font-bold">
            スタミナ {stamina ? `${stamina.current_stamina}/${stamina.max_stamina}` : "..."}
          </span>
          <span className="text-[10px] opacity-80">
            {stamina
              ? isFull
                ? "(スタミナ最大)"
                : `(次の回復まで: ${countdownText})`
              : ""}
          </span>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {stages.map((stage, i) => {
          const isCleared = clearedKeys.has(stage.stage_key);
          const prevKey = stage.unlock_condition;
          const isLocked = prevKey ? !clearedKeys.has(prevKey) : false;
          const canPlay = !isLocked && stamina && stamina.current_stamina >= 1;

          return (
            <button
              key={stage.id}
              type="button"
              disabled={isLocked || busy !== null}
              onClick={() => handleStart(stage)}
              className="w-full text-left rounded-2xl text-white shadow-md transition-transform active:scale-[0.98] relative overflow-hidden disabled:active:scale-100"
              style={{
                background: stage.background_css || "linear-gradient(135deg,#1a1a2e,#16213e)",
                opacity: isLocked ? 0.5 : 1,
              }}
            >
              <div className="absolute inset-0" style={{ background: isLocked ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.2)" }} />
              <div className="relative p-5 flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  {isLocked ? (
                    <Lock className="w-6 h-6" />
                  ) : isCleared ? (
                    <Check className="w-6 h-6 text-green-300" />
                  ) : (
                    <Swords className="w-6 h-6" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold tracking-wider opacity-80">ステージ {stage.stage_order} · 全{stage.floor_count}フロア</p>
                  <p className="font-bold text-base leading-tight break-all">
                    {isLocked ? "？？？" : stage.stage_name}
                  </p>
                  {!isLocked && stage.recommended_level_min != null && stage.recommended_level_max != null && (
                    <p className={`text-[11px] mt-0.5 font-bold flex items-center gap-1 ${playerLevel < (stage.recommended_level_min ?? 1) ? "text-red-300" : "opacity-90"}`}>
                      {playerLevel < (stage.recommended_level_min ?? 1) && <AlertTriangle className="w-3 h-3" />}
                      推奨 Lv.{stage.recommended_level_min}〜{stage.recommended_level_max}
                    </p>
                  )}
                  <p className="text-[11px] opacity-80 mt-1">
                    {isLocked
                      ? "前のステージをクリアで解放"
                      : isCleared
                      ? "クリア済み（再挑戦できます）"
                      : canPlay
                      ? "挑戦可能（スタミナ1消費）"
                      : "スタミナ不足"}
                  </p>
                </div>
                {busy === stage.stage_key && <Loader2 className="w-4 h-4 animate-spin" />}
              </div>
            </button>
          );
        })}
      </div>

      {activeRun && (
        <DungeonBattle
          stage={activeRun.stage}
          runId={activeRun.runId}
          onClose={handleBattleClose}
          onFinish={handleBattleRetry}
        />
      )}
    </div>
  );
};

export default CustomerDungeon;