import {
  Trophy, Target, Flame, Dumbbell, Star, Zap, Heart, Shield, Crown,
  Award, Medal, Swords, TrendingUp, Calendar, Sunrise, Moon, Mountain,
  Footprints, Compass, Scale, Repeat, Layers, Sparkles, Sun, Apple,
  Utensils, Coins, Gift, CheckCircle2, PartyPopper, Bot, BarChart3,
  Sword, Ban, UserPlus, RefreshCw, Bell, MessageCircle, Check, X, Megaphone, Info,
  CalendarDays, ThumbsUp, Smile, Snowflake, Leaf, Waves,
  type LucideIcon,
} from "lucide-react";

/** Curated icon set shown in the trainer icon picker and used for all gamified content. */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  Trophy, Target, Flame, Dumbbell, Star, Zap, Heart, Shield, Crown,
  Award, Medal, Swords, TrendingUp, Calendar, CalendarDays, Sunrise, Moon, Mountain,
  Footprints, Compass, Scale, Repeat, Layers, Sparkles, Sun, Apple,
  Utensils, Coins, Gift, CheckCircle2, PartyPopper, Bot, BarChart3,
  Sword, Ban, UserPlus, RefreshCw, Bell, MessageCircle, ThumbsUp, Smile, Megaphone, Info,
  Snowflake, Leaf, Waves,
};

export const PICKER_ICON_NAMES: string[] = [
  "Bell", "Megaphone", "Info", "Trophy", "Target", "Flame", "Dumbbell", "Star", "Zap", "Heart", "Shield",
  "Crown", "Award", "Medal", "Swords", "TrendingUp", "Calendar", "Sunrise",
  "Moon", "Mountain", "Footprints", "Compass", "Scale", "Repeat", "Layers",
  "Sparkles", "Sun", "Apple", "Utensils", "Coins", "Gift", "PartyPopper",
  "Snowflake", "Leaf", "Waves",
];

/** Map legacy emoji strings to a Lucide icon name. Falls back to Star. */
export const EMOJI_TO_ICON: Record<string, string> = {
  "🏆": "Trophy", "🥇": "Medal", "🥈": "Medal", "🥉": "Medal",
  "🎯": "Target", "🔥": "Flame", "💪": "Dumbbell", "🏋️": "Dumbbell",
  "🏋": "Dumbbell", "⭐": "Star", "🌟": "Star", "⚡": "Zap",
  "❤️": "Heart", "🛡️": "Shield", "👑": "Crown", "🎖️": "Award",
  "🏅": "Medal", "⚔️": "Swords", "🗡️": "Sword", "📈": "TrendingUp",
  "📅": "Calendar", "🗓️": "CalendarDays", "🌅": "Sunrise", "🌄": "Sunrise",
  "🌙": "Moon", "🌚": "Moon", "⛰️": "Mountain", "🏔️": "Mountain",
  "🦶": "Footprints", "🧭": "Compass", "⚖️": "Scale", "🔄": "Repeat",
  "📚": "Layers", "✨": "Sparkles", "☀️": "Sun", "🍎": "Apple",
  "🍽️": "Utensils", "🍴": "Utensils", "💰": "Coins", "🪙": "Coins",
  "🎁": "Gift", "✅": "CheckCircle2", "✔️": "CheckCircle2",
  "🎉": "PartyPopper", "🎊": "PartyPopper", "🤖": "Bot", "📊": "BarChart3",
  "🚫": "Ban", "🆕": "UserPlus", "🔔": "Bell", "💬": "MessageCircle",
  "👍": "ThumbsUp", "😊": "Smile", "😀": "Smile", "❄️": "Snowflake",
  "🍃": "Leaf", "🌊": "Waves", "🏖️": "Sun", "🏃": "Footprints",
  "🐕": "Star", "🚗": "Star", "🐘": "Star", "🐋": "Star",
  "👺": "Swords", "👹": "Swords", "🐉": "Swords", "👾": "Swords",
};

export const resolveIconName = (value: string | null | undefined): string => {
  if (!value) return "Star";
  if (ICON_REGISTRY[value]) return value;
  if (EMOJI_TO_ICON[value]) return EMOJI_TO_ICON[value];
  // Try first character as emoji (handles compound strings)
  const first = Array.from(value)[0];
  if (first && EMOJI_TO_ICON[first]) return EMOJI_TO_ICON[first];
  return "Star";
};

export const getIconComponent = (value: string | null | undefined): LucideIcon => {
  return ICON_REGISTRY[resolveIconName(value)] || Star;
};