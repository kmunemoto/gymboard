import BadgeIcon from "./BadgeIcon";
import { ACHIEVEMENTS } from "@/lib/avatarSystem";

interface Props {
  badgeKeys: string[] | null | undefined;
  size?: number;
  className?: string;
}

const FeaturedBadgesRow = ({ badgeKeys, size = 24, className }: Props) => {
  const keys = (badgeKeys || []).slice(0, 3);
  if (keys.length === 0) return null;
  return (
    <div className={`flex items-center gap-1 ${className || ""}`}>
      {keys.map((k) => {
        const def = ACHIEVEMENTS.find((a) => a.key === k);
        return (
          <BadgeIcon
            key={k}
            type="achievement"
            iconKey={k}
            rarity={def?.rarity || "normal"}
            acquired
            size={size}
          />
        );
      })}
    </div>
  );
};

export default FeaturedBadgesRow;
