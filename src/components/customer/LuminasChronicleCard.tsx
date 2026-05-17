import { Sword, ChevronRight } from "lucide-react";

interface Props {
  onOpen: () => void;
}

const LuminasChronicleCard = ({ onOpen }: Props) => {
  return (
    <button
      onClick={onOpen}
      disabled
      className="w-full rounded-2xl p-5 text-left text-white shadow-lg transition relative overflow-hidden cursor-not-allowed"
      style={{ background: "linear-gradient(135deg, #0a0a3a 0%, #1a1a5e 100%)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <Sword className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-wider opacity-80">LUMINAS CHRONICLE</p>
            <p className="font-bold text-base leading-tight break-all">ルミナス・クロニクル</p>
            <p className="text-[11px] opacity-80 mt-1 break-all">〜光の年代記〜</p>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-white/20 shrink-0">準備中</span>
      </div>
      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
        <span className="text-sm font-bold tracking-wider px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-sm border border-white/30">準備中</span>
      </div>
    </button>
  );
};

export default LuminasChronicleCard;