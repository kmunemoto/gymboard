import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image as ImageIcon, Trash2, Crop } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import BackgroundImageEditor from "@/components/BackgroundImageEditor";
import {
  getStoredBackgroundImage,
  setBackgroundImageFromFile,
  clearBackgroundImage,
  getBackgroundConfig,
  setBackgroundConfig,
  areaToCss,
  type BackgroundConfig,
  type CropArea,
} from "@/lib/backgroundImage";

// 設定画面用: 端末の写真をアプリ背景に設定し、表示範囲を「範囲を調整」エディタ
// （ドラッグで移動・ピンチ/スライダーで拡大縮小）で決める。お客様側・ジム側共通。
interface BackgroundImagePickerProps {
  variant?: "customer" | "trainer";
}

const BackgroundImagePicker = ({ variant = "customer" }: BackgroundImagePickerProps) => {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<string | null>(getStoredBackgroundImage());
  const [config, setConfig] = useState<BackgroundConfig>(getBackgroundConfig());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File | null) => {
    if (!f) return;
    setBusy(true);
    try {
      await setBackgroundImageFromFile(f);
      setCurrent(getStoredBackgroundImage());
      setConfig(getBackgroundConfig());
      toast.success(t("settings.background.applied"));
    } catch {
      toast.error(t("settings.background.errTooLarge"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleClear = () => {
    clearBackgroundImage();
    setCurrent(null);
    setConfig(getBackgroundConfig());
  };

  const handleSaveArea = (area: CropArea) => {
    const next: BackgroundConfig = { area };
    setConfig(next);
    setBackgroundConfig(next);
    setEditing(false);
  };

  const css = areaToCss(config.area);

  return (
    <section data-variant={variant}>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <ImageIcon className="w-3.5 h-3.5" />
        {t("settings.background.title")}
      </h2>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-accent/10">
              <ImageIcon className="w-4 h-4 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">{t("settings.background.title")}</p>
              <p className="text-[11px] text-muted-foreground mb-3">
                {t("settings.background.description")}
              </p>

              {current && (
                <div
                  className="w-full h-28 rounded-xl mb-3 border border-border bg-secondary"
                  style={{
                    backgroundImage: `url("${current}")`,
                    backgroundSize: css.size == null ? "cover" : `${css.size}%`,
                    backgroundPosition: `${css.posX}% ${css.posY}%`,
                    backgroundRepeat: "no-repeat",
                  }}
                  aria-hidden
                />
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy
                    ? t("common.processing")
                    : current
                      ? t("settings.background.change")
                      : t("settings.background.choose")}
                </Button>
                {current && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setEditing(true)}
                  >
                    <Crop className="w-4 h-4" />
                    {t("settings.background.adjust")}
                  </Button>
                )}
                {current && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={handleClear}
                  >
                    <Trash2 className="w-4 h-4" />
                    {t("settings.background.remove")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {editing && current && (
        <BackgroundImageEditor
          image={current}
          initialArea={config.area}
          onCancel={() => setEditing(false)}
          onSave={handleSaveArea}
        />
      )}
    </section>
  );
};

export default BackgroundImagePicker;
