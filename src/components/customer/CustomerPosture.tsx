import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Camera, Upload, Loader2, RotateCcw, AlertCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import PostureFeedbackCard from "./posture/PostureFeedbackCard";
import SkeletalTypeCard from "./posture/SkeletalTypeCard";
import TrainingRecommendationCard from "./posture/TrainingRecommendationCard";
import { analyzePosture } from "./posture/postureAnalysis";
import { diagnoseSkeletalType } from "./posture/skeletalDiagnosis";
import type { Keypoint } from "./posture/types";

// BlazePose 33-keypoint skeleton edges
const SKELETON_EDGES: [number, number][] = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  // Shoulders
  [11, 12],
  // Left arm
  [11, 13], [13, 15],
  // Right arm
  [12, 14], [14, 16],
  // Left hand
  [15, 17], [15, 19], [15, 21],
  // Right hand
  [16, 18], [16, 20], [16, 22],
  // Torso
  [11, 23], [12, 24], [23, 24],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
  // Left foot
  [27, 29], [29, 31], [27, 31],
  // Right foot
  [28, 30], [30, 32], [28, 32],
];

const MIN_SCORE_DETECT = 0.2; // 解析に使用する閾値
const MIN_SCORE_DRAW = 0.3;   // 描画に使用する閾値

