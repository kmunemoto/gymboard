import {
  Bot, Bug, Snowflake, Flame, Worm, Wand2, CloudLightning, Skull,
  Sword, Shield, Gem, Axe, Swords, ShieldCheck, ShieldAlert, ShieldPlus,
  TreePine, Star, Crown, Shirt, Footprints, type LucideIcon,
} from "lucide-react";

const BOSS_MAP: Record<string, LucideIcon> = {
  Bot, Bug, Snowflake, Flame, Worm, Wand2, CloudLightning, Skull,
};
const EQUIP_MAP: Record<string, LucideIcon> = {
  Sword, Shield, Gem, Axe, Swords, ShieldCheck, ShieldAlert, ShieldPlus,
  TreePine, Star, Crown, Shirt, Footprints,
};

export const getBossIcon = (key: string): LucideIcon => BOSS_MAP[key] || Skull;
export const getEquipIcon = (key: string): LucideIcon => EQUIP_MAP[key] || Sword;

export const RARITY_COLOR: Record<string, string> = {
  common: "#9ca3af",
  rare: "#3b82f6",
  epic: "#8b5cf6",
  legendary: "#f59e0b",
};

export const RARITY_LABEL: Record<string, string> = {
  common: "ノーマル",
  rare: "レア",
  epic: "エピック",
  legendary: "レジェンド",
};