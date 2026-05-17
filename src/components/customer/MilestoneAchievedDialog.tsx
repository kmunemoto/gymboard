import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Coins, Star, Ticket, Award } from "lucide-react";
import BadgeIcon from "./BadgeIcon";
import { getTitleDef } from "@/lib/titleSystem";
import type { MilestoneAchieved } from "@/lib/raidUtils";

interface Props {
  milestones: MilestoneAchieved[];
  onClose: () => void;
}

const MilestoneAchievedDialog = ({ milestones, onClose }: Props) => {
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [milestones]);
  if (!milestones.length) return null;
  const m = milestones[idx];
  const next = () => {
    if (idx + 1 < milestones.length) setIdx(idx + 1);
    else onClose();
  };

  const titleName = m.reward_title ? getTitleDef(m.reward_title)?.name || m.reward_title : null;

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 18 }).map((_, i) => (
            <span
              key={i}
              className="absolute w-1.5 h-1.5 rounded-full animate-bounce"
              style={{
                left: `${(i * 53) % 100}%`,
                top: `${(i * 37) % 100}%`,
                background: i % 3 === 0 ? "#0ABAB5" : i % 3 === 1 ? "#F59E0B" : "#EC4899",
                animationDelay: `${(i * 100) % 1500}ms`,
                animationDuration: "1.6s",
                opacity: 0.7,
              }}
            />
          ))}
        </div>
        <div className="relative text-center pt-2">
          <p className="text-[11px] font-bold text-muted-foreground tracking-widest mb-2">MILESTONE</p>
          <h2 className="text-xl font-extrabold mb-1 break-all" style={{ color: "#0ABAB5" }}>
            {m.milestone_name}達成！
          </h2>
          <p className="text-xs text-muted-foreground mb-4">{m.session_count}セッション到達</p>

          <div className="space-y-2 text-left mb-4">
            {m.reward_coins > 0 && (
              <RewardRow icon={<Coins className="w-4 h-4 text-amber-500" />} label={`${m.reward_coins} コイン`} />
            )}
            {m.reward_exp > 0 && (
              <RewardRow icon={<Star className="w-4 h-4 text-primary" />} label={`${m.reward_exp} EXP`} />
            )}
            {m.reward_gacha_tickets > 0 && (
              <RewardRow icon={<Ticket className="w-4 h-4 text-purple-500" />} label={`ガチャチケット ${m.reward_gacha_tickets}枚`} />
            )}
            {titleName && (
              <RewardRow icon={<Award className="w-4 h-4 text-rose-500" />} label={`称号「${titleName}」`} />
            )}
            {m.reward_badge_key && (
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r from-primary/10 to-amber-100/40 border border-primary/20">
                <div className="flex items-center gap-2">
                  <BadgeIcon type="achievement" iconKey={m.reward_badge_key} rarity="epic" size={36} />
                  <span className="text-xs font-bold break-all">記念バッジ獲得</span>
                </div>
              </div>
            )}
          </div>

          <Button onClick={next} className="w-full" style={{ background: "#0ABAB5" }}>
            {idx + 1 < milestones.length ? `次へ (${idx + 2}/${milestones.length})` : "閉じる"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const RewardRow = ({ icon, label }: { icon: React.ReactNode; label: string }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50">
    {icon}
    <span className="text-sm font-bold break-all">{label}</span>
  </div>
);

export default MilestoneAchievedDialog;