import { useMemo, useState } from "react";
import { Camera, Plus, ArrowLeftRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useProgressPhotos, type PhotoType, type ProgressPhoto } from "@/hooks/useProgressPhotos";
import AddProgressPhotoDialog from "./AddProgressPhotoDialog";
import ComparePhotosModal from "./ComparePhotosModal";
import { PhotoTypeIcon, photoTypeLabel } from "./PhotoTypeIcon";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { useTranslation } from "react-i18next";

const TYPES: PhotoType[] = ["front", "side", "back"];

const ProgressPhotosTab = () => {
  const { t } = useTranslation();
  const { photos, loading, refetch } = useProgressPhotos();
  const [addOpen, setAddOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [viewer, setViewer] = useState<ProgressPhoto | null>(null);

  const grouped = useMemo(() => {
    const map: Record<string, ProgressPhoto[]> = {};
    photos.forEach((p) => {
      if (!map[p.taken_date]) map[p.taken_date] = [];
      map[p.taken_date].push(p);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [photos]);

  const handleDelete = async (p: ProgressPhoto) => {
    if (!confirm(t("progress.deleteConfirm"))) return;
    const { error } = await supabase.from("progress_photos").delete().eq("id", p.id);
    if (error) {
      toast.error(t("progress.deleteFailed"));
      return;
    }
    await supabase.storage.from("progress-photos").remove([p.photo_url]);
    toast.success(t("progress.deleteSuccess"));
    setViewer(null);
    refetch();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <DumbbellLoader className="w-6 h-6 text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCompareOpen(true)}
          disabled={photos.length < 1}
          className="flex-1"
        >
          <ArrowLeftRight className="w-4 h-4" />
          {t("progress.compare")}
        </Button>
        <Button variant="accent" size="sm" onClick={() => setAddOpen(true)} className="flex-1">
          <Plus className="w-4 h-4" />
          {t("progress.addPhotoBtn")}
        </Button>
      </div>

      {grouped.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Camera className="w-10 h-10 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("progress.emptyTitle")}</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {t("progress.emptyDesc")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map(([date, items]) => {
            const d = new Date(date);
            const dayNames = [t("progress.dow0"), t("progress.dow1"), t("progress.dow2"), t("progress.dow3"), t("progress.dow4"), t("progress.dow5"), t("progress.dow6")];
            const label = t("progress.dateCardLabel", { month: d.getMonth() + 1, day: d.getDate(), dow: dayNames[d.getDay()] });
            return (
              <Card key={date} className="card-hover">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold">{label}</span>
                    <span className="text-[10px] text-muted-foreground">{t("progress.photoCount", { count: items.length })}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {TYPES.map((tp) => {
                      const p = items.find((x) => x.photo_type === tp);
                      return (
                        <div key={tp} className="space-y-1">
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <PhotoTypeIcon type={tp} className="w-3 h-3" />
                            {photoTypeLabel(tp)}
                          </div>
                          <button
                            onClick={() => p && setViewer(p)}
                            disabled={!p}
                            className="aspect-[3/4] w-full rounded-xl bg-muted overflow-hidden flex items-center justify-center"
                          >
                            {p?.signed_url ? (
                              <img src={p.signed_url} alt={photoTypeLabel(tp)} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[10px] text-muted-foreground/60">{t("progress.notRegistered")}</span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AddProgressPhotoDialog open={addOpen} onClose={() => setAddOpen(false)} onUploaded={refetch} />
      <ComparePhotosModal open={compareOpen} onClose={() => setCompareOpen(false)} photos={photos} />

      {/* Viewer */}
      {viewer && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col" onClick={() => setViewer(null)}>
          <div className="flex justify-end p-3" style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)" }}>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(viewer); }}
              className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />{t("progress.delete")}
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4" onClick={() => setViewer(null)}>
            {viewer.signed_url && <img src={viewer.signed_url} alt="" className="max-w-full max-h-full object-contain" />}
          </div>
          {viewer.notes && (
            <div className="p-4 text-white text-sm text-center">{viewer.notes}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProgressPhotosTab;
