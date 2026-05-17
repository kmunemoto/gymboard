import { Gift, ChevronRight } from "lucide-react";

const LoginBonusBanner = ({ onOpen }: { onOpen: () => void }) => (
  <button
    onClick={onOpen}
    className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-primary/10 border border-primary/30 hover:bg-primary/15 transition-colors"
  >
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
        <Gift className="w-4 h-4 text-primary" />
      </div>
      <span className="text-sm font-bold text-foreground">今日のログインボーナスを受け取ろう！</span>
    </div>
    <ChevronRight className="w-4 h-4 text-primary shrink-0" />
  </button>
);

export default LoginBonusBanner;
