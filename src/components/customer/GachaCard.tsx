import { useState, useEffect } from "react";
import { Sparkles, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGacha } from "@/hooks/useGacha";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ACHIEVEMENTS } from "@/lib/avatarSystem";
import GachaAnimation from "./GachaAnimation";

const GachaCard = () => {
  const { ticketCount, loading, spinning, spin } = useGacha();
  const { user } = useAuth();
  const [epicBonus, setEpicBonus] = useState(0);
  useEffect(() => {
    if (!user) return;
    supabase
      .from("avatar_achievements")
      .select("achievement_key")
      .eq("user_id", user.id)
      .then(({ data }) => {
        const keys = ((data as any[]) || []).map((r) => r.achievement_key as string);
        const epicSet = new Set(ACHIEVEMENTS.filter((a) => a.rarity === "epic").map((a) => a.key));
        const epicCount = keys.filter((k) => epicSet.has(k)).length;
        setEpicBonus(epicCount >= 10 ? 2 : epicCount >= 5 ? 1 : 0);
      });
  }, [user]);
  const [open, setOpen] = useState(false);

  if (loading) return null;
  if (ticketCount <= 0 && !open) return null;

  const emphasize = ticketCount >= 2;

  return (
    <>
      <style>{`
        @keyframes ticket-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
        .ticket-cta { animation: ticket-pulse 1.6s ease-in-out infinite; }
      `}</style>

      {/* Card */}
      <div
        className="rounded-2xl p-4 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0ABAB5 0%, #06908C 100%)" }}
      >
        <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-white/10" />
        <div className="absolute -bottom-8 -left-4 w-24 h-24 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-tight">トレーニングガチャ</p>
            <div className="flex items-center gap-1 mt-0.5">
              <Ticket className="w-3.5 h-3.5 opacity-90" />
              <p className={`text-xs ${emphasize ? "font-extrabold" : "opacity-95"}`}>
                未使用チケット <span className="text-base font-extrabold">{ticketCount}</span> 枚
              </p>
            </div>
            {epicBonus > 0 && (
              <p className="text-[10px] mt-0.5 opacity-90 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                バッジボーナス: legendary +{epicBonus}%
              </p>
            )}
          </div>
        </div>
        <Button
          onClick={() => setOpen(true)}
          disabled={spinning || open}
          className={`mt-3 w-full font-bold bg-white text-[#06908C] hover:bg-white/90 ${emphasize ? "ticket-cta" : ""}`}
        >
          ガチャを回す
        </Button>
      </div>

      <GachaAnimation
        open={open}
        requestSpin={spin}
        onClose={() => setOpen(false)}
        onError={(e) => toast.error("ガチャに失敗しました", { description: e?.message })}
      />
    </>
  );
};

export default GachaCard;
