import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getRankInfo, type Gender, type HairColor } from "@/lib/avatarSystem";
import { Coins, Sparkles } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  newLevel: number;
  earnedCoins: number;
  gender?: Gender;
  hairColor?: HairColor;
}

const AvatarLevelUpDialog = ({ open, onClose, newLevel, earnedCoins, gender = "female", hairColor = "orange" }: Props) => {
  const rank = getRankInfo(newLevel, gender, hairColor);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm text-center">
        <DialogTitle className="sr-only">レベルアップ</DialogTitle>
        <div className="flex flex-col items-center py-2 relative">
          <Sparkles className="absolute top-0 left-4 w-5 h-5 text-amber-400 animate-pulse" />
          <Sparkles className="absolute top-2 right-6 w-4 h-4 text-amber-300 animate-pulse" style={{ animationDelay: "0.3s" }} />
          <Sparkles className="absolute top-20 left-2 w-3 h-3 text-amber-400 animate-pulse" style={{ animationDelay: "0.6s" }} />
          <div
            className="w-44 h-44 rounded-3xl flex items-center justify-center overflow-hidden animate-[scale-in_0.4s_ease-out]"
            style={{ backgroundColor: `${rank.color}20`, boxShadow: `0 0 40px ${rank.color}55` }}
          >
            <img
              src={rank.image}
              alt={rank.name}
              className="w-full h-full object-cover pixel-avatar"
              
            />
          </div>
          <p className="mt-4 text-3xl font-black tracking-wider" style={{ color: rank.color }}>LEVEL UP!</p>
          <p className="mt-2 text-xl font-extrabold">Lv.{newLevel}</p>
          <p className="text-sm font-bold" style={{ color: rank.color }}>{rank.name}</p>
          {earnedCoins > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-amber-600 font-bold">
              <Coins className="w-4 h-4" />
              +{earnedCoins} コイン獲得
            </div>
          )}
          <button
            onClick={onClose}
            className="mt-5 px-8 h-11 rounded-xl bg-primary text-primary-foreground font-semibold"
          >
            閉じる
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AvatarLevelUpDialog;