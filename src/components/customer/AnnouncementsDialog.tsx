import { useState } from "react";
import { ArrowLeft, X, Bell, CheckCheck, ExternalLink, Smartphone } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { useAnnouncements, type Announcement } from "@/hooks/useAnnouncements";
import RenderIcon from "@/components/RenderIcon";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/lib/nativeBridge";

const URL_REGEX = /(https?:\/\/[^\s　、。）」』]+)/g;

type BodyNode =
  | { type: "text"; value: string }
  | { type: "appstore"; url: string }
  | { type: "playstore"; url: string }
  | { type: "link"; url: string };

function parseBody(body: string): BodyNode[] {
  const nodes: BodyNode[] = [];
  const parts = body.split(URL_REGEX);
  const isUrl = (s: string) => /^https?:\/\//.test(s);
  for (const part of parts) {
    if (!part) continue;
    if (isUrl(part)) {
      if (part.includes("apps.apple.com") || part.includes("itunes.apple.com")) {
        nodes.push({ type: "appstore", url: part });
      } else if (part.includes("play.google.com")) {
        nodes.push({ type: "playstore", url: part });
      } else {
        nodes.push({ type: "link", url: part });
      }
    } else {
      nodes.push({ type: "text", value: part });
    }
  }
  return nodes;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function renderBodyWithLinks(body: string) {
  const nodes = parseBody(body);
  return nodes.map((n, i) => {
    if (n.type === "text") {
      return (
        <span key={i} style={{ whiteSpace: "pre-wrap" }}>
          {n.value}
        </span>
      );
    }
    if (n.type === "appstore" || n.type === "playstore") {
      const label = n.type === "appstore" ? "App Storeで開く" : "Google Playで開く";
      return (
        <button
          key={i}
          type="button"
          onClick={() => openExternalUrl(n.url)}
          className="my-2 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-accent/40 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-colors break-all"
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span className="break-all">{label}</span>
        </button>
      );
    }
    return (
      <button
        key={i}
        type="button"
        onClick={() => openExternalUrl(n.url)}
        className="inline-flex items-center gap-1 text-accent underline underline-offset-2 break-all align-baseline"
      >
        <span className="break-all">{getDomain(n.url)}</span>
        <ExternalLink className="w-3 h-3 shrink-0" />
      </button>
    );
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const AnnouncementsDialog = ({ open, onClose }: Props) => {
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
    toast.success("全てのお知らせを既読にしました");
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-background flex flex-col w-full max-w-md mx-auto overflow-hidden"
      style={{ height: "100vh", minHeight: "100dvh", maxHeight: "100dvh" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        {selected ? (
          <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-foreground">
            <ArrowLeft className="w-4 h-4" /> 戻る
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-accent" />
              <span className="text-base font-bold">お知らせ</span>
            </div>
          </div>
        )}
        <button onClick={handleClose} className="p-1 text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "env(safe-area-inset-bottom)", WebkitOverflowScrolling: "touch" }}
      >
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">読み込み中…</div>
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
            <div className="text-sm text-foreground leading-relaxed pt-2 break-all" style={{ whiteSpace: "pre-wrap" }}>
              {renderBodyWithLinks(selected.body)}
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
            <p className="text-xs text-muted-foreground pt-4 border-t border-border/60 mt-4">
              文章のご不明な点は、セッションの際にトレーナーにお気軽にお尋ねください。
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">お知らせはありません</div>
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
                すべて既読にする
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