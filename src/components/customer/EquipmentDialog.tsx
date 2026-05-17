import { useEffect, useState } from "react";
import { X, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEquipmentInventory } from "@/hooks/useQuestBattle";
import { getEquipIcon, RARITY_COLOR, RARITY_LABEL } from "@/lib/questBosses";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

const TYPES: Array<{ key: "weapon" | "shield" | "amulet" | "top" | "bottom"; label: string }> = [
  { key: "weapon", label: "武器" },
  { key: "shield", label: "盾" },
  { key: "amulet", label: "護符" },
  { key: "top", label: "トップス" },
  { key: "bottom", label: "ボトムス" },
];

const SOURCE_LABEL: Record<string, string> = {
  starter: "初期装備",
  raid: "レイド報酬",
  quest: "クエスト報酬",
  gacha: "ガチャ",
};

const EquipmentDialog = ({ open, onClose }: Props) => {
  const { user } = useAuth();
  const { items, loading, refetch } = useEquipmentInventory();
  const [busy, setBusy] = useState<string | null>(null);
  const [allItems, setAllItems] = useState<any[]>([]);

  const handleClose = () => {
    window.dispatchEvent(new Event("equipment-updated"));
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    (supabase as any)
      .from("equipment_items")
      .select("id,item_key,item_name,item_type,rarity,atk_bonus,def_bonus,hp_bonus,icon_name,source,image_path")
      .then(({ data }: any) => setAllItems(data || []));
  }, [open]);

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  if (!open) return null;
  const ownedKeys = new Set(items.map((i: any) => i.item_key));
  const totalCount = allItems.length || 12;
  const ownedCount = ownedKeys.size;
  const completePct = totalCount ? Math.round((ownedCount / totalCount) * 100) : 0;

  const equip = async (item_id: string) => {
    if (!user) return;
    setBusy(item_id);
    const { error } = await supabase.rpc("equip_item", { p_user_id: user.id, p_item_id: item_id });
    setBusy(null);
    if (error) {
      toast.error("装備変更に失敗", { description: error.message });
      return;
    }
    await refetch();
    window.dispatchEvent(new Event("equipment-updated"));
    toast.success("装備を変更しました");
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4"
      onClick={handleClose}
      onTouchMove={(e) => e.stopPropagation()}
      style={{ overscrollBehavior: 'contain' }}
    >
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-[#1a1a2e] text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ overscrollBehavior: 'contain' }}
      >
        <div className="sticky top-0 bg-[#1a1a2e] flex items-center justify-between px-4 py-3 border-b border-white/10 z-[130]">
          <h2 className="text-base font-bold">装備</h2>
          <button onClick={handleClose} className="p-1 hover:opacity-70"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <div className="p-4 space-y-5">
            {TYPES.map((t) => {
              const list = items.filter((i: any) => i.item_type === t.key);
              const lockedList = allItems.filter(
                (i: any) => i.item_type === t.key && !ownedKeys.has(i.item_key),
              );
              const equipped = list.find((i: any) => i.equipped);
              return (
                <div key={t.key}>
                  <h3 className="text-xs font-bold tracking-wider opacity-70 mb-2">{t.label}</h3>
                  {list.length === 0 ? (
                    <p className="text-xs opacity-60 px-2 py-3 text-center bg-white/5 rounded-lg">未所持</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {list.map((it: any) => {
                        const Icon = getEquipIcon(it.icon_name);
                        const color = RARITY_COLOR[it.rarity];
                        const isEq = it.equipped;
                        return (
                          <button
                            key={it.owned_id}
                            onClick={() => !isEq && equip(it.id)}
                            disabled={isEq || busy === it.id}
                            className={`relative rounded-xl p-3 text-left transition ${isEq ? "ring-2" : "hover:bg-white/10"} bg-white/5`}
                            style={{ boxShadow: `inset 0 0 0 1px ${color}40`, ...(isEq ? { ["--tw-ring-color" as any]: color } : {}) }}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Icon className="w-4 h-4" style={{ color }} />
                              <span className="text-[9px] font-bold uppercase" style={{ color }}>{RARITY_LABEL[it.rarity]}</span>
                            </div>
                            <p className="text-xs font-bold leading-tight break-all">{it.item_name}</p>
                            <div className="text-[10px] opacity-80 mt-1 space-y-0.5">
                              {it.atk_bonus > 0 && <p>ATK +{it.atk_bonus}</p>}
                              {it.def_bonus > 0 && <p>DEF +{it.def_bonus}</p>}
                              {it.hp_bonus > 0 && <p>HP +{it.hp_bonus}</p>}
                            </div>
                            {isEq && <span className="absolute top-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-white text-[#1a1a2e]">装備中</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {lockedList.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {lockedList.map((it: any) => {
                        const color = RARITY_COLOR[it.rarity] || "#9ca3af";
                        return (
                          <div
                            key={it.id}
                            className="relative rounded-xl p-3 bg-white/[0.03] opacity-60"
                            style={{ boxShadow: `inset 0 0 0 1px ${color}30` }}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Lock className="w-3.5 h-3.5 opacity-70" />
                              <span className="text-[9px] font-bold uppercase" style={{ color }}>
                                {RARITY_LABEL[it.rarity]}
                              </span>
                            </div>
                            <p className="text-xs font-bold leading-tight break-all">{it.item_name}</p>
                            <p className="text-[10px] opacity-70 mt-1">
                              入手: {SOURCE_LABEL[it.source] || it.source}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Collection progress */}
            <div className="rounded-2xl bg-white/5 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold tracking-wider opacity-80">コレクション</p>
                <p className="text-sm font-extrabold">
                  {ownedCount} / {totalCount}
                </p>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${completePct}%`,
                    background: "linear-gradient(90deg, #0ABAB5, #f59e0b)",
                  }}
                />
              </div>
              {ownedCount >= totalCount ? (
                <p className="text-[11px] font-bold text-center" style={{ color: "#f59e0b" }}>
                  全装備コンプリート！「武装の達人」称号獲得
                </p>
              ) : (
                <p className="text-[11px] opacity-70 text-center">
                  全{totalCount}種コンプで称号「武装の達人」と200コイン
                </p>
              )}
            </div>
          </div>
        )}

        <div className="sticky bottom-0 bg-[#1a1a2e] p-3 border-t border-white/10 z-[130]">
          <Button onClick={handleClose} className="w-full bg-white text-[#1a1a2e] hover:bg-white/90 font-bold">閉じる</Button>
        </div>
      </div>
    </div>
  );
};

export default EquipmentDialog;