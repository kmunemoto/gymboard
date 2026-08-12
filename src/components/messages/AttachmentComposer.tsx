import { useTranslation } from "react-i18next";
import { Loader2, Paperclip, X } from "lucide-react";
import type { PickedAttachment } from "@/hooks/useAttachmentPicker";
import { ATTACHMENT_ACCEPT } from "@/lib/messageAttachment";

interface AttachmentButtonProps {
  inputRef: React.RefObject<HTMLInputElement>;
  onPick: (file: File | null | undefined) => void;
  onOpen: () => void;
  disabled?: boolean;
}

/** クリップのボタンと、隠した file input。入力欄の隣に置く。 */
export const AttachmentButton = ({ inputRef, onPick, onOpen, disabled }: AttachmentButtonProps) => {
  const { t } = useTranslation();
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        aria-label={t("messageAttachment.attach")}
        className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground disabled:opacity-40 transition-opacity shrink-0"
      >
        <Paperclip className="w-4 h-4" />
      </button>
    </>
  );
};

interface AttachmentPreviewProps {
  picked: PickedAttachment;
  uploading: boolean;
  onRemove: () => void;
}

/**
 * 送信前のプレビュー。入力欄の上に出す。
 * アップロード中はその旨を出す（**黙って待たせない**。動画は数十秒かかる）。
 */
export const AttachmentPreview = ({ picked, uploading, onRemove }: AttachmentPreviewProps) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5 mb-2 p-2 rounded-xl bg-secondary/60">
      <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-black/10 shrink-0">
        {picked.type === "video" ? (
          <video src={picked.previewUrl} className="w-full h-full object-cover" muted playsInline />
        ) : (
          <img src={picked.previewUrl} alt="" className="w-full h-full object-cover" />
        )}
        {uploading && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <Loader2 className="w-4 h-4 text-white animate-spin" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{picked.fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {uploading
            ? t("messageAttachment.uploading")
            : t(picked.type === "video" ? "messageAttachment.readyVideo" : "messageAttachment.readyImage")}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("messageAttachment.remove")}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
