import { useEffect, useState } from "react";
import { Swords, Skull, Sparkles, Heart, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getBossIcon } from "@/lib/questBosses";

interface BattleLog {
  id: string;
  stage_id: number;
  damage_dealt: number;
  boss_counter_damage: number;
  is_full_power: boolean;
  boss_hp_before: number;
  boss_hp_after: number;
  is_boss_defeated: boolean;
  player_atk: number;
  player_def: number;
}

interface BossInfo {
  boss_name: string;
  boss_hp: number;
  boss_icon: string;
  stage_name: string;
}

const QuestBattleResultDialog = () => {
  const { user } = useAuth();
  const [log, setLog] = useState<BattleLog | null>(null);
  const [boss, setBoss] = useState<BossInfo | null>(null);
  const [hpAnim, setHpAnim] = useState(100);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`quest-battle-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "quest_battle_logs", filter: `user_id=eq.${user.id}` },
        async (payload) => {
          const l = payload.new as BattleLog;
          // Fetch boss + stage info
          const { data: b } = await (supabase as any)
            .from("quest_bosses")
            .select("boss_name, boss_hp, boss_icon, stage:quest_stages(name_before)")
            .eq("stage_id", l.stage_id)
            .maybeSingle();
          if (b) {
            setBoss({
              boss_name: b.boss_name,
              boss_hp: b.boss_hp,
              boss_icon: b.boss_icon,
              stage_name: b.stage?.name_before || "",
            });
          }
          setLog(l);
          // animate HP from before -> after
          setHpAnim((l.boss_hp_before / Math.max(1, b?.boss_hp || l.boss_hp_before)) * 100);
          requestAnimationFrame(() => {
            setTimeout(() => {
              setHpAnim((l.boss_hp_after / Math.max(1, b?.boss_hp || l.boss_hp_before)) * 100);
            }, 400);
          });
          window.dispatchEvent(new Event("quest-progress-updated"));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  if (!log || !boss) return null;
  const Icon = getBossIcon(boss.boss_icon);
  const defeated = log.is_boss_defeated;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm fade-in">
      <div className="w-full max-w-sm bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl border-2 border-amber-400/40 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="relative px-5 py-4 bg-gradient-to-r from-red-900/60 to-slate-900 border-b border-amber-400/20">
          <button onClick={() => setLog(null)} className="absolute top-2 right-2 text-white/60 hover:text-white">
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 text-amber-300">
            <Swords className="w-4 h-4" />
            <p className="text-[11px] font-bold tracking-wider">バトル結果</p>
          </div>
          <p className="text-white font-bold text-base mt-1 break-all">{boss.boss_name}</p>
          <p className="text-white/60 text-[11px] break-all">{boss.stage_name}</p>
        </div>

        {/* Boss visual */}
        <div className="px-5 py-6 flex flex-col items-center">
          <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${defeated ? "from-amber-400 to-orange-500" : "from-red-600 to-red-900"} flex items-center justify-center shadow-lg ${defeated ? "" : "animate-pulse"}`}>
            {defeated ? <Skull className="w-10 h-10 text-white" /> : <Icon className="w-10 h-10 text-white" />}
          </div>

          {/* HP bar */}
          <div className="w-full mt-4">
            <div className="flex items-center justify-between text-[11px] text-white/80 mb-1">
              <span>ボスHP</span>
              <span className="font-bold">{log.boss_hp_after.toLocaleString()} / {boss.boss_hp.toLocaleString()}</span>
            </div>
            <div className="h-3 rounded-full bg-black/50 overflow-hidden border border-white/10">
              <div className="h-full transition-all duration-1000 ease-out" style={{ width: `${Math.max(0, hpAnim)}%`, background: "linear-gradient(90deg, #ef4444, #f87171)" }} />
            </div>
          </div>

          {/* Damage stats */}
          <div className="grid grid-cols-2 gap-2 w-full mt-4">
            <div className={`rounded-xl p-3 text-center ${log.is_full_power ? "bg-amber-500/20 border border-amber-400/40" : "bg-white/5 border border-white/10"}`}>
              <div className="flex items-center justify-center gap-1 text-amber-300 text-[10px] font-bold mb-1">
                <Sparkles className="w-3 h-3" />
                {log.is_full_power ? "全力攻撃!" : "与ダメージ"}
              </div>
              <p className="text-2xl font-bold text-white">{log.damage_dealt.toLocaleString()}</p>
            </div>
            <div className="rounded-xl p-3 text-center bg-white/5 border border-white/10">
              <div className="flex items-center justify-center gap-1 text-red-300 text-[10px] font-bold mb-1">
                <Heart className="w-3 h-3" /> 反撃ダメージ
              </div>
              <p className="text-2xl font-bold text-white">{log.boss_counter_damage.toLocaleString()}</p>
            </div>
          </div>

          {defeated && (
            <div className="mt-4 w-full rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-4 py-3 text-center shadow-lg animate-pulse">
              <p className="text-[10px] font-bold tracking-widest text-amber-900">VICTORY</p>
              <p className="text-base font-bold text-white drop-shadow">エリア復興完了!</p>
            </div>
          )}

          <button
            onClick={() => setLog(null)}
            className="mt-5 w-full rounded-full bg-white text-slate-900 font-bold py-2.5 text-sm hover:bg-white/90"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuestBattleResultDialog;
