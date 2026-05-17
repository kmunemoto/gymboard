import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { Coins, Loader2 } from "lucide-react";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

interface Props {
  open: boolean;
  onClose: () => void;
}

const PACKS = [
  { priceId: "coin_starter_jpy_300", name: "スターター", coins: 200, price: 300, badge: null },
  { priceId: "coin_value_jpy_800", name: "バリュー", coins: 800, price: 800, badge: "おすすめ" },
  { priceId: "coin_premium_jpy_1800", name: "プレミアム", coins: 2000, price: 1800, badge: "お得" },
];

const CoinShopDialog = ({ open, onClose }: Props) => {
  const { user } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSelect = async (priceId: string) => {
    if (!user) return;
    setLoading(true);
    setSelected(priceId);
    setLoading(false);
  };

  const fetchClientSecret = async (): Promise<string> => {
    const { data, error } = await supabase.functions.invoke("create-checkout", {
      body: {
        priceId: selected,
        customerEmail: user?.email,
        userId: user?.id,
        environment: getStripeEnvironment(),
        returnUrl: `${window.location.origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      },
    });
    if (error || !data?.clientSecret) {
      toast.error("決済の準備に失敗しました");
      throw new Error(error?.message || "no clientSecret");
    }
    return data.clientSecret;
  };

  const handleClose = () => {
    setSelected(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto p-0">
        <DialogTitle className="sr-only">コインショップ</DialogTitle>
        <PaymentTestModeBanner />
        <div className="p-5">
          <div className="text-center mb-4">
            <div className="inline-flex items-center gap-2 text-amber-600 font-bold">
              <Coins className="w-5 h-5" />
              <span className="text-lg">コインショップ</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">アバターのカスタマイズに使えるコイン</p>
          </div>

          {!selected && (
            <div className="space-y-3">
              {PACKS.map((p) => (
                <button
                  key={p.priceId}
                  onClick={() => handleSelect(p.priceId)}
                  disabled={loading}
                  className="w-full p-4 rounded-2xl border border-border bg-card hover:border-accent/50 transition-all text-left flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-base">{p.name}</p>
                      {p.badge && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
                          {p.badge}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-amber-600 font-bold">
                      <Coins className="w-4 h-4" />
                      <span>{p.coins} コイン</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-extrabold text-lg">¥{p.price.toLocaleString()}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="mb-2">
                ← 戻る
              </Button>
              <div id="checkout">
                <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CoinShopDialog;