import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { resizeImageToJpeg } from "@/lib/imageResize";
import { getJSTToday } from "@/lib/timezone";
import { toast } from "sonner";
import { PhotoTypeIcon, photoTypeLabel } from "./PhotoTypeIcon";
import type { PhotoType } from "@/hooks/useProgressPhotos";

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

const AddProgressPhotoDialog = ({ open, onClose, onUploaded }: Props) => {
  const { user } = useAuth();
  const [date, setDate] = useState(getJSTToday());
  const [photoType, setPhotoType] = useState<PhotoType>("front");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => {
    setDate(getJSTToday());
    setPhotoType("front");
    setFile(null);
    setPreview(null);
    setNotes("");
  };

  const handleClose = () => {
    if (uploading) return;
    reset();
    onClose();
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleUpload = async () => {
    if (!user || !file) {
      toast.error("写真を選択してください");
      return;
    }
    setUploading(true);
    try {
      const blob = await resizeImageToJpeg(file, 1200, 0.8);
      const path = `${user.id}/${Date.now()}-${photoType}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("progress-photos")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("progress_photos").insert({
        user_id: user.id,
        photo_url: path,
        photo_type: photoType,
        taken_date: date,
        notes: notes.trim() || null,
      });
      if (insErr) throw insErr;
      toast.success("写真を追加しました");
      reset();
      onUploaded();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error("アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center" onClick={handleClose}>
      <div
        className="bg-background w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">写真を追加</h2>
          <button onClick={handleClose} disabled={uploading} className="p-1 rounded-lg hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Date */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">撮影日</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={getJSTToday()}
              className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm"
            />
          </div>

          {/* Photo type */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">写真の種類</label>
            <div className="grid grid-cols-3 gap-2">
              {(["front", "side", "back"] as PhotoType[]).map((t) => {
                const active = photoType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPhotoType(t)}
                    className={`h-14 rounded-xl border flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition ${
                      active
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-input bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <PhotoTypeIcon type={t} className="w-5 h-5" />
                    <span>{photoTypeLabel(t)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* File */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">写真</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] || null)}
            />
            {preview ? (
              <div className="relative">
                <img src={preview} alt="プレビュー" className="w-full max-h-64 object-contain rounded-xl bg-muted" />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-background/90 text-xs font-semibold border"
                >
                  変更
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full h-32 rounded-xl border-2 border-dashed border-border hover:border-accent flex flex-col items-center justify-center gap-2 transition"
              >
                <Camera className="w-6 h-6 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">写真を選択</span>
              </button>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">メモ（任意）</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none"
              placeholder="体調や気づきなど"
            />
          </div>

          <Button variant="accent" onClick={handleUpload} disabled={uploading || !file} className="w-full">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存する"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AddProgressPhotoDialog;