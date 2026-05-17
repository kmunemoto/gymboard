import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, Download, Loader2, Moon, Sun, Image as ImageIcon, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import WorkoutShareCard, { type ShareTheme } from "./WorkoutShareCard";
import { formatShareDate, type WorkoutSession } from "@/lib/workoutShare";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  open: boolean;
  onClose: () => void;
  session: WorkoutSession | null;
  streakWeeks: number;
  totalSessions: number;
}

type PhotoLayout = "center" | "grid" | "bottom";

const WorkoutShareModal = ({ open, onClose, session, streakWeeks, totalSessions }: Props) => {
  const { user } = useAuth();
  const [featuredBadges, setFeaturedBadges] = useState<string[]>([]);
  useEffect(() => {
    if (!open || !user) return;
    supabase
      .from("user_avatars")
      .select("featured_badges")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setFeaturedBadges(((data as any)?.featured_badges as string[]) || []);
      });
  }, [open, user]);
  const [theme, setTheme] = useState<ShareTheme>("dark");
  const [busy, setBusy] = useState(false);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [fullScreenImageSrc, setFullScreenImageSrc] = useState<string | null>(null);
  const [photoCompositeSrc, setPhotoCompositeSrc] = useState<string | null>(null);
  const [photoLayout, setPhotoLayout] = useState<PhotoLayout>("center");
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Cleanup any blob URLs we create
  useEffect(() => {
    return () => {
      if (fullScreenImageSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(fullScreenImageSrc);
      }
    };
  }, [fullScreenImageSrc]);

  // Cleanup composite blob URL
  useEffect(() => {
    return () => {
      if (photoCompositeSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(photoCompositeSrc);
      }
    };
  }, [photoCompositeSrc]);

  // Reset composite when modal closes or session changes
  useEffect(() => {
    if (!open) {
      if (photoCompositeSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(photoCompositeSrc);
      }
      setPhotoCompositeSrc(null);
      setSelectedPhotoFile(null);
      setPhotoLayout("center");
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Compute scale so the card fits inside the available preview area
  useLayoutEffect(() => {
    if (!open) return;
    const compute = () => {
      const box = previewBoxRef.current;
      if (!box) return;
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (w <= 0 || h <= 0) return;
      const s = Math.min(w / 1080, h / 1920);
      setScale(s > 0 ? s : 0.3);
    };
    compute();
    window.addEventListener("resize", compute);
    const t = setTimeout(compute, 50);
    return () => {
      window.removeEventListener("resize", compute);
      clearTimeout(t);
    };
  }, [open, session?.date]);

  if (!open || !session) return null;

  const handleThemeChange = (k: ShareTheme) => {
    setTheme(k);
    // If a photo is selected, re-render with the new theme
    if (selectedPhotoFile) {
      void rerenderComposite(selectedPhotoFile, photoLayout, k);
    }
  };

  const handleLayoutChange = (l: PhotoLayout) => {
    setPhotoLayout(l);
    if (selectedPhotoFile) {
      void rerenderComposite(selectedPhotoFile, l, theme);
    }
  };

  const rerenderComposite = async (
    file: File,
    layout: PhotoLayout,
    currentTheme: ShareTheme,
  ) => {
    setBusy(true);
    try {
      const blob = await renderPhotoComposite(file, layout, currentTheme);
      const url = URL.createObjectURL(blob);
      if (photoCompositeSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(photoCompositeSrc);
      }
      setPhotoCompositeSrc(url);
    } catch (err) {
      console.error("[share] re-render failed", err);
    } finally {
      setBusy(false);
    }
  };

  const renderPhotoComposite = async (
    file: File,
    layout: PhotoLayout,
    currentTheme: ShareTheme,
  ): Promise<Blob> => {
    const photoUrl = URL.createObjectURL(file);
    try {
      const photo = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("photo load failed"));
        img.src = photoUrl;
      });

      // Wait for fonts before drawing text
      try {
        await (document as any).fonts?.ready;
      } catch {}

      const W = 1080;
      const H = 1920;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;

      // Cover-fit the photo
      const photoAspect = photo.width / photo.height;
      const canvasAspect = W / H;
      let sx = 0, sy = 0, sw = photo.width, sh = photo.height;
      if (photoAspect > canvasAspect) {
        sw = photo.height * canvasAspect;
        sx = (photo.width - sw) / 2;
      } else {
        sh = photo.width / canvasAspect;
        sy = (photo.height - sh) / 2;
      }
      ctx.drawImage(photo, sx, sy, sw, sh, 0, 0, W, H);

      // Theme-aware text rendering. NO overlays. NO gradients on the photo itself.
      // Light mode = dark text + white shadow. Otherwise white text + dark shadow.
      const isLight = currentTheme === "light";
      const textColor = isLight ? "#1A1A1A" : "#FFFFFF";
      const shadowColor = isLight
        ? "rgba(255,255,255,0.85)"
        : "rgba(0,0,0,0.85)";

      const FONT =
        "system-ui, -apple-system, 'Helvetica Neue', Arial, 'Noto Sans JP', 'Hiragino Sans', sans-serif";

      const applyShadow = () => {
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
      };
      const clearShadow = () => {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      };

      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = textColor;
      applyShadow();

      const visible = session.exercises.slice(0, 3);
      const dateStr = formatShareDate(session.date);

      // Helper: draw centered text with shadow already set
      const drawCenter = (text: string, cx: number, cy: number) => {
        ctx.fillText(text, cx, cy);
      };

      // Draw "Salute 御所南" with "Salute" in Tiffany blue, rest in current textColor.
      const drawSaluteTitle = (cx: number, cy: number) => {
        const salute = "Salute";
        const rest = " 御所南";
        const wSalute = ctx.measureText(salute).width;
        const wRest = ctx.measureText(rest).width;
        const total = wSalute + wRest;
        const startX = cx - total / 2;
        const prevAlign = ctx.textAlign;
        const prevFill = ctx.fillStyle;
        ctx.textAlign = "left";
        ctx.fillStyle = "#0ABAB5";
        ctx.fillText(salute, startX, cy);
        ctx.fillStyle = prevFill as string;
        ctx.fillText(rest, startX + wSalute, cy);
        ctx.textAlign = prevAlign;
      };

      if (layout === "center") {
        // Compute centered stack
        const labelGap = 16;
        const blockGap = 56;
        const exerciseGap = 18;
        const exerciseBlockGap = 36;

        // Estimated heights
        const timeH = 28 + labelGap + 88;
        const exH = visible.length === 0
          ? 0
          : visible.length * (44 + exerciseGap + 32) +
            (visible.length - 1) * exerciseBlockGap;
        const dateBlockH = 32 + 14 + 36 + 10 + 22;
        const totalH = timeH + blockGap + exH + blockGap + dateBlockH;

        let y = (H - totalH) / 2;

        // Time label
        ctx.font = `300 28px ${FONT}`;
        drawCenter("トレーニング時間", W / 2, y + 28);
        y += 28 + labelGap;
        // Time value
        ctx.font = `800 88px ${FONT}`;
        drawCenter(`${session.durationMin}分`, W / 2, y + 80);
        y += 88 + blockGap;

        // Exercises
        for (let i = 0; i < visible.length; i++) {
          const ex = visible[i];
          ctx.font = `700 44px ${FONT}`;
          drawCenter(ex.exercise_name, W / 2, y + 44);
          y += 44 + exerciseGap;
          ctx.font = `400 32px ${FONT}`;
          drawCenter(`${ex.maxWeight}kg × ${ex.totalReps}`, W / 2, y + 32);
          y += 32;
          if (i < visible.length - 1) y += exerciseBlockGap;
        }
        y += blockGap;

        // Date
        ctx.font = `400 32px ${FONT}`;
        drawCenter(dateStr, W / 2, y + 32);
        y += 32 + 14;

        // Footer
        ctx.font = `600 36px ${FONT}`;
        drawSaluteTitle(W / 2, y + 36);
        y += 36 + 10;
        ctx.font = `300 22px ${FONT}`;
        drawCenter("PERSONAL GYM", W / 2, y + 22);
      } else if (layout === "grid") {
        // 2-column grid centered vertically (slightly below middle)
        const top = H * 0.42;
        const colLeftX = W * 0.28;
        const colRightX = W * 0.72;
        const rowGap = 140;

        const top1 = visible[0];

        const drawCell = (
          label: string,
          value: string,
          cx: number,
          cy: number,
          valueSize = 72,
        ) => {
          ctx.font = `300 24px ${FONT}`;
          drawCenter(label, cx, cy);
          ctx.font = `800 ${valueSize}px ${FONT}`;
          drawCenter(value, cx, cy + 24 + 16 + valueSize - 8);
        };

        // Row 1
        drawCell("種目数", `${session.exercises.length}`, colLeftX, top);
        drawCell("トレーニング時間", `${session.durationMin}分`, colRightX, top);
        // Row 2
        const r2 = top + rowGap;
        drawCell(
          "総セット",
          `${session.exercises.reduce((a, e) => a + (e.setsCount ?? 1), 0)}`,
          colLeftX,
          r2,
        );
        if (top1) {
          // Top exercise: smaller value (name can be long)
          ctx.font = `300 24px ${FONT}`;
          drawCenter("トップ種目", colRightX, r2);
          ctx.font = `700 36px ${FONT}`;
          drawCenter(top1.exercise_name, colRightX, r2 + 24 + 16 + 36 - 8);
          ctx.font = `400 28px ${FONT}`;
          drawCenter(
            `${top1.maxWeight}kg × ${top1.totalReps}`,
            colRightX,
            r2 + 24 + 16 + 36 - 8 + 36,
          );
        }

        // Footer (date + gym)
        const footerY = H - 220;
        ctx.font = `400 30px ${FONT}`;
        drawCenter(dateStr, W / 2, footerY);
        ctx.font = `600 36px ${FONT}`;
        drawSaluteTitle(W / 2, footerY + 60);
        ctx.font = `300 22px ${FONT}`;
        drawCenter("PERSONAL GYM", W / 2, footerY + 96);
      } else {
        // bottom layout — Strava-style. Apply gradient ONLY for dark mode.
        if (currentTheme === "dark") {
          clearShadow();
          const gradient = ctx.createLinearGradient(0, 1200, 0, H);
          gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
          gradient.addColorStop(0.3, "rgba(0, 0, 0, 0.45)");
          gradient.addColorStop(1, "rgba(0, 0, 0, 0.8)");
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 1200, W, H - 1200);
          ctx.fillStyle = textColor;
          applyShadow();
        }

        // Layout heights
        const visBottom = session.exercises.slice(0, 3);
        const exerciseBlockH = visBottom.length * (36 + 8 + 30 + 24);
        const timeBlockH = 28 + 20 + 64;
        const dateH = 28 + 20;
        const totalContentH = timeBlockH + 50 + exerciseBlockH + dateH;
        const footerTop = H - 140;
        const contentTop = Math.max(1320, footerTop - 40 - totalContentH);
        let y = contentTop;

        ctx.font = `300 28px ${FONT}`;
        drawCenter("トレーニング時間", W / 2, y + 28);
        y += 28 + 20;
        ctx.font = `800 64px ${FONT}`;
        drawCenter(`${session.durationMin}分`, W / 2, y + 60);
        y += 64 + 50;

        for (const ex of visBottom) {
          ctx.font = `700 36px ${FONT}`;
          drawCenter(ex.exercise_name, W / 2, y + 36);
          y += 36 + 8;
          ctx.font = `400 30px ${FONT}`;
          drawCenter(`${ex.maxWeight}kg × ${ex.totalReps}`, W / 2, y + 30);
          y += 30 + 24;
        }

        ctx.font = `400 28px ${FONT}`;
        drawCenter(dateStr, W / 2, y + 28);

        ctx.font = `600 34px ${FONT}`;
        drawSaluteTitle(W / 2, H - 70);
        ctx.font = `300 20px ${FONT}`;
        drawCenter("PERSONAL GYM", W / 2, H - 35);
      }

      clearShadow();

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png", 0.95),
      );
      if (!blob) throw new Error("blob failed");
      return blob;
    } finally {
      URL.revokeObjectURL(photoUrl);
    }
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      setSelectedPhotoFile(file);
      const blob = await renderPhotoComposite(file, photoLayout, theme);
      const url = URL.createObjectURL(blob);
      if (photoCompositeSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(photoCompositeSrc);
      }
      setPhotoCompositeSrc(url);
    } catch (err) {
      console.error("[share] photo composite failed", err);
      toast({ title: "写真の読み込みに失敗しました", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const resetAllState = () => {
    if (fullScreenImageSrc?.startsWith("blob:")) {
      URL.revokeObjectURL(fullScreenImageSrc);
    }
    if (photoCompositeSrc?.startsWith("blob:")) {
      URL.revokeObjectURL(photoCompositeSrc);
    }
    setFullScreenImageSrc(null);
    setPhotoCompositeSrc(null);
    setSelectedPhotoFile(null);
    setPhotoLayout("center");
    setTheme("dark");
  };

  const handleCloseAll = () => {
    resetAllState();
    onClose();
  };

  const handleSaveImage = async () => {
    if (busy) return;
    // If a photo composite is active, just open it full-screen
    if (photoCompositeSrc) {
      setFullScreenImageSrc(photoCompositeSrc);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        exercises: session.exercises.slice(0, 6).map((ex) => ({
          name: ex.exercise_name,
          weight: ex.maxWeight,
          reps: ex.totalReps,
        })),
        date: formatShareDate(session.date),
        duration: session.durationMin,
        theme,
      };
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token ?? supabaseKey;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/generate-share-image`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: supabaseKey,
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(errText || "画像生成に失敗しました");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (fullScreenImageSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(fullScreenImageSrc);
      }
      setFullScreenImageSrc(url);
    } catch (e) {
      console.error("[share] generate failed", e);
      toast({ title: "画像の生成に失敗しました", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.94)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", paddingTop: "max(env(safe-area-inset-top), 12px)" }}
      >
        <span className="text-white text-sm font-bold">トレーニング シェア</span>
        <button
          onClick={handleCloseAll}
          className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-white hover:bg-white/25"
          aria-label="閉じる"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Card preview area (scaled to fit) */}
      <div
        ref={previewBoxRef}
        id="share-card-preview"
        className="flex-1 min-h-0 flex items-center justify-center px-4 py-3"
      >
        {photoCompositeSrc ? (
          <img
            src={photoCompositeSrc}
            alt="プレビュー"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          />
        ) : (
        <div
          style={{
            width: 1080 * scale,
            height: 1920 * scale,
            position: "relative",
            borderRadius: 24 * scale,
            overflow: "hidden",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            background:
              theme === "transparent"
                ? "#333333"
                : "transparent",
          }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              width: 1080,
              height: 1920,
            }}
          >
            <WorkoutShareCard
              session={session}
              theme={theme}
              streakWeeks={streakWeeks}
              totalSessions={totalSessions}
              featuredBadges={featuredBadges}
            />
          </div>
        </div>
        )}
      </div>

      {/* Theme switcher */}
      <div className="flex items-center justify-center gap-3 px-4 pb-3 shrink-0">
        {([
          { k: "dark" as const, icon: Moon, label: "Dark" },
          { k: "light" as const, icon: Sun, label: "Light" },
          { k: "transparent" as const, icon: ImageIcon, label: "透過" },
        ]).map(({ k, icon: Icon, label }) => (
          <button
            key={k}
            onClick={() => handleThemeChange(k)}
            className={`flex items-center gap-1.5 px-4 h-10 rounded-full text-xs font-bold transition ${
              theme === k
                ? "bg-accent text-accent-foreground"
                : "bg-white/15 text-white hover:bg-white/25"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Photo composite button */}
      <div className="flex items-center justify-center px-4 pb-3 shrink-0">
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handlePhotoSelect}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className={`flex items-center gap-1.5 px-4 h-10 rounded-full text-xs font-bold transition border ${
            photoCompositeSrc
              ? "bg-accent text-accent-foreground border-transparent"
              : "bg-transparent text-white border-accent hover:bg-white/10"
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          {photoCompositeSrc ? "写真を変更" : "写真と合成"}
        </button>
      </div>

      {/* Layout selector — only when a photo is composited */}
      {photoCompositeSrc && (
        <div className="flex items-center justify-center gap-4 px-4 pb-3 shrink-0">
          {([
            { k: "center" as const, label: "中央" },
            { k: "grid" as const, label: "グリッド" },
            { k: "bottom" as const, label: "下部" },
          ]).map(({ k, label }) => {
            const active = photoLayout === k;
            return (
              <button
                key={k}
                onClick={() => handleLayoutChange(k)}
                disabled={busy}
                className="flex flex-col items-center gap-1"
              >
                <div
                  className="rounded-md flex flex-col items-center justify-center"
                  style={{
                    width: 40,
                    height: 60,
                    background: "rgba(255,255,255,0.08)",
                    border: active
                      ? "2px solid #0ABAB5"
                      : "2px solid rgba(255,255,255,0.2)",
                    padding: 4,
                    gap: 3,
                  }}
                >
                  {k === "center" && (
                    <>
                      <div style={{ height: 1, width: "70%", background: "rgba(255,255,255,0.7)" }} />
                      <div style={{ height: 4, width: "60%", background: "#fff" }} />
                      <div style={{ height: 1, width: "50%", background: "rgba(255,255,255,0.7)" }} />
                      <div style={{ height: 1, width: "40%", background: "rgba(255,255,255,0.7)" }} />
                    </>
                  )}
                  {k === "grid" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, width: "100%", height: "100%", padding: 2 }}>
                      <div style={{ background: "rgba(255,255,255,0.7)" }} />
                      <div style={{ background: "rgba(255,255,255,0.7)" }} />
                      <div style={{ background: "rgba(255,255,255,0.7)" }} />
                      <div style={{ background: "rgba(255,255,255,0.7)" }} />
                    </div>
                  )}
                  {k === "bottom" && (
                    <>
                      <div style={{ flex: 1 }} />
                      <div style={{ height: 2, width: "70%", background: "#fff" }} />
                      <div style={{ height: 1, width: "60%", background: "rgba(255,255,255,0.7)" }} />
                      <div style={{ height: 1, width: "50%", background: "rgba(255,255,255,0.7)" }} />
                    </>
                  )}
                </div>
                <span
                  className="text-[10px] font-bold"
                  style={{ color: active ? "#0ABAB5" : "rgba(255,255,255,0.7)" }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div className="px-4 pb-[max(env(safe-area-inset-bottom),16px)] shrink-0">
        <Button
          variant="accent"
          className="w-full h-12"
          onClick={handleSaveImage}
          disabled={busy}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          画像を保存
        </Button>
      </div>

      {/* Full-screen loading overlay while the share image is being generated */}
      {busy && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 110,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            color: "#fff",
          }}
        >
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <p className="text-sm font-bold">シェア画像を生成中...</p>
        </div>
      )}

      {/* Full-screen image view for long-press save */}
      {fullScreenImageSrc && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 120,
            backgroundColor: "#000",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            paddingTop: "max(env(safe-area-inset-top), 20px)",
            paddingBottom: "max(env(safe-area-inset-bottom), 20px)",
          }}
        >
          <p style={{ color: "#aaa", fontSize: 14, marginBottom: 16, textAlign: "center" }}>
            ↓ 画像を長押しして「写真に追加」で保存
          </p>
          <img
            src={fullScreenImageSrc}
            alt="トレーニングシェア"
            style={{
              maxWidth: "100%",
              maxHeight: "70vh",
              borderRadius: 8,
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            }}
          />
          <button
            onClick={handleCloseAll}
            style={{
              marginTop: 24,
              padding: "12px 60px",
              backgroundColor: "#0ABAB5",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
};

export default WorkoutShareModal;