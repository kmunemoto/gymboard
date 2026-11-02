import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import MessageText from "@/components/messages/MessageText";
import ImageLightbox from "@/components/messages/ImageLightbox";
import { ArrowLeft, X, Bell, CheckCheck, Image as ImageIcon } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { useAnnouncements, type Announcement } from "@/hooks/useAnnouncements";
import { signAnnouncementImageUrls } from "@/lib/announcementImages";
import { formatDate } from "@/lib/dateFormat";
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
  /** 開いているお知らせの画像の署名つき URL（パス → URL）。null は取得中 */
  const [imageUrls, setImageUrls] = useState<Map<string, string> | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const unreadCount = items.filter((a) => !readIds.has(a.id)).length;

  // 画像は非公開の置き場にあるので、開いたときに署名つきの URL を取る（このお知らせが届いている人にしか出ない）
  const imagePaths = selected?.image_paths ?? [];
  const imagePathsKey = imagePaths.join("\n");
  useEffect(() => {
    if (!imagePathsKey) {
      setImageUrls(new Map());
      return;
    }
    let cancelled = false;
    setImageUrls(null);
    signAnnouncementImageUrls(imagePathsKey.split("\n"))
      .then((urls) => { if (!cancelled) setImageUrls(urls); })
      .catch(() => { if (!cancelled) setImageUrls(new Map()); });
    return () => { cancelled = true; };
  }, [imagePathsKey]);

  // 外から閉じられたとき（× 以外）も、全画面の画像を残さない（次に開いたとき古い画像が出ない）
  useEffect(() => {
    if (!open) setLightboxUrl(null);
  }, [open]);

  if (!open) return null;

  const handleOpen = (a: Announcement) => {
    setSelected(a);
    if (!readIds.has(a.id)) markRead(a.id);
  };

  const handleClose = () => {
    setSelected(null);
    setLightboxUrl(null);
    onClose();
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
    toast.success(t("announcementsDialog.allReadToast"));
  };

  return (
    <>
    {/* glass: 写真背景（theme-glass）でパネルが透過して背後と文字が混ざらないよう白フロスト面にする */}
    <div className="fixed inset-0 z-[60] bg-background glass flex flex-col w-full max-w-md mx-auto">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border bg-card"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)" }}
      >
        {selected ? (
          <button onClick={() => { setSelected(null); setLightboxUrl(null); }} className="flex items-center gap-1 text-sm text-foreground">
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
                  {formatDate(new Date(selected.published_at), "monthDayTime")}
                </p>
              </div>
            </div>
            {/* 🔴 本文の URL は押せるようにする。押せないと、ストアや動画のリンクを
                載せても「手で選択してコピー」になり、結局 LINE に貼り直しになる。
                チャットと同じ MessageText を使う（HTML としては描画しないので、
                お客様が自由に入力した本文でもスクリプトの入り口にならない）。 */}
            {/* 画像だけのお知らせ（本文なし）では本文の欄を出さない */}
            {selected.body.trim() && (
              <div className="text-foreground pt-2" data-testid="announcement-body">
                <MessageText text={selected.body} />
              </div>
            )}
            {/* 画像は本文の下に、横幅いっぱいで並べる（チラシの文字が読める大きさ）。押すと全画面 */}
            {imagePaths.length > 0 && (
              <div className="pt-2 space-y-3" data-testid="announcement-images">
                {imagePaths.map((path, i) => {
                  if (imageUrls === null) {
                    return <div key={path} className="w-full aspect-[4/3] rounded-lg bg-muted animate-pulse" />;
                  }
                  const url = imageUrls.get(path);
                  // 取れなかった画像（消された等）は出さない
                  if (!url) return null;
                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() => setLightboxUrl(url)}
                      aria-label={t("announcementsDialog.openImage", { n: i + 1 })}
                      className="block w-full"
                    >
                      <img
                        src={url}
                        alt={t("announcementsDialog.imageAlt", { n: i + 1 })}
                        loading="lazy"
                        className="w-full max-h-[70vh] object-contain rounded-lg border border-border/60 bg-muted"
                      />
                    </button>
                  );
                })}
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
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                      {formatDate(new Date(a.published_at), "monthDay")}
                      {(a.image_paths?.length ?? 0) > 0 && (
                        <ImageIcon className="w-3 h-3" aria-label={t("announcementsDialog.hasImages")} />
                      )}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
    {/* 🔴 パネルの外に置く。パネルは glass（backdrop-filter）なので、中に置くと全画面にならずパネルの幅に閉じ込められる。
        お知らせの全画面（z-[60]）より上に出す */}
    <ImageLightbox
      url={lightboxUrl}
      onClose={() => setLightboxUrl(null)}
      zClassName="z-[70]"
      label={t("announcementsDialog.imageViewer")}
    />
    </>
  );
};

export default AnnouncementsDialog;