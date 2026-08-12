import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "lucide-react";
import type { AttachmentType } from "@/lib/messageAttachment";

interface MessageAttachmentProps {
  type: AttachmentType;
  /** 署名URL。まだ取れていない／期限切れなら undefined */
  url?: string;
}

/**
 * 吹き出しの中に出す添付。画像は押すと原寸、動画はその場で再生。
 *
 * ⚠️ URL は**署名付きで期限がある**。取れなかったときに無言で空白を出すと
 *    「送ったはずのものが消えた」ように見えるので、必ず理由を出す。
 */
const MessageAttachment = ({ type, url }: MessageAttachmentProps) => {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);

  if (!url || broken) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] text-muted-foreground">
        <ImageOff className="w-3.5 h-3.5 shrink-0" />
        <span>{t("messageAttachment.unavailable")}</span>
      </div>
    );
  }

  if (type === "video") {
    return (
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        onError={() => setBroken(true)}
        className="rounded-lg max-h-72 w-full bg-black"
      />
    );
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      <img
        src={url}
        alt={t("messageAttachment.imageAlt")}
        loading="lazy"
        onError={() => setBroken(true)}
        className="rounded-lg max-h-72 w-auto object-contain"
      />
    </a>
  );
};

export default MessageAttachment;
