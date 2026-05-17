export type GachaRarity = "common" | "rare" | "epic" | "legendary";

export interface GachaRewardDef {
  type: "coins" | "exp";
  amount: number;
  rarity: GachaRarity;
  name: string;
}

export const GACHA_RARITY_LABEL: Record<GachaRarity, string> = {
  common: "NORMAL",
  rare: "RARE",
  epic: "EPIC",
  legendary: "LEGENDARY",
};

export const GACHA_RARITY_COLOR: Record<GachaRarity, string> = {
  common: "#9CA3AF",
  rare: "#0ABAB5",
  epic: "#6366F1",
  legendary: "#F59E0B",
};

export const GACHA_RARITY_GRADIENT: Record<GachaRarity, string> = {
  common: "linear-gradient(135deg, #9CA3AF, #6B7280)",
  rare: "linear-gradient(135deg, #0ABAB5, #06908C)",
  epic: "linear-gradient(135deg, #6366F1, #4F46E5)",
  legendary: "linear-gradient(135deg, #FBBF24, #F59E0B, #D97706)",
};

export const GACHA_RARITY_FLASH: Record<GachaRarity, string> = {
  common: "rgba(156,163,175,0.25)",
  rare: "rgba(10,186,181,0.45)",
  epic: "rgba(99,102,241,0.55)",
  legendary: "rgba(245,158,11,0.7)",
};

export const describeGachaReward = (
  rewardType: string,
  amount: number,
  _rarity: GachaRarity,
): { name: string; iconKind: "coins" | "exp" } => {
  if (rewardType === "coins") {
    return { name: `${amount.toLocaleString()} コイン`, iconKind: "coins" };
  }
  return { name: `${amount.toLocaleString()} EXP`, iconKind: "exp" };
};
