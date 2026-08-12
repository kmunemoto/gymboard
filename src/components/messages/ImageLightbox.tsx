import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

interface ImageLightboxProps {
  /** 表示中の画像の署名URL。null なら閉じている */
  url: string | null;
  onClose: () => void;
}

/**
 * 添付画像の全画面表示。
 *
 * ## なぜ要るか（2026-08-12）
 *
 * これまでは `<a target="_blank">` で**ブラウザの別タブに飛ばしていた**。
 * ネイティブアプリでは Safari / Chrome が立ち上がり、戻るのに一手間かかる。
 * しかも添付URLは**署名付きで期限がある**ので、外のタブに残ると
 * あとで開き直したときに切れている。
 *
 * ## Escape とハードウェアバックで閉じる
 *
 * 全画面に何かを出しておいて閉じ方が1つしか無いのは、Android で詰まる。
 * 背景タップ・×ボタン・Escape の3つを用意する。
 */
const ImageLightbox = ({ url, onClose }: ImageLightboxProps) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // 背後のチャットがスクロールしてしまうのを止める
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("messageAttachment.imageAlt")}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center"
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={url}
        alt={t("messageAttachment.imageAlt")}
        // 画像自体を押しても閉じない（拡大して見たいので誤爆させない）
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full object-contain rounded-lg"
      />
    </div>
  );
};

export default ImageLightbox;
