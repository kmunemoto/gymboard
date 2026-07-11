import { cn } from "@/lib/utils";
import worldCupTrophy from "@/assets/world-cup-trophy.png";

type SizeKey = "xs" | "sm" | "md" | "lg" | "xl";

// Tailwind classes (not px numbers) so tailwind-merge can let a caller's own
// w-N h-N in className win over the preset — every current call site sizes
// via className, not the size prop.
const SIZE_CLASS_MAP: Record<SizeKey, string> = {
  xs: "w-3 h-3",
  sm: "w-4 h-4",
  md: "w-6 h-6",
  lg: "w-8 h-8",
  xl: "w-12 h-12",
};

interface DumbbellLoaderProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "size"> {
  size?: SizeKey | number;
  label?: string;
  className?: string;
}

/**
 * Unified app loader: a trophy image that rises up from below, holds, and
 * sinks back down on a loop — stays upright (no rotation). The outer span is
 * a fixed-size, overflow-hidden "stage" so the rise/sink motion clips inside
 * the caller's box instead of spilling into surrounding inline content.
 * - Cycle: ~1.6s (ease-in-out, infinite)
 * - Accepts size preset (xs/sm/md/lg/xl) or numeric px.
 * - className lands on the outer span, so layout classes (mr-2, etc.) keep
 *   working when used as a drop-in replacement for Loader2.
 */
export const DumbbellLoader = ({
  size = "md",
  label,
  className,
  ...props
}: DumbbellLoaderProps) => {
  const sizeClass = typeof size === "number" ? undefined : SIZE_CLASS_MAP[size];
  const sizeStyle = typeof size === "number" ? { width: size, height: size } : undefined;

  const icon = (
    <span
      className={cn("relative inline-block align-middle overflow-hidden", sizeClass, className)}
      style={sizeStyle}
    >
      <img
        src={worldCupTrophy}
        alt=""
        className="absolute inset-0 w-full h-full object-contain animate-loader-rise"
        {...props}
      />
    </span>
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
