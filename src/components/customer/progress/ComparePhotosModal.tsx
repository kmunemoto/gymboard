import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PhotoTypeIcon, photoTypeLabel } from "./PhotoTypeIcon";
import type { PhotoType, ProgressPhoto } from "@/hooks/useProgressPhotos";
import { buildCompareImage, daysBetween } from "@/lib/progressPhotoShare";

interface Props {
  open: boolean;
  onClose: () => void;
  photos: ProgressPhoto[];
}

const ComparePhotosModal = ({ open, onClose, photos }: Props) => {
  // List of distinct dates
  const dates = useMemo(() => {
    const s = new Set(photos.map((p) => p.taken_date));
    return Array.from(s).sort();
  }, [photos]);

  const [beforeDate, setBeforeDate] = useState<string>("");
  const [afterDate, setAfterDate] = useState<string>("");
  const [photoType, setPhotoType] = useState<PhotoType>("front");
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  useEffect(() => {
    if (open && dates.length >= 2) {
      setBeforeDate(dates[0]);
      setAfterDate(dates[dates.length - 1]);
    } else if (open && dates.length === 1) {
      setBeforeDate(dates[0]);
      setAfterDate(dates[0]);
    }
  }, [open, dates]);

  if (!open) return null;

  const findPhoto = (date: string, type: PhotoType) =>
    photos.find((p) => p.taken_date === date && p.photo_type === type);

  const beforePhoto = beforeDate ? findPhoto(beforeDate, photoType) : null;
  const afterPhoto = afterDate ? findPhoto(afterDate, photoType) : null;
  const elapsed = beforeDate && afterDate ? daysBetween(beforeDate, afterDate) : 0;

  const handleShare = async () => {
    if (!beforePhoto?.signed_url || !afterPhoto?.signed_url) {
      toast.error("両方の写真がありません");
      return;
    }
    setSharing(true);
    try {
      const blob = await buildCompareImage(
        beforePhoto.signed_url,
        afterPhoto.signed_url,
        beforeDate,
        afterDate,
        elapsed,
      );
      const url = URL.createObjectURL(blob);
      setShareUrl(url);
    } catch (e) {
      console.error(e);
      toast.error("画像生成に失敗しました");
    } finally {
      setSharing(false);
    }
  };

  const handleClose = () => {
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    setShareUrl(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="text-base font-bold">写真を比較</h2>
        <button onClick={handleClose} className="p-1 rounded-lg hover:bg-muted">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-md mx-auto w-full">
        {dates.length < 1 ? (
          <p className="text-center text-sm text-muted-foreground py-8">写真がまだありません</p>
        ) : (
          <>
            {/* Date pickers */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-muted-foreground mb-1 block">ビフォー</label>
                <select
                  value={beforeDate}
                  onChange={(e) => setBeforeDate(e.target.value)}
                  className="w-full h-10 px-2 rounded-lg border border-input bg-background text-sm"
                >
                  {dates.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted-foreground mb-1 block">アフター</label>
                <select
                  value={afterDate}
                  onChange={(e) => setAfterDate(e.target.value)}
                  className="w-full h-10 px-2 rounded-lg border border-input bg-background text-sm"
                >
                  {dates.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Elapsed */}
            <div className="text-center text-sm font-bold text-accent">
              経過日数：{elapsed}日間
            </div>

            {/* Type tabs */}
            <div className="grid grid-cols-3 gap-2">
              {(["front", "side", "back"] as PhotoType[]).map((t) => {
                const active = photoType === t;
                return (
                  <button
                    key={t}
                    onClick={() => setPhotoType(t)}
                    className={`h-10 rounded-lg border flex items-center justify-center gap-1.5 text-xs font-semibold transition ${
                      active ? "border-accent bg-accent/10 text-accent" : "border-input text-muted-foreground"
                    }`}
                  >
                    <PhotoTypeIcon type={t} className="w-4 h-4" />
                    {photoTypeLabel(t)}
                  </button>
                );
              })}
            </div>

            {/* Photos */}
            <div className="grid grid-cols-2 gap-2">
              <PhotoCell label="Before" date={beforeDate} url={beforePhoto?.signed_url} />
              <PhotoCell label="After" date={afterDate} url={afterPhoto?.signed_url} />
            </div>

            <Button
              variant="accent"
              onClick={handleShare}
              disabled={sharing || !beforePhoto || !afterPhoto}
              className="w-full"
            >
              {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Share2 className="w-4 h-4" />シェア画像を作成</>}
            </Button>

            {shareUrl && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground text-center">画像を長押しして保存できます</p>
                <img src={shareUrl} alt="比較画像" className="w-full rounded-xl border" />
                <a
                  href={shareUrl}
                  download={`compare-${beforeDate}-${afterDate}.jpg`}
                  className="block w-full text-center py-2.5 rounded-xl bg-muted text-sm font-semibold"
                >
                  ダウンロード
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const PhotoCell = ({ label, date, url }: { label: string; date: string; url?: string }) => (
  <div className="space-y-1">
    <div className="text-[10px] font-bold text-muted-foreground flex items-center justify-between">
      <span>{label}</span>
      <span>{date}</span>
    </div>
    <div className="aspect-[3/4] rounded-xl bg-muted overflow-hidden flex items-center justify-center">
      {url ? (
        <img src={url} alt={label} className="w-full h-full object-cover" />
      ) : (
        <span className="text-xs text-muted-foreground">写真なし</span>
      )}
    </div>
  </div>
);

export default ComparePhotosModal;