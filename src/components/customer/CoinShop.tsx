import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Coins, Loader2, Leaf, Droplet, TreeDeciduous, Ticket, Zap, Info, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface ShopItem {
  item_key: string;
  item_name: string;
  description: string;
  shop_price: number;
  icon_name: string;
  effect_type: string;
  effect_amount: number;
}

const ICON: Record<string, LucideIcon> = { Leaf, Droplet, TreeDeciduous, Ticket };

const ORDER = ["healing_herb", "healing_herb_plus", "star_water", "star_water_plus", "revival_leaf"];

interface Props {
  open: boolean;
  onClose: () => void;
  coins: number;
  onPurchased?: () => void;
}

const CoinShop = ({ open, onClose, coins, onPurchased }: Props) => {
  const { user } = useAuth();
  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [localCoins, setLocalCoins] = useState(coins);

  useEffect(() => { setLocalCoins(coins); }, [coins]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const { data } = await (supabase as any)
        .from("battle_items")
        .select("item_key,item_name,description,shop_price,icon_name,effect_type,effect_amount")
        .not("shop_price", "is", null);
      const list = ((data as ShopItem[]) || []).sort(
        (a, b) => ORDER.indexOf(a.item_key) - ORDER.indexOf(b.item_key)
      );
      setItems(list);
      setLoading(false);
    })();
  }, [open]);

  const buyItem = async (key: string, price: number) => {
    if (!user) return;
    if (localCoins < price) { toast.error("コインが足りません"); return; }
    setBusy(key);
    const { data, error } = await (supabase as any).rpc("buy_shop_item", {
      p_user_id: user.id, p_item_key: key, p_quantity: 1,
    });
    setBusy(null);
    if (error || data?.error) { toast.error(error?.message || data?.error || "購入に失敗"); return; }
    setLocalCoins(data.remaining_coins);
    toast.success(`${data.item_name}を 手に入れた！`);
    window.dispatchEvent(new Event("avatar-updated"));
    onPurchased?.();
  };

  const buyTicket = async () => {
    if (!user) return;
    if (localCoins < 200) { toast.error("コインが足りません"); return; }
    setBusy("ticket");
    const { data, error } = await (supabase as any).rpc("buy_gacha_ticket", {
      p_user_id: user.id, p_quantity: 1,
    });
    setBusy(null);
    if (error || data?.error) { toast.error(error?.message || data?.error || "購入に失敗"); return; }
    setLocalCoins(data.remaining_coins);
    toast.success("ガチャチケットを手に入れた！");
    window.dispatchEvent(new Event("avatar-updated"));
    onPurchased?.();
  };

  const buyStamina = async () => {
    if (!user) return;
    if (localCoins < 100) { toast.error("コインが足りません"); return; }
    setBusy("stamina");
    const { data, error } = await (supabase as any).rpc("buy_stamina", {
      p_user_id: user.id, p_quantity: 1,
    });
    setBusy(null);
    if (error || data?.error) { toast.error(error?.message || data?.error || "購入に失敗"); return; }
    setLocalCoins(data.remaining_coins);
    toast.success("スタミナを 1回復した！");
    window.dispatchEvent(new Event("avatar-updated"));
    window.dispatchEvent(new Event("stamina-updated"));
    onPurchased?.();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto p-0">
        <DialogTitle className="sr-only">コインショップ</DialogTitle>
        <div className="p-5">
          <div className="text-center mb-4">
            <div className="inline-flex items-center gap-2 text-amber-600 font-bold">
              <Coins className="w-5 h-5" />
              <span className="text-lg">コインショップ</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">所持コイン: {localCoins}</p>
          </div>

          <div className="mb-3 flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
            <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-relaxed">
              トレーニング来店でスタミナ+3を無料獲得できます
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold text-muted-foreground mb-2">回復アイテム</p>
                <div className="space-y-2">
                  {items.map((it) => {
                    const Icon = ICON[it.icon_name] || Leaf;
                    const canAfford = localCoins >= it.shop_price;
                    return (
                      <div key={it.item_key} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
                        <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                          <Icon className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm break-all">{it.item_name}</p>
                          <p className="text-[11px] text-muted-foreground break-all">{it.description}</p>
                          <p className="text-[11px] font-bold text-amber-600 mt-0.5 flex items-center gap-1">
                            <Coins className="w-3 h-3" />{it.shop_price}
                          </p>
                        </div>
                        <button
                          onClick={() => buyItem(it.item_key, it.shop_price)}
                          disabled={!canAfford || busy !== null}
                          className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold disabled:opacity-40 active:scale-95"
                        >
                          {busy === it.item_key ? <Loader2 className="w-3 h-3 animate-spin" /> : "購入"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-muted-foreground mb-2">スタミナ</p>
                <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
                  <div className="w-10 h-10 rounded-lg bg-yellow-50 flex items-center justify-center shrink-0">
                    <Zap className="w-5 h-5 text-yellow-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">スタミナ+1</p>
                    <p className="text-[11px] text-muted-foreground">ダンジョン1回分</p>
                    <p className="text-[11px] font-bold text-amber-600 mt-0.5 flex items-center gap-1">
                      <Coins className="w-3 h-3" />100
                    </p>
                  </div>
                  <button
                    onClick={buyStamina}
                    disabled={localCoins < 100 || busy !== null}
                    className="px-3 py-1.5 rounded-lg bg-yellow-500 text-white text-xs font-bold disabled:opacity-40 active:scale-95"
                  >
                    {busy === "stamina" ? <Loader2 className="w-3 h-3 animate-spin" /> : "購入"}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-muted-foreground mb-2">ガチャ</p>
                <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                    <Ticket className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">ガチャチケット</p>
                    <p className="text-[11px] text-muted-foreground">ガチャ1回分</p>
                    <p className="text-[11px] font-bold text-amber-600 mt-0.5 flex items-center gap-1">
                      <Coins className="w-3 h-3" />200
                    </p>
                  </div>
                  <button
                    onClick={buyTicket}
                    disabled={localCoins < 200 || busy !== null}
                    className="px-3 py-1.5 rounded-lg bg-purple-500 text-white text-xs font-bold disabled:opacity-40 active:scale-95"
                  >
                    {busy === "ticket" ? <Loader2 className="w-3 h-3 animate-spin" /> : "購入"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full mt-5 py-2.5 rounded-xl bg-muted text-foreground text-sm font-bold"
          >
            閉じる
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CoinShop;