import type { RankKey } from "./avatarSystem";

export const RAID_DAMAGE_MULT: Record<RankKey, number> = {
  rookie: 1.0, regular: 1.2, athlete: 1.5, elite: 1.8, legend: 2.0,
};

export const MISSION_EXP_MULT: Record<RankKey, number> = {
  rookie: 1.0, regular: 1.1, athlete: 1.2, elite: 1.3, legend: 1.5,
};

export const GACHA_PROBS: Record<RankKey, { common: number; rare: number; epic: number; legendary: number }> = {
  rookie:  { common: 60, rare: 25, epic: 12, legendary: 3 },
  regular: { common: 57, rare: 25, epic: 14, legendary: 4 },
  athlete: { common: 53, rare: 25, epic: 17, legendary: 5 },
  elite:   { common: 49, rare: 25, epic: 20, legendary: 6 },
  legend:  { common: 42, rare: 25, epic: 25, legendary: 8 },
};

export const RANK_UP_REWARDS: Record<Exclude<RankKey, "rookie">, { coins: number; tickets: number }> = {
  regular: { coins: 270, tickets: 18 },
  athlete: { coins: 450, tickets: 27 },
  elite:   { coins: 900, tickets: 45 },
  legend:  { coins: 1800, tickets: 90 },
};

export const RANK_LABEL: Record<RankKey, string> = {
  rookie: "ルーキー", regular: "レギュラー", athlete: "アスリート", elite: "エリート", legend: "レジェンド",
};