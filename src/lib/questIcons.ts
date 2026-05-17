import {
  DoorOpen, Flower2, Anchor, Hammer, TreePine, Star, CloudSun, Church,
  Lock, Check, Sparkles, Crown, type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  DoorOpen, Flower2, Anchor, Hammer, TreePine, Star, CloudSun, Church,
  Lock, Check, Sparkles, Crown,
};

export const getQuestIcon = (name: string): LucideIcon => MAP[name] || Sparkles;