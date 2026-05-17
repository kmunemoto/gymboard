import { Dumbbell, Users } from "lucide-react";

interface ModeToggleProps {
  mode: "customer" | "trainer";
  onToggle: (mode: "customer" | "trainer") => void;
}

const ModeToggle = ({ mode, onToggle }: ModeToggleProps) => {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-1 p-2 glass border-b border-border">
      <span className="text-[10px] text-muted-foreground mr-2 font-medium">TEST</span>
      <button
        onClick={() => onToggle("customer")}
        className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-200 ${
          mode === "customer"
            ? "accent-gradient text-accent-foreground shadow-md"
            : "bg-secondary text-muted-foreground hover:text-foreground"
        }`}
      >
        <Dumbbell className="w-3.5 h-3.5" />
        顧客
      </button>
      <button
        onClick={() => onToggle("trainer")}
        className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-200 ${
          mode === "trainer"
            ? "gym-gradient text-primary-foreground shadow-md"
            : "bg-secondary text-muted-foreground hover:text-foreground"
        }`}
      >
        <Users className="w-3.5 h-3.5" />
        トレーナー
      </button>
    </div>
  );
};

export default ModeToggle;
