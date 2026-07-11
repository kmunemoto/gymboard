import { cn } from "@/lib/utils";
import worldCupTrophy from "@/assets/world-cup-trophy.png";

type SizeKey = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<SizeKey, number> = {
  xs: 12,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
};

interface DumbbellLoaderProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "size"> {
  size?: SizeKey | number;
  label?: string;
  className?: string;
}

/**
 * Unified app loader: a rotating trophy image (transparent PNG, not a Lucide
 * icon — the trophy shape isn't square, so object-contain keeps it from
 * stretching inside callers' square w-N h-N boxes).
 * - Rotation: ~1.2s per turn (linear, infinite)
 * - Accepts size preset (xs/sm/md/lg/xl) or numeric px.
 * - Forwards className so layout classes (mr-2, etc.) keep working when
 *   used as a drop-in replacement for Loader2.
 */
export const DumbbellLoader = ({
  size = "md",
  label,
  className,
  ...props
}: DumbbellLoaderProps) => {
  const pixelSize = typeof size === "number" ? size : SIZE_MAP[size];

  const icon = (
    <img
      src={worldCupTrophy}
      alt=""
      width={pixelSize}
      height={pixelSize}
      className={cn(
        "object-contain animate-[spin_1.2s_linear_infinite]",
        className
      )}
      {...props}
    />
  );

  if (!label) return icon;

  return (
    <div className="inline-flex items-center gap-2">
      {icon}
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
};

export default DumbbellLoader;
