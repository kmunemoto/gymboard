import { useState } from "react";
import { Swords, Trophy, Shield, Flame, Loader2, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRivalBattle, isJstMonday } from "@/hooks/useRivalBattle";
import { useAuth } from "@/contexts/AuthContext";
import { getRankInfo, type Gender, type HairColor } from "@/lib/avatarSystem";
import { toast } from "sonner";
import RivalBattleDetailDialog from "./RivalBattleDetailDialog";
import { differenceInCalendarDays, parseISO } from "date-fns";

const ACCENT = "#0ABAB5";

interface AvatarMini {
  level: number;
  gender: Gender | null;
  hair_color: string;
  display_name: string;
  title: string | null;
}

const MiniAvatar = ({ info, side }: { info: AvatarMini; side: "left" | "right" }) => {
  const rank = getRankInfo(info.level || 1, (info.gender || "female") as Gender, (info.hair_color || "orange") as HairColor);
  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <div
        className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center"
        style={{ borderColor: rank.color, borderWidth: 2, borderStyle: "solid" }}
      >
        <img src={rank.image} alt={rank.name} className="w-full h-full object-cover" />
      </div>
      <p className="text-[10px] font-bold text-muted-foreground truncate w-full text-center">
        {side === "left" ? "あなた" : info.display_name}
      </p>
      <p className="text-[9px] text-muted-foreground">Lv.{info.level}</p>
    </div>
  );
};

const RivalBattleCard = () => {
  const { user } = useAuth();
  const { loading, entered, activeBattle, unclaimedReward, opponent, enter, claim } = useRivalBattle();
  const [submitting, setSubmitting] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const monday = isJstMonday();

  if (loading || !user) return null;

  // F. 月曜以外でエントリーもバトルも報酬もなし → 非表示
  if (!monday && !entered && !activeBattle && !unclaimedReward) return null;

  const handleEnter = async () => {
    setSubmitting(true);
    try {
      await enter();
      toast.success("エントリー完了！火曜以降にマッチングされます");
    } catch (e: any) {
      toast.error(e?.message || "エントリーに失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaim = async (battleId: string) => {
    setSubmitting(true);
    try {
      const res: any = await claim(battleId);
      const lvl = res?.leveled_up ? "（レベルアップ！）" : "";
      toast.success(`+${res?.coins}コイン / +${res?.exp}EXP ${lvl}`);
    } catch (e: any) {
      toast.error(e?.message || "報酬受け取りに失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const Header = (
    <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
      <Swords className="w-3.5 h-3.5" />
      ライバルバトル
    </h2>
  );

  // D. 結果あり未claim → 演出
  if (unclaimedReward) {
    const { battle, reward } = unclaimedReward;
    const isWin = reward.result === "win";
    const isDraw = reward.result === "draw";
    const label = isWin ? "WIN!" : isDraw ? "DRAW" : "LOSE...";
    const color = isWin ? ACCENT : isDraw ? "#888" : "#aa3333";
    return (
      <section>
        {Header}
        <Card className="card-hover overflow-hidden">
          <CardContent className="p-5 text-center">
            <Trophy className="w-8 h-8 mx-auto mb-1" style={{ color }} />
            <p className="text-3xl font-extrabold" style={{ color }}>{label}</p>
            <p className="text-xs text-muted-foreground mt-1">先週のライバルバトルが終了しました</p>
            <div className="mt-3 p-3 rounded-xl" style={{ backgroundColor: `${ACCENT}10` }}>
              <p className="text-sm font-bold">+{reward.coins_earned}コイン / +{reward.exp_earned}EXP</p>
              {reward.streak_bonus_coins > 0 && (
                <p className="text-xs font-bold mt-1" style={{ color: "#D4AF37" }}>
                  <Flame className="inline w-3 h-3 mr-0.5" />
                  {reward.win_streak}連勝ボーナス！+{reward.streak_bonus_coins}コイン
                </p>
              )}
            </div>
            <Button
              className="w-full mt-3 font-bold"
              style={{ backgroundColor: ACCENT, color: "white" }}
              disabled={submitting}
              onClick={() => handleClaim(battle.id)}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "報酬を受け取る"}
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  // C. 進行中
  if (activeBattle && opponent) {
    const isP1 = activeBattle.player1_id === user.id;
    const myVol = isP1 ? activeBattle.player1_volume : activeBattle.player2_volume;
    const opVol = isP1 ? activeBattle.player2_volume : activeBattle.player1_volume;
    const total = (Number(myVol) || 0) + (Number(opVol) || 0);
    const myPct = total > 0 ? (Number(myVol) / total) * 100 : 50;
    const daysLeft = Math.max(0, differenceInCalendarDays(parseISO(activeBattle.week_end), new Date()) + 1);
    return (
      <>
        <section>
          {Header}
          <Card className="card-hover cursor-pointer" onClick={() => setDetailOpen(true)}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <MiniAvatar info={{ level: 1, gender: null, hair_color: "orange", display_name: "あなた", title: null }} side="left" />
                <div className="flex flex-col items-center px-1">
                  <Swords className="w-5 h-5" style={{ color: ACCENT }} />
                  <p className="text-[10px] font-extrabold tracking-widest" style={{ color: ACCENT }}>VS</p>
                </div>
                <MiniAvatar
                  info={{
                    level: opponent.level,
                    gender: opponent.gender,
                    hair_color: opponent.hair_color,
                    display_name: "ライバル",
                    title: opponent.equipped_title,
                  }}
                  side="right"
                />
              </div>
              <div className="mt-3 flex justify-between text-xs">
                <span className="font-bold">{Math.round(Number(myVol) || 0).toLocaleString()} kg</span>
                <span className="font-bold text-muted-foreground">{Math.round(Number(opVol) || 0).toLocaleString()} kg</span>
              </div>
              <div className="mt-1 h-2 rounded-full overflow-hidden bg-muted relative">
                <div
                  className="h-full transition-all"
                  style={{ width: `${myPct}%`, backgroundColor: ACCENT }}
                />
              </div>
              <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>残り{daysLeft}日</span>
                <span className="flex items-center gap-0.5">詳細 <ChevronRight className="w-3 h-3" /></span>
              </div>
            </CardContent>
          </Card>
        </section>
        <RivalBattleDetailDialog open={detailOpen} onClose={() => setDetailOpen(false)} />
      </>
    );
  }

  // B. エントリー済みマッチング待ち
  if (entered) {
    return (
      <section>
        {Header}
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: ACCENT }} />
            <div className="flex-1">
              <p className="text-sm font-bold">対戦相手を探しています...</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">マッチング後に通知されます</p>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  // A. 月曜かつ未エントリー
  if (monday) {
    return (
      <section>
        {Header}
        <Card className="card-hover overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${ACCENT}20` }}>
                <Shield className="w-5 h-5" style={{ color: ACCENT }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">今週のバトルにエントリー</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 break-all">
                  毎週月曜にエントリー → 1週間の総挙上量で勝負！
                </p>
              </div>
            </div>
            <Button
              className="w-full mt-3 font-bold"
              style={{ backgroundColor: ACCENT, color: "white" }}
              disabled={submitting}
              onClick={handleEnter}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "エントリーする"}
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  // E. 月曜以外でアクティブなし（履歴があるユーザーのみ案内表示）
  return null;
};

export default RivalBattleCard;