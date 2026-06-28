import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { useTranslation } from "react-i18next";
import { Check, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { CropArea } from "@/lib/backgroundImage";

// 背景写真の表示範囲エディタ（全画面）。
// 端末の壁紙設定のように、写真をドラッグで移動・ピンチ/スライダーで拡大縮小して
// 表示したい範囲を決める。エディタの枠は表示領域（画面）と同じ縦横比にするので、
// ここで合わせた範囲がそのまま背景に反映される。
interface BackgroundImageEditorProps {
  image: string;
  /** 既存の表示範囲（あれば編集を引き継ぐ） */
  initialArea: CropArea | null;
  onCancel: () => void;
  onSave: (area: CropArea) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/** 表示領域（画面）の縦横比。背景は全画面に出るため innerWidth/innerHeight を使う。 */
function viewportAspect(): number {
  if (typeof window === "undefined") return 9 / 16;
  const w = window.innerWidth || 9;
  const h = window.innerHeight || 16;
  return w / h;
}

const BackgroundImageEditor = ({
  image,
  initialArea,
  onCancel,
  onSave,
}: BackgroundImageEditorProps) => {
  const { t } = useTranslation();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(initialArea);
  // アスペクト比はエディタを開いている間は固定（途中で変わると範囲がずれるため）。
  const [aspect] = useState(viewportAspect);

  const handleCropComplete = useCallback((croppedAreaPercent: Area) => {
    setArea({
      x: croppedAreaPercent.x,
      y: croppedAreaPercent.y,
      width: croppedAreaPercent.width,
      height: croppedAreaPercent.height,
    });
  }, []);

  const handleSave = () => {
    if (area) onSave(area);
    else onCancel();
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black" role="dialog" aria-modal="true">
      {/* クロップ領域 */}
      <div className="relative flex-1">
        <Cropper
          image={image}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          objectFit="cover"
          restrictPosition
          zoomWithScroll
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={handleCropComplete}
          initialCroppedAreaPercentages={initialArea ?? undefined}
        />
      </div>

      {/* 操作バー */}
      <div className="shrink-0 bg-black/90 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-4">
        <p className="text-center text-xs text-white/80">
          {t("settings.background.editorHint")}
        </p>

        <div className="flex items-center gap-3">
          <ZoomIn className="w-4 h-4 text-white/80 shrink-0" aria-hidden />
          <Slider
            value={[zoom]}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            onValueChange={([v]) => setZoom(v)}
            aria-label={t("settings.background.zoom")}
            className="flex-1"
          />
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            <X className="w-4 h-4" />
            {t("settings.background.cancel")}
          </Button>
          <Button type="button" variant="accent" className="flex-1" onClick={handleSave}>
            <Check className="w-4 h-4" />
            {t("settings.background.save")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BackgroundImageEditor;
