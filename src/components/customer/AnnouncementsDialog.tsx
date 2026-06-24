import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, X, Bell, CheckCheck } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { useAnnouncements, type Announcement } from "@/hooks/useAnnouncements";
import RenderIcon from "@/components/RenderIcon";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onClose: () => void;
}

const AnnouncementsDialog = ({ open, onClose }: Props) => {
  const { t } = useTranslation();
  const { items, readIds, loading, markRead, markAllRead } = useAnnouncements();
  const [selected, setSelected] = useState<Announcement | null>(null);
  const unreadCount = items.filter((a) => !readIds.has(a.id)).length;

  if (!open) return null;

  const handleOpen = (a: Announcement) => {
    setSelected(a);
    if (!readIds.has(a.id)) markRead(a.id);
  };

  const handleClose = () => {
    setSelected(null);
    onClose();
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
    toast.success(t("announcementsDialog.allReadToast"));
  };

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col w-full max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        {selected ? (
          <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-foreground">
            <ArrowLeft className="w-4 h-4" /> {t("common.back")}
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-accent" />
              <span className="text-base font-bold">{t("announcementsDialog.title")}</span>
            </div>
          </div>
        )}
        <button onClick={handleClose} className="p-1 text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : selected ? (
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                <RenderIcon name={selected.icon} size={22} className="text-accent" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-bold leading-tight break-all">{selected.title}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(selected.published_at), "M月d日 HH:mm", { locale: ja })}
                </p>
              </div>
            </div>
            <div className="text-sm text-foreground leading-relaxed pt-2" style={{ whiteSpace: "pre-wrap" }}>
              {selected.body}
            </div>
            {(selected.image_url || selected.image_url2) && (
              <div className="mt-2 flex justify-center gap-3 flex-wrap">
                {selected.image_url && (
                  <img src={selected.image_url} alt="" className="h-40 object-contain rounded-lg" />
                )}
                {selected.image_url2 && (
                  <img src={selected.image_url2} alt="" className="h-40 object-contain rounded-lg" />
                )}
              </div>
            )}
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">{t("announcementsDialog.empty")}</div>
        ) : (
          <div className="p-3 space-y-2">
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mb-1"
                onClick={handleMarkAllRead}
              >
                <CheckCheck className="w-4 h-4 mr-1.5" />
                {t("announcementsDialog.markAllRead")}
              </Button>
            )}
            {items.map((a) => {
              const unread = !readIds.has(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => handleOpen(a)}
                  className="w-full text-left bg-card border border-border/60 rounded-xl p-3 flex gap-3 hover:bg-muted/40 transition-colors relative overflow-hidden"
                >
                  {unread && <span className="absolute left-0 top-0 bottom-0 w-1 bg-accent" />}
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0 ml-1">
                    <RenderIcon name={a.icon} size={18} className="text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold leading-tight break-all">{a.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(a.published_at), "M月d日", { locale: ja })}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnouncementsDialog;