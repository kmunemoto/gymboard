import { getIconComponent } from "@/lib/iconRegistry";

interface Props {
  name: string | null | undefined;
  size?: number;
  className?: string;
  color?: string;
  strokeWidth?: number;
}

/** Render a Lucide icon by registry name, with emoji-string fallback. */
const RenderIcon = ({ name, size = 16, className, color, strokeWidth }: Props) => {
  const Icon = getIconComponent(name);
  return <Icon size={size} className={className} color={color} strokeWidth={strokeWidth} />;
};

export default RenderIcon;