import {
  Layers, Target, Repeat, Dumbbell, Scale, Award, Sun, Hash, Compass,
  CalendarCheck, Flame, Star, Trophy, Shield, Zap, Sparkles, Clover, Crown,
  Swords, Mountain, Footprints, CircleDot, Sunrise, Moon, TrendingUp, Radar,
  Weight, Coins, Camera, Gift, Rocket, Medal, PartyPopper, Hexagon, Boxes,
  Flower2, Hammer, DoorOpen, Anchor, TreePine, CloudSun, Church,
  type LucideIcon,
} from "lucide-react";

export type BadgeRarity = "normal" | "rare" | "epic";

const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  first_step: Sparkles,
  power_up: TrendingUp,
  multiplayer: Layers,
  mission_clear: Target,
  regular_visitor: Repeat,
  ton_club: Weight,
  balance_master: Scale,
  mission_master: Award,
  perfect_day: Sun,
  fifty_sessions: Hash,
  all_rounder: Compass,
  three_months: CalendarCheck,
  habit_formed: Flame,
  perfect_week: Star,
  hundred_sessions: Trophy,
  half_year: Shield,
  ten_ton_club: Zap,
  gacha_beginner: Sparkles,
  gacha_lucky: Clover,
  gacha_legend: Crown,
  mission_addict: Target,
  // New achievements
  first_session: Sparkles,
  first_pb: TrendingUp,
  combo_starter: Flame,
  first_raid: Swords,
  month_50k: Boxes,
  level_10: Star,
  first_event: PartyPopper,
  first_shot: Camera,
  best_hunter: TrendingUp,
  combo_master_ach: Flame,
  level_25: Medal,
  coin_collector: Coins,
  event_master: Gift,
  gacha_addict: Clover,
  record_breaker: Rocket,
  two_hundred_sessions: Hash,
  one_year: CalendarCheck,
  combo_king: Crown,
  raid_mvp: Trophy,
  month_200k: Hexagon,
  level_50: Crown,
  // Quest badges
  quest_garden_bloom: Flower2,
  quest_forge_master: Hammer,
  quest_stargazer: Star,
  // Training milestones
  milestone_10: Award,
  milestone_25: Medal,
  milestone_50: Trophy,
  milestone_75: Star,
  milestone_100: Crown,
  milestone_150: Hexagon,
  milestone_200: Flame,
};

const TITLE_ICONS: Record<string, LucideIcon> = {
  chest_master: Shield,
  back_master: Mountain,
  leg_master: Footprints,
  shoulder_master: CircleDot,
  arm_master: Dumbbell,
  early_bird: Sunrise,
  night_owl: Moon,
  consistency_king: Crown,
  volume_monster: TrendingUp,
  all_rounder_title: Radar,
  boss_slayer: Swords,
  mission_addict: Target,
  combo_master: Flame,
  // New titles
  core_oni: Shield,
  weekend_warrior: Sun,
  iron_man: Award,
  gacha_master: Clover,
  raid_slayer: Swords,
  streaker: Flame,
  record_child: Rocket,
  legend_title: Crown,
  // Collection milestone titles
  collector: Award,
  badge_master: Medal,
  complete_road: Rocket,
  legend_collector: Crown,
  // Quest titles
  liberator: DoorOpen,
  harbor_guardian: Anchor,
  spirit_ally: TreePine,
  sky_pioneer: CloudSun,
  kingdom_hero: Church,
};

const RARITY_GRADIENT: Record<BadgeRarity, string> = {
  normal: "linear-gradient(135deg, #0ABAB5, #06908C)",
  rare: "linear-gradient(135deg, #6366F1, #4F46E5)",
  epic: "linear-gradient(135deg, #F59E0B, #D97706)",
};

interface Props {
  type: "achievement" | "title";
  iconKey: string;
  rarity?: BadgeRarity;
  acquired?: boolean;
  equipped?: boolean;
  size?: number;
}

const BadgeIcon = ({ type, iconKey, rarity = "normal", acquired = true, equipped = false, size = 48 }: Props) => {
  const Icon =
    (type === "achievement" ? ACHIEVEMENT_ICONS[iconKey] : TITLE_ICONS[iconKey]) || Star;
  const iconSize = Math.round(size * 0.5);

  let background = "#E5E7EB";
  let color = "#9CA3AF";
  let shimmer = false;
  let ring = false;

  if (acquired) {
    color = "#FFFFFF";
    if (type === "title") {
      if (equipped) {
        background = RARITY_GRADIENT.epic;
        ring = true;
      } else {
        background = RARITY_GRADIENT.normal;
      }
    } else {
      background = RARITY_GRADIENT[rarity];
      shimmer = rarity === "epic";
    }
  }

  const isMissionAddict = type === "achievement" && iconKey === "mission_addict";

  return (
    <div
      className={`relative flex items-center justify-center rounded-full ${shimmer ? "badge-shimmer" : ""}`}
      style={{
        width: size,
        height: size,
        background,
        boxShadow: ring
          ? "0 2px 8px rgba(0,0,0,0.1), 0 0 0 3px rgba(245, 158, 11, 0.3)"
          : "0 2px 8px rgba(0,0,0,0.1)",
        willChange: shimmer ? "background" : undefined,
      }}
    >
      <Icon size={iconSize} color={color} strokeWidth={2.2} />
      {isMissionAddict && acquired && (
        <span
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            border: "1.5px dotted rgba(255,255,255,0.7)",
            margin: 2,
          }}
        />
      )}
    </div>
  );
};

export default BadgeIcon;

export const getAchievementIconComponent = (key: string): LucideIcon =>
  ACHIEVEMENT_ICONS[key] || Star;

export const getTitleIconComponent = (key: string): LucideIcon =>
  TITLE_ICONS[key] || Star;