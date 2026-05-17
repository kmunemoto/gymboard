import { useEffect, useRef, useState } from "react";
import { Coins, Star, Ticket, Check, Gift } from "lucide-react";
import { useLoginBonus, type ClaimResult } from "@/hooks/useLoginBonus";

interface Props { open: boolean; onClose: () => void }

const REWARDS: { day: number; type: "coins" | "exp" | "gacha_ticket"; amount: number }[] = [
  { day: 1, type: "coins", amount: 5 },
  { day: 2, type: "exp", amount: 20 },
  { day: 3, type: "coins", amount: 10 },
  { day: 4, type: "exp", amount: 30 },
  { day: 5, type: "coins", amount: 15 },
  { day: 6, type: "exp", amount: 50 },
  { day: 7, type: "gacha_ticket", amount: 1 },
];

const Icon = ({ type, className }: { type: string; className?: string }) => {
  if (type === "coins") return <Coins className={className} />;
  if (type === "exp") return <Star className={className} />;
  return <Ticket className={className} />;
};

const LoginBonusDialog = ({ open, onClose }: Props) => {
  const { status, claim } = useLoginBonus();
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [closing, setClosing] = useState(false);
  const claimedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      claimedRef.current = false;
      setResult(null);
      setClosing(false);
      return;
    }
    if (!status || claimedRef.current) return;
    claimedRef.current = true;
    (async () => {
      try {
        if (!status.claimed_today) {
          const r = await claim();
          if (r) setResult(r);
        }
      } catch {
        // ignore; still auto-close
      } finally {
        setTimeout(() => setClosing(true), 1500);
        setTimeout(() => onClose(), 1800);
      }
    })();
  }, [open, status, claim, onClose]);

  if (!open || !status) return null;

  const claimedDays = new Set(status.recent.map((r) => r.day_number));
  if (status.claimed_today || result) claimedDays.add(result?.day_number ?? status.current_day_number);

  const todayDay = status.current_day_number;
  const showStreakReset = !status.claimed_today && status.recent.length > 0 && todayDay === 1 && status.recent[0]?.day_number !== 7;

  const rewardLabel = (() => {
    const r = result;
    if (!r) return null;
    const base = r.reward_type === "coins" ? `${r.reward_amount} コイン` : r.reward_type === "exp" ? `${r.reward_amount} EXP` : `ガチャチケット ${r.reward_amount}枚`;
    const extra = r.extra_coins > 0 ? ` +${r.extra_coins}（プレミアム）` : "";
    return `Day ${r.day_number}　${base}${extra} 獲得！`;
  })();

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${closing ? "animate-fade-out" : "animate-fade-in"}`}
      style={{ pointerEvents: "none" }}
    >
      <div className={`w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 relative ${closing ? "animate-scale-out" : "animate-scale-in"}`}>
        <div className="flex items-center gap-2 mb-1">
          <Gift className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold">ログインボーナス</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">毎日アプリを開くと報酬がもらえます</p>

        <div className="grid grid-cols-7 gap-1.5 mb-4">
          {REWARDS.map((r) => {
            const claimedNow = !!result && r.day === result.day_number;
            const isClaimed = claimedDays.has(r.day) || claimedNow;
            const isToday = r.day === todayDay && !isClaimed;
            const isDay7 = r.day === 7;
            const baseCls = isDay7
              ? "border-2 border-amber-400 bg-amber-50"
              : "border border-gray-200 bg-gray-50";
            const todayCls = isToday ? "ring-2 ring-primary animate-pulse bg-primary/10" : "";
            const claimedCls = isClaimed ? "bg-primary/15 border-primary/40" : "";
            return (
              <div key={r.day} className={`rounded-lg p-1.5 flex flex-col items-center justify-center aspect-square text-center ${baseCls} ${claimedCls} ${todayCls}`}>
                <span className="text-[9px] font-bold text-muted-foreground">Day {r.day}</span>
                {isClaimed ? (
                  <Check className="w-4 h-4 text-primary mt-0.5" />
                ) : (
                  <>
                    <Icon type={r.type} className={`w-4 h-4 mt-0.5 ${isDay7 ? "text-amber-500" : isToday ? "text-primary" : "text-gray-400"}`} />
                    <span className="text-[9px] font-bold mt-0.5">{r.amount}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {showStreakReset && (
          <p className="text-[11px] text-muted-foreground text-center mb-3">連続ログインがリセットされました</p>
        )}

        <div className="text-center text-sm font-bold text-primary min-h-[1.5rem]">
          {rewardLabel ?? (status.claimed_today ? "本日の受け取りは完了しています" : "受け取り中...")}
        </div>
      </div>
    </div>
  );
};

export default LoginBonusDialog;
