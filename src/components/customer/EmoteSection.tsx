import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Coins, Lock, Check, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEmotes } from "@/hooks/useEmotes";
import { useAvatar } from "@/hooks/useAvatar";
import { getEmoteVideoSrc } from "@/lib/emotes";

const EmoteSection = () => {
  const { items, owned, loading, purchase } = useEmotes();
  const { avatar, equipEmote, refetch } = useAvatar(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const equipped = avatar?.equipped_emote ?? null;
  const coins = avatar?.coins ?? 0;
  const previewItem = items.find((i) => i.item_key === previewKey);

  const handleTile = async (itemKey: string) => {
    if (!owned.has(itemKey)) {
      setPreviewKey(itemKey);
      return;
    }
    if (equipped === itemKey) {
      await equipEmote(null);
      toast.success("エモーションを解除しました");
    } else {
      await equipEmote(itemKey);
      toast.success("エモーションを装備しました");
    }
  };

  const handlePurchase = async () => {
    if (!previewItem) return;
    setBusy(true);
    try {
      const res = await purchase(previewItem.item_key);
      await refetch();
      toast.success(res.already_owned ? "装備しました" : `購入しました（${previewItem.name}）`);
      setPreviewKey(null);
    } catch (e: any) {
      toast.error(e?.message || "購入に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-bold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              エモーション
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">アバターに動きをつけられます</p>
          </div>
          <div className="flex items-center gap-1 text-amber-600 font-bold text-sm">
            <Coins className="w-3.5 h-3.5" />
            <span>{coins.toLocaleString()}</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-accent" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {/* なし */}
            <button
              type="button"
              onClick={() => equipEmote(null)}
              className={`rounded-xl border-2 p-2 flex flex-col items-center transition ${equipped === null ? "border-accent bg-accent/10" : "border-border bg-card hover:bg-muted/40"}`}
            >
              <div className="w-full aspect-square rounded-lg bg-muted/40 flex items-center justify-center text-muted-foreground text-[10px] font-bold">
                なし
              </div>
              <span className="mt-1 text-[10px] font-bold">静止画</span>
              {equipped === null && <Check className="w-3 h-3 text-accent" />}
            </button>

            {items.map((it) => {
              const isOwned = owned.has(it.item_key);
              const isEquipped = equipped === it.item_key;
              const src = getEmoteVideoSrc(it.item_key) || "";
              return (
                <button
                  key={it.item_key}
                  type="button"
                  onClick={() => handleTile(it.item_key)}
                  className={`relative rounded-xl border-2 p-2 flex flex-col items-center transition ${isEquipped ? "border-accent bg-accent/10" : "border-border bg-card hover:bg-muted/40"}`}
                >
                  <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-muted/40">
                    <video
                      src={src}
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="metadata"
                      className={`w-full h-full object-cover ${isOwned ? "" : "opacity-40"}`}
                    />
                    {!isOwned && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/30">
                        <Lock className="w-4 h-4 text-foreground" />
                      </div>
                    )}
                  </div>
                  <span className="mt-1 text-[10px] font-bold leading-tight text-center break-all">{it.name}</span>
                  {isOwned ? (
                    isEquipped ? (
                      <span className="text-[10px] text-accent font-bold flex items-center gap-0.5"><Check className="w-3 h-3" />装備中</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">タップで装備</span>
                    )
                  ) : (
                    <span className="text-[10px] text-amber-600 font-bold flex items-center gap-0.5">
                      <Coins className="w-3 h-3" />{it.price}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={!!previewKey} onOpenChange={(o) => !o && setPreviewKey(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="text-base font-bold">エモーションを購入</DialogTitle>
          {previewItem && (
            <div className="space-y-3">
              <div className="aspect-square w-full rounded-2xl overflow-hidden bg-muted">
                <video
                  src={getEmoteVideoSrc(previewItem.item_key) || ""}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="text-center">
                <p className="text-base font-bold">{previewItem.name}</p>
                <p className="text-sm text-amber-600 font-bold flex items-center justify-center gap-1 mt-1">
                  <Coins className="w-4 h-4" />{previewItem.price} コイン
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">所持コイン: {coins.toLocaleString()}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPreviewKey(null)} disabled={busy}>キャンセル</Button>
                <Button className="flex-1" onClick={handlePurchase} disabled={busy || coins < previewItem.price}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (coins < previewItem.price ? "コイン不足" : "購入する")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default EmoteSection;