const CustomerPosture = () => {
  const { user } = useAuth();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [keypoints, setKeypoints] = useState<Keypoint[]>([]);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0, natW: 0, natH: 0 });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const detectorRef = useRef<any>(null);

  const getDetector = useCallback(async () => {
    if (detectorRef.current) return detectorRef.current;
    setModelLoading(true);
    try {
      const tf = await import("@tensorflow/tfjs");
      await tf.setBackend("webgl");
      await tf.ready();
      const poseDetection = await import("@tensorflow-models/pose-detection");
      const detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.BlazePose,
        {
          runtime: "tfjs" as const,
          modelType: "heavy",
        }
      );
      detectorRef.current = detector;
      return detector;
    } catch (e) {
      console.error("Model load error:", e);
      toast.error("AIモデルの読み込みに失敗しました");
      return null;
    } finally {
      setModelLoading(false);
    }
  }, []);

  const normalizeImage = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const tempImg = new Image();
      tempImg.onload = () => {
        const offscreen = document.createElement("canvas");
        offscreen.width = tempImg.naturalWidth;
        offscreen.height = tempImg.naturalHeight;
        const ctx = offscreen.getContext("2d");
        if (!ctx) { reject(new Error("Canvas context failed")); return; }
        ctx.drawImage(tempImg, 0, 0);
        offscreen.toBlob((blob) => {
          URL.revokeObjectURL(tempImg.src);
          if (!blob) { reject(new Error("Blob creation failed")); return; }
          resolve(URL.createObjectURL(blob));
        }, "image/jpeg", 0.92);
      };
      tempImg.onerror = () => { URL.revokeObjectURL(tempImg.src); reject(new Error("Image load failed")); };
      tempImg.src = URL.createObjectURL(file);
    });
  }, []);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("画像ファイルを選択してください");
      return;
    }
    setKeypoints([]);
    try {
      const normalized = await normalizeImage(file);
      setImageUrl(normalized);
    } catch (e) {
      console.error("Image normalization error:", e);
      toast.error("画像の読み込みに失敗しました");
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const analyze = useCallback(async () => {
    const img = imgRef.current;
    if (!img) return;
    setAnalyzing(true);
    try {
      const detector = await getDetector();
      if (!detector) return;

      // High-res input: use natural size capped at 1280px
      const MAX_INPUT = 1280;
      const natW = img.naturalWidth;
      const natH = img.naturalHeight;
      const scale = Math.min(MAX_INPUT / Math.max(natW, natH), 1);
      const inputW = Math.round(natW * scale);
      const inputH = Math.round(natH * scale);

      const inputCanvas = document.createElement("canvas");
      inputCanvas.width = inputW;
      inputCanvas.height = inputH;
      const ictx = inputCanvas.getContext("2d");
      if (!ictx) return;
      ictx.drawImage(img, 0, 0, inputW, inputH);

      // Run estimation 3 times and average for stability
      const NUM_RUNS = 3;
      const allPoses: Keypoint[][] = [];
      for (let i = 0; i < NUM_RUNS; i++) {
        const poses = await detector.estimatePoses(inputCanvas);
        if (poses.length > 0 && poses[0].keypoints?.length) {
          allPoses.push(poses[0].keypoints as Keypoint[]);
        }
      }

      if (allPoses.length === 0) {
        toast.error("姿勢を検出できませんでした。全身が映った写真をお試しください。");
        return;
      }

      // Average keypoints across runs
      const averaged = allPoses[0].map((kp, idx) => {
        const validPoints = allPoses.filter(p => (p[idx].score ?? 0) >= MIN_SCORE_DETECT);
        if (validPoints.length === 0) return kp;
        return {
          ...kp,
          x: validPoints.reduce((sum, p) => sum + p[idx].x, 0) / validPoints.length,
          y: validPoints.reduce((sum, p) => sum + p[idx].y, 0) / validPoints.length,
          score: validPoints.reduce((sum, p) => sum + (p[idx].score ?? 0), 0) / validPoints.length,
        };
      });

      // Scale coordinates from input canvas to display size
      const sx = img.clientWidth / inputW;
      const sy = img.clientHeight / inputH;
      const scaledKeypoints = averaged.map(kp => ({
        ...kp,
        x: kp.x * sx,
        y: kp.y * sy,
      }));

      setKeypoints(scaledKeypoints);
      toast.success("姿勢解析が完了しました！");
    } catch (e) {
      console.error("Pose estimation error:", e);
      toast.error("解析中にエラーが発生しました");
    } finally {
      setAnalyzing(false);
    }
  }, [getDetector]);

  const syncCanvasSize = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgSize({
      w: img.clientWidth,
      h: img.clientHeight,
      natW: img.naturalWidth,
      natH: img.naturalHeight,
    });
  }, []);

  const onImgLoad = useCallback(() => {
    syncCanvasSize();
    analyze();
  }, [analyze, syncCanvasSize]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => syncCanvasSize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [syncCanvasSize]);

  // Draw skeleton — coordinates are in display space, draw directly (no scaling)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || keypoints.length === 0 || imgSize.w === 0) return;

    // Canvas internal resolution = display size → 1:1 pixel mapping with CSS
    canvas.width = imgSize.w;
    canvas.height = imgSize.h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lineW = Math.max(2, imgSize.w / 200);
    const dotR = Math.max(4, imgSize.w / 150);

    // Draw skeleton edges
    ctx.strokeStyle = "hsl(174, 65%, 50%)";
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    for (const [i, j] of SKELETON_EDGES) {
      const a = keypoints[i];
      const b = keypoints[j];
      if (!a || !b) continue;
      if ((a.score ?? 1) < MIN_SCORE_DRAW || (b.score ?? 1) < MIN_SCORE_DRAW) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Draw keypoint dots
    for (const kp of keypoints) {
      if ((kp.score ?? 1) < MIN_SCORE_DRAW) continue;
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, dotR, 0, 2 * Math.PI);
      ctx.fillStyle = "hsl(174, 60%, 45%)";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = Math.max(1.5, lineW * 0.6);
      ctx.stroke();
    }
  }, [keypoints, imgSize]);

  const postureResult = useMemo(
    () => (keypoints.length > 0 ? analyzePosture(keypoints, imgSize.h) : { feedbacks: [], score: 100 }),
    [keypoints, imgSize.h]
  );

  const skeletalDiagnosis = useMemo(
    () => (keypoints.length > 0 ? diagnoseSkeletalType(keypoints, imgSize.h) : null),
    [keypoints, imgSize.h]
  );

  /** Merge the photo and skeleton into a single image at natural resolution */
  const captureOverlayBlob = useCallback(async (): Promise<Blob | null> => {
    const img = imgRef.current;
    if (!img || keypoints.length === 0 || imgSize.w === 0) return null;

    const natW = img.naturalWidth;
    const natH = img.naturalHeight;

    const offscreen = document.createElement("canvas");
    offscreen.width = natW;
    offscreen.height = natH;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return null;

    // Draw original image at natural resolution
    ctx.drawImage(img, 0, 0);

    // Scale keypoints from display space → natural space for high-res capture
    const sx = natW / imgSize.w;
    const sy = natH / imgSize.h;

    const lineW = Math.max(3, natW / 200);
    const dotR = Math.max(5, natW / 150);

    ctx.strokeStyle = "hsl(174, 65%, 50%)";
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    for (const [i, j] of SKELETON_EDGES) {
      const a = keypoints[i];
      const b = keypoints[j];
      if (!a || !b) continue;
      if ((a.score ?? 1) < MIN_SCORE_DRAW || (b.score ?? 1) < MIN_SCORE_DRAW) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * sx, a.y * sy);
      ctx.lineTo(b.x * sx, b.y * sy);
      ctx.stroke();
    }
    for (const kp of keypoints) {
      if ((kp.score ?? 1) < MIN_SCORE_DRAW) continue;
      ctx.beginPath();
      ctx.arc(kp.x * sx, kp.y * sy, dotR, 0, 2 * Math.PI);
      ctx.fillStyle = "hsl(174, 60%, 45%)";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = Math.max(2, lineW * 0.6);
      ctx.stroke();
    }

    return new Promise((resolve) =>
      offscreen.toBlob((blob) => resolve(blob), "image/jpeg", 0.85)
    );
  }, [keypoints, imgSize]);

  const saveDiagnosis = useCallback(async () => {
    if (!user || !skeletalDiagnosis || saved || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      let imageUrlToSave: string | null = null;
      try {
        const blob = await captureOverlayBlob();
        if (blob) {
          const fileName = `${user.id}/${Date.now()}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from("posture-photos")
            .upload(fileName, blob, { contentType: "image/jpeg" });
          if (uploadError) {
            console.warn("Image upload failed:", uploadError);
          } else {
            imageUrlToSave = fileName;
          }
        }
      } catch (uploadErr) {
        // Don't fail the save if image upload fails — diagnosis data is more important
        console.warn("Overlay capture/upload error:", uploadErr);
      }

      const { error } = await supabase.from("skeletal_diagnoses").insert({
        user_id: user.id,
        skeletal_type: skeletalDiagnosis.type,
        confidence: skeletalDiagnosis.confidence,
        scores: skeletalDiagnosis.scores,
        metrics: skeletalDiagnosis.metrics,
        image_url: imageUrlToSave,
      });
      if (error) throw error;
      setSaved(true);
      toast.success("診断結果を保存しました");
    } catch (e: any) {
      console.error("Save diagnosis error:", e);
      const msg = e?.message || e?.error_description || "不明なエラー";
      toast.error(`診断結果の保存に失敗しました: ${msg}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [user, skeletalDiagnosis, saved, captureOverlayBlob]);

  const reset = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    setKeypoints([]);
    setSaved(false);
  };

  const isLoading = analyzing || modelLoading;

  return (
    <div className="px-4 py-4 space-y-4 slide-up">
      <h2 className="text-lg font-bold">姿勢チェック・骨格診断（AI）</h2>
      <p className="text-xs text-muted-foreground">
        全身が映った写真をアップロードすると、AIが33箇所の関節ポイントを解析し、姿勢チェックと骨格タイプ診断を行います。
      </p>

      {!imageUrl ? (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex flex-col items-center gap-3">
              <Button onClick={() => fileRef.current?.click()} className="w-full" size="lg">
                <Upload className="w-4 h-4 mr-2" />
                写真をアップロード
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (fileRef.current) {
                    fileRef.current.setAttribute("capture", "environment");
                    fileRef.current.click();
                    fileRef.current.removeAttribute("capture");
                  }
                }}
                className="w-full"
                size="lg"
              >
                <Camera className="w-4 h-4 mr-2" />
                カメラで撮影
              </Button>
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>全身が映った正面の写真が最適です。骨格タイプ診断には肩・腰・足首が見える写真が必要です。</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <div className="relative w-fit mx-auto">
              <img
                ref={imgRef}
                src={imageUrl}
                alt="姿勢解析用画像"
                className="block w-full h-auto"
                onLoad={onImgLoad}
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
              />
              {isLoading && (
                <div className="absolute inset-0 bg-background/60 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-accent" />
                  <span className="text-sm font-medium">
                    {modelLoading ? "高精度AIモデルを読み込み中…（初回のみ時間がかかります）" : "高精度モードで解析中…"}
                  </span>
                </div>
              )}
            </div>
          </Card>

          {keypoints.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">
                  検出ポイント：{keypoints.filter((k) => (k.score ?? 1) >= MIN_SCORE_DETECT).length} / {keypoints.length}
                </p>
              </CardContent>
            </Card>
          )}

          <SkeletalTypeCard diagnosis={skeletalDiagnosis} />
          <TrainingRecommendationCard skeletalType={skeletalDiagnosis?.type ?? null} feedbacks={postureResult.feedbacks} />
          <PostureFeedbackCard feedbacks={postureResult.feedbacks} score={postureResult.score} />

          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} className="flex-1">
              <RotateCcw className="w-4 h-4 mr-1" />
              やり直す
            </Button>
            {skeletalDiagnosis && user && (
              <Button
                onClick={saveDiagnosis}
                disabled={saved || saving}
                variant={saved ? "outline" : "default"}
                className="flex-1"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-1" />
                )}
                {saved ? "保存済み" : saving ? "保存中…" : "結果を保存"}
              </Button>
            )}
            <Button onClick={analyze} disabled={isLoading} variant="outline" className="flex-1">
              再解析
            </Button>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChange}
      />
    </div>
  );
};

export default CustomerPosture;
