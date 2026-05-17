import type { PhotoType } from "@/hooks/useProgressPhotos";

interface Props {
  type: PhotoType;
  className?: string;
}

/** Simple silhouette icons for front / side / back. */
export const PhotoTypeIcon = ({ type, className = "w-4 h-4" }: Props) => {
  if (type === "front") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <circle cx="12" cy="5" r="2.5" />
        <path d="M7 11c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v4h-1.5v6h-2v-6h-3v6h-2v-6H7v-4z" />
      </svg>
    );
  }
  if (type === "side") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <circle cx="13" cy="5" r="2.5" />
        <path d="M10 9c1.5 0 3 .8 3.5 2.2l1.2 3c.2.6 0 1.3-.6 1.6l-1.6.8V21h-2v-5l-1.5-3.2c-.2-.4-.2-.9 0-1.3C9.4 9.4 9.7 9 10 9z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M8 10c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v5h-1v6h-2v-6h-2v6H9v-6H8v-5z" opacity="0.85" />
      <rect x="10" y="11" width="4" height="2.5" rx="0.5" opacity="0.4" />
    </svg>
  );
};

export const photoTypeLabel = (t: PhotoType) =>
  t === "front" ? "正面" : t === "side" ? "側面" : "背面";