import { useState } from "react";
import { Share2, X, Copy } from "lucide-react";
import { ACHIEVEMENTS, getRarityColor } from "@/lib/avatarSystem";
import BadgeIcon, { getAchievementIconComponent } from "./BadgeIcon";
import { toast } from "sonner";

interface Props {
  achievementKey: string | null;
  onClose: () => void;
}

const RARITY_GRADIENT_BG: Record<string, string> = {
  normal: "linear-gradient(135deg, #0ABAB5 0%, #06908C 100%)",
  rare: "linear-gradient(135deg, #6366F1 0%, #4338CA 100%)",
  epic: "linear-gradient(135deg, #F59E0B 0%, #B45309 100%)",
};
const RARITY_LABEL: Record<string, string> = { normal: "ノーマル", rare: "レア", epic: "エピック" };

const generateShareImage = async (key: string, name: string, rarity: string): Promise<Blob | null> => {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Background gradient by rarity
  const grad = ctx.createLinearGradient(0, 0, W, H);
  if (rarity === "epic") {
    grad.addColorStop(0, "#F59E0B");
    grad.addColorStop(1, "#B45309");
  } else if (rarity === "rare") {
    grad.addColorStop(0, "#6366F1");
    grad.addColorStop(1, "#4338CA");
  } else {
    grad.addColorStop(0, "#0ABAB5");
    grad.addColorStop(1, "#06908C");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Decorative circles
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath(); ctx.arc(W * 0.85, H * 0.15, 220, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.1, H * 0.85, 280, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Headline
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.font = "300 48px 'Noto Sans JP', sans-serif";
  ctx.fillText("バッジ獲得！", W / 2, 320);

  // Badge circle
  ctx.beginPath();
  ctx.arc(W / 2, H / 2 - 60, 240, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2 - 60, 200, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();

  // Badge initial (use first char as fallback for icon)
  ctx.fillStyle = grad;
  ctx.font = "700 200px 'Noto Sans JP', sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("★", W / 2, H / 2 - 60);
  ctx.textBaseline = "alphabetic";

  // Name
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "700 96px 'Noto Sans JP', sans-serif";
  ctx.fillText(name, W / 2, H / 2 + 280);

  // Rarity label
  ctx.font = "500 42px 'Noto Sans JP', sans-serif";
  ctx.fillText(`★${RARITY_LABEL[rarity] || ""}`, W / 2, H / 2 + 360);

  // Footer brand
  ctx.font = "700 56px 'Noto Sans JP', sans-serif";
  ctx.fillText("Salute 御所南", W / 2, H - 240);
  ctx.font = "300 28px 'Noto Sans JP', sans-serif";
  ctx.fillText("PERSONAL GYM", W / 2, H - 180);

  return await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
};

const BadgeUnlockShareModal = ({ achievementKey, onClose }: Props) => {
  const [busy, setBusy] = useState(false);
  const a = ACHIEVEMENTS.find((x) => x.key === achievementKey);
  if (!achievementKey || !a) return null;

  const Icon = getAchievementIconComponent(a.key);
  const color = getRarityColor(a.rarity);
  const text = `バッジ「${a.name}」を獲得しました！ #Salute御所南 #パーソナルジム`;

  const handleShare = async () => {
    setBusy(true);
    try {
      const blob = await generateShareImage(a.key, a.name, a.rarity);
      if (blob && navigator.share && (navigator as any).canShare?.({ files: [new File([blob], "badge.png", { type: "image/png" })] })) {
        const file = new File([blob], "badge.png", { type: "image/png" });
        await navigator.share({ files: [file], text });
      } else if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        toast.success("テキストをコピーしました");
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        try {
          await navigator.clipboard.writeText(text);
          toast.success("テキストをコピーしました");
        } catch {
          toast.error("シェアに失敗しました");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-background p-6 relative animate-in zoom-in-95">
        <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <X className="w-4 h-4" />
        </button>
        <p className="text-center text-xs font-bold tracking-widest text-muted-foreground">NEW BADGE</p>
        <p className="text-center text-lg font-extrabold mt-1">バッジ獲得！</p>

        <div
          className="my-5 mx-auto w-44 h-44 rounded-3xl flex items-center justify-center"
          style={{ background: RARITY_GRADIENT_BG[a.rarity] }}
        >
          <BadgeIcon type="achievement" iconKey={a.key} rarity={a.rarity} acquired size={120} />
        </div>

        <p className="text-center font-extrabold text-base">{a.name}</p>
        <p className="text-center text-xs text-muted-foreground mt-1 break-all">{a.description}</p>
        <p className="text-center text-[11px] mt-2 font-bold" style={{ color }}>
          ★ {RARITY_LABEL[a.rarity]}
        </p>

        <button
          onClick={handleShare}
          disabled={busy}
          className="mt-5 w-full h-12 rounded-xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: RARITY_GRADIENT_BG[a.rarity] }}
        >
          <Share2 className="w-4 h-4" />
          シェアする
        </button>
        <button
          onClick={onClose}
          className="mt-2 w-full h-10 rounded-xl font-semibold text-muted-foreground"
        >
          閉じる
        </button>
      </div>
    </div>
  );
};

export default BadgeUnlockShareModal;