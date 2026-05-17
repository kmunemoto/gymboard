import { useState } from "react";
import type { EquippedGear, EquippedGearItem } from "@/hooks/useEquippedGear";
import { getEquipmentImage } from "@/lib/avatarSystem";

const RARITY_GLOW: Record<string, string> = {
  common: "",
  rare: "drop-shadow(0 0 4px rgba(59,130,246,0.7))",
  epic: "drop-shadow(0 0 6px rgba(139,92,246,0.8))",
  legendary: "drop-shadow(0 0 8px rgba(245,158,11,0.9))",
};

interface Props {
  gear: EquippedGear;
  /** When true, only render the weapon (used in compact spots like ranking rows) */
  compact?: boolean;
  /** z-index base inside the avatar container. Default 20 sits above the avatar image. */
  zBase?: number;
}

const EquipmentImage = ({
  it,
  style,
  filter,
}: {
  it: EquippedGearItem;
  style: React.CSSProperties;
  filter: string;
}) => {
  const [failed, setFailed] = useState(false);
  const src = getEquipmentImage(it.item_key, it.item_type);
  // Per spec: only render the actual equipment image. If it fails to load,
  // render nothing (no Lucide icon placeholder).
  if (failed) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      onError={() => {
        console.error("[EquipmentOverlay] Image load failed:", src, it);
        setFailed(true);
      }}
      className="absolute pointer-events-none object-contain pixel-avatar"
      style={{ ...style, filter, background: "transparent" }}
    />
  );
};

const renderItem = (
  it: EquippedGearItem,
  style: React.CSSProperties,
  filter: string,
) => <EquipmentImage key={it.item_key} it={it} style={style} filter={filter} />;

const EquipmentOverlay = ({ gear, compact = false, zBase = 20 }: Props) => {
  // In compact spots (ranking rows, small avatars) skip overlay entirely.
  if (compact) return null;
  return (
    <>
      {gear.shield && renderItem(
        gear.shield,
        { position: "absolute", top: "30%", left: "-5%", height: "68%", width: "68%", zIndex: zBase, opacity: 0.95 },
        `drop-shadow(1px 1px 2px rgba(0,0,0,0.5)) ${RARITY_GLOW[gear.shield.rarity]}`,
      )}
      {/* Amulet/accessory intentionally not rendered on avatar overlay */}
      {gear.weapon && (() => {
        // 大型武器（刀・聖剣）は専用の大きめ配置を維持
        const LARGE_WEAPONS = new Set(["shadow_katana", "divine_sword"]);
        const isLarge = LARGE_WEAPONS.has(gear.weapon.item_key);
        const style: React.CSSProperties = isLarge
          ? {
              position: "absolute",
              bottom: "22%",
              right: "-12%",
              height: "65%",
              width: "65%",
              zIndex: zBase + 1,
              transform: "rotate(-30deg)",
              transformOrigin: "center center",
              opacity: 0.95,
            }
          : {
              position: "absolute",
              bottom: "20%",
              right: "5%",
              height: "55%",
              width: "55%",
              zIndex: zBase + 1,
              transform: "rotate(-30deg)",
              transformOrigin: "center center",
              opacity: 0.95,
            };
        return renderItem(
          gear.weapon,
          style,
          `drop-shadow(1px 1px 2px rgba(0,0,0,0.5)) ${RARITY_GLOW[gear.weapon.rarity]}`,
        );
      })()}
      {/* Tops/bottoms intentionally not overlaid on avatar; stat bonuses still apply. */}
    </>
  );
};

export default EquipmentOverlay;
