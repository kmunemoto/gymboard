import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  type AttachmentType,
  type PreparedAttachment,
  attachmentTypeOf,
  discardAttachment,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  rejectAttachment,
  uploadAttachment,
} from "@/lib/messageAttachment";

export interface PickedAttachment {
  /** 送信前のプレビュー用 object URL */
  previewUrl: string;
  type: AttachmentType;
  fileName: string;
}

/**
 * チャットの添付ピッカー。お客様側とジム側で同じ挙動にするため共通化する。
 *
 * ## 「先に上げる」設計にしている理由
 * 選んだ時点でアップロードを始め、送信ボタンでは行を INSERT するだけにする。
 * 動画は数十MB あるので、送信ボタンを押してから待たされるより、
 * 文章を書いている間に裏で上げ終わっているほうが体感が良い。
 *
 * ## 後始末
 * 上げたあとに送信をやめたら、`clear()` がストレージから消す。
 * これをしないと**誰からも見えないファイルだけが溜まる**。
 */
export const useAttachmentPicker = (userId: string | null | undefined) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedAttachment | null>(null);
  const [prepared, setPrepared] = useState<PreparedAttachment | null>(null);
  const [uploading, setUploading] = useState(false);

  const reset = useCallback(() => {
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setPrepared(null);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  /** 送信をやめる。上げ済みのファイルはストレージから消す。 */
  const clear = useCallback(() => {
    if (prepared) void discardAttachment(prepared.path);
    reset();
  }, [prepared, reset]);

  /** 送信に成功したあと。ファイルは行から参照されているので消さない。 */
  const consume = useCallback(() => {
    reset();
  }, [reset]);

  const pick = useCallback(
    async (file: File | null | undefined) => {
      if (!file || !userId) return;

      const rejection = rejectAttachment(file);
      if (rejection === "unsupported") {
        toast.error(t("messageAttachment.errUnsupported"));
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      if (rejection === "too-large") {
        toast.error(
          t("messageAttachment.errTooLarge", { max: formatBytes(MAX_ATTACHMENT_BYTES) }),
        );
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      // 選び直したときは前の分を片付ける
      if (prepared) void discardAttachment(prepared.path);

      const type = attachmentTypeOf(file.type)!;
      setPicked((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { previewUrl: URL.createObjectURL(file), type, fileName: file.name };
      });
      setPrepared(null);
      setUploading(true);
      try {
        setPrepared(await uploadAttachment(file, userId));
      } catch (e) {
        console.error("添付のアップロードに失敗:", e);
        toast.error(t("messageAttachment.errUploadFailed"));
        reset();
      } finally {
        setUploading(false);
      }
    },
    [userId, prepared, reset, t],
  );

  return {
    inputRef,
    /** 選択中の添付（プレビュー用） */
    picked,
    /** アップロード済みで、送信時に messages へ入れる値。まだ上げ終わっていなければ null */
    prepared,
    uploading,
    pick,
    clear,
    consume,
    openPicker: () => inputRef.current?.click(),
  };
};
