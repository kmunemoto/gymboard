import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAvatar } from "@/hooks/useAvatar";
import { Coins, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getRankInfo, getAvatarImage, handleAvatarImgError } from "@/lib/avatarSystem";

interface Item {
  item_key: string;
  name: string;
  price: number;
}

const HairColorSection = () => {
  const { user } = useAuth();
  const { avatar, refetch, equipHairColor } = useAvatar(false);
  const [items, setItems] = useState<Item[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const [{ data: itemsData }, { data: ownedData }] = await Promise.all([
      (supabase as any)
        .from("avatar_customization_items")
        .select("item_key, name, price")
        .eq("category", "hair_color")
        .neq("item_key", "orange")
        .order("sort_order", { ascending: true }),
      (supabase as any)
        .from("user_customization_items")
        .select("item_key")
        .eq("user_id", user.id),
    ]);
    setItems((itemsData as Item[]) || []);
    setOwned(new Set(((ownedData as any[]) || []).map((r) => r.item_key)));
    setLoading(false);
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const currentHair = (avatar?.hair_color as string) ?? "orange";
  const gender = (avatar?.gender as "male" | "female") ?? "female";
  const rank = getRankInfo(avatar?.level ?? 1, gender, "orange");

  const handleAction = async (item: Item) => {
    if (busy) return;
    setBusy(item.item_key);
    try {
      if (!owned.has(item.item_key)) {
        const { data, error } = await (supabase as any).rpc("purchase_customization_item", { p_item_key: item.item_key });
        if (error) throw error;
        toast.success(`${item.name}を購入しました`);
        await reload();
        if (data?.already_owned === false || data?.already_owned === true) {
          await equipHairColor(item.item_key);
          toast.success("装着しました");
          await refetch();
        }
      } else {
        await equipHairColor(item.item_key);
        toast.success("装着しました");
      }
    } catch (e: any) {
      toast.error(e?.message || "操作に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  const handleEquipDefault = async () => {
    if (busy) return;
    setBusy("orange");
    try {
      await equipHairColor("orange");
      toast.success("装着しました");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="w-4 h-4 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {/* Default orange */}
      <button
        type="button"
        onClick={handleEquipDefault}
        className={`relative rounded-2xl border-2 p-2 flex flex-col items-center transition ${currentHair === "orange" ? "border-accent bg-accent/10" : "border-border bg-card hover:bg-muted/40"}`}
      >
        <div className="w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center" style={{ backgroundColor: `${rank.color}15` }}>
          <img src={getAvatarImage(rank.key, gender, "orange")} alt="orange" className="w-full h-full object-contain pixel-avatar" onError={handleAvatarImgError} />
        </div>
        <span className="mt-1 text-[11px] font-bold">オレンジ</span>
        <span className="text-[10px] text-muted-foreground">デフォルト</span>
        {currentHair === "orange" && <CheckCircle2 className="absolute top-1 right-1 w-4 h-4 text-accent" />}
      </button>

      {items.map((item) => {
        const isOwned = owned.has(item.item_key);
        const isEquipped = currentHair === item.item_key;
        const coins = avatar?.coins ?? 0;
        const canAfford = coins >= item.price;
        return (
          <button
            key={item.item_key}
            type="button"
            disabled={busy === item.item_key || (!isOwned && !canAfford)}
            onClick={() => handleAction(item)}
            className={`relative rounded-2xl border-2 p-2 flex flex-col items-center transition ${isEquipped ? "border-accent bg-accent/10" : "border-border bg-card hover:bg-muted/40"} disabled:opacity-50`}
          >
            <div className="w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center" style={{ backgroundColor: `${rank.color}15` }}>
              <img
                src={getAvatarImage(rank.key, gender, item.item_key as any)}
                alt={item.item_key}
                className="w-full h-full object-contain pixel-avatar"
                onError={handleAvatarImgError}
              />
            </div>
            <span className="mt-1 text-[11px] font-bold">{item.name}</span>
            {isOwned ? (
              <span className="text-[10px] text-muted-foreground">{isEquipped ? "装着中" : "装着する"}</span>
            ) : (
              <span className="text-[10px] font-bold text-amber-600 flex items-center gap-0.5">
                <Coins className="w-3 h-3" />{item.price}
              </span>
            )}
            {isEquipped && <CheckCircle2 className="absolute top-1 right-1 w-4 h-4 text-accent" />}
            {busy === item.item_key && (
              <div className="absolute inset-0 rounded-2xl bg-background/60 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default HairColorSection;
