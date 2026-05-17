import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRivalHistory, useRivalBattle } from "@/hooks/useRivalBattle";
import { Trophy, Shield, Flame, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";

const ACCENT = "#0ABAB5";

const RivalBattleDetailDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { history, stats, loading } = useRivalHistory();
  const { activeBattle } = useRivalBattle();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5" style={{ color: ACCENT }} />
            ライバルバトル詳細
          </DialogTitle>
        </DialogHeader>

        {/* 通算戦績 */}
        <div className="grid grid-cols-4 gap-2 my-3">
          <div className="text-center p-2 rounded-lg" style={{ backgroundColor: `${ACCENT}10` }}>
            <p className="text-lg font-extrabold" style={{ color: ACCENT }}>{stats.wins}</p>
            <p className="text-[10px] text-muted-foreground">勝</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted">
            <p className="text-lg font-extrabold">{stats.losses}</p>
            <p className="text-[10px] text-muted-foreground">敗</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted">
            <p className="text-lg font-extrabold">{stats.draws}</p>
            <p className="text-[10px] text-muted-foreground">分</p>
          </div>
          <div className="text-center p-2 rounded-lg" style={{ backgroundColor: "#fff7e6" }}>
            <p className="text-lg font-extrabold flex items-center justify-center gap-0.5" style={{ color: "#D4AF37" }}>
              <Flame className="w-3 h-3" />{stats.currentStreak}
            </p>
            <p className="text-[10px] text-muted-foreground">連勝</p>
          </div>
        </div>

        {/* 進行中バトル */}
        {activeBattle && (
          <div className="p-3 rounded-xl border mb-3" style={{ borderColor: ACCENT }}>
            <p className="text-xs font-bold mb-1.5 flex items-center gap-1">
              <Shield className="w-3.5 h-3.5" style={{ color: ACCENT }} />
              進行中（{format(parseISO(activeBattle.week_start), "M/d", { locale: ja })} 〜 {format(parseISO(activeBattle.week_end), "M/d", { locale: ja })}）
            </p>
            <div className="flex justify-between text-xs">
              <span>あなた: <strong>{Math.round(Number(activeBattle.player1_id ? (activeBattle as any).player1_volume : 0)).toLocaleString()} kg</strong></span>
            </div>
          </div>
        )}

        {/* 履歴一覧 */}
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">過去のバトル</h3>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-4">まだバトル履歴がありません</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => {
              const result = h.reward?.result;
              const myVol = h.isPlayer1 ? h.battle.player1_volume : h.battle.player2_volume;
              const opVol = h.isPlayer1 ? h.battle.player2_volume : h.battle.player1_volume;
              const color = result === "win" ? ACCENT : result === "lose" ? "#aa3333" : "#888";
              const label = result === "win" ? "勝" : result === "lose" ? "敗" : "分";
              return (
                <div key={h.battle.id} className="p-2.5 rounded-lg bg-muted flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-extrabold text-xs text-white"
                    style={{ backgroundColor: color }}
                  >
                    {label}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold">
                      {format(parseISO(h.battle.week_start), "M/d", { locale: ja })} 〜 {format(parseISO(h.battle.week_end), "M/d", { locale: ja })}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {Math.round(Number(myVol)).toLocaleString()} vs {Math.round(Number(opVol)).toLocaleString()} kg
                    </p>
                  </div>
                  {h.reward && (
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground">+{h.reward.coins_earned + h.reward.streak_bonus_coins}c</p>
                      <p className="text-[10px] text-muted-foreground">+{h.reward.exp_earned}xp</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RivalBattleDetailDialog;