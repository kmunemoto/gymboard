import { Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

type SizeKey = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<SizeKey, number> = {
  xs: 12,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
};

interface DumbbellLoaderProps extends Omit<React.SVGProps<SVGSVGElement>, "size"> {
  size?: SizeKey | number;
  label?: string;
  className?: string;
}

/**
 * Unified app loader: a rotating dumbbell icon.
 * - Rotation: ~1.2s per turn (linear, infinite)
 * - Color: theme primary
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
    <Dumbbell
      width={pixelSize}
      height={pixelSize}
      strokeWidth={2}
      className={cn(
        "text-primary animate-[spin_1.2s_linear_infinite]",
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
