import { Button } from "@/components/ui/button";
import { Trophy, Skull, Coins, Sparkles, Gem, RotateCcw, ArrowLeft } from "lucide-react";

export interface DungeonResultData {
  result: "victory" | "defeat" | "retreat";
  floorsCleared: number;
  totalFloors: number;
  totalExp: number;
  totalCoins: number;
  materials: { key: string; name: string; qty: number }[];
}

interface Props {
  data: DungeonResultData;
  onRetry: () => void;
  onBack: () => void;
}

const TITLE: Record<string, string> = {
  victory: "ステージクリア！",
  defeat: "敗北...",
  retreat: "撤退完了",
};

const DungeonResult = ({ data, onRetry, onBack }: Props) => {
  const Icon = data.result === "victory" ? Trophy : Skull;
  const color = data.result === "victory" ? "#f59e0b" : "#9ca3af";

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-[#1a1a2e] text-white p-6 shadow-2xl border border-white/10">
        <div className="flex flex-col items-center text-center mb-5">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mb-3"
            style={{ background: `${color}20`, border: `2px solid ${color}` }}
          >
            <Icon className="w-10 h-10" style={{ color }} />
          </div>
          <h2 className="text-2xl font-extrabold">{TITLE[data.result]}</h2>
          <p className="text-xs opacity-70 mt-1">
            クリアフロア: {data.floorsCleared} / {data.totalFloors}
          </p>
        </div>

        <div className="rounded-2xl bg-white/5 p-4 space-y-2 mb-5">
          <p className="text-xs font-bold tracking-wider opacity-70 mb-2">獲得報酬</p>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-accent" />EXP</span>
            <span className="font-bold">+{data.totalExp}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Coins className="w-4 h-4 text-amber-400" />コイン</span>
            <span className="font-bold">+{data.totalCoins}</span>
          </div>
          {data.materials.map((m) => (
            <div key={m.key} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><Gem className="w-4 h-4 text-cyan-400" />{m.name}</span>
              <span className="font-bold">x{m.qty}</span>
            </div>
          ))}
          {data.materials.length === 0 && (
            <p className="text-[11px] opacity-60 text-center pt-1">素材ドロップなし</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={onRetry} variant="outline" className="bg-white/5 border-white/20 text-white hover:bg-white/10">
            <RotateCcw className="w-4 h-4 mr-1" /> もう一回
          </Button>
          <Button onClick={onBack} className="bg-white text-[#1a1a2e] hover:bg-white/90 font-bold">
            <ArrowLeft className="w-4 h-4 mr-1" /> ステージへ
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DungeonResult;