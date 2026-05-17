-- Map legacy emoji icon strings on event/task tables to Lucide icon names
UPDATE public.season_events SET event_icon = CASE event_icon
  WHEN '🏆' THEN 'Trophy' WHEN '🎯' THEN 'Target' WHEN '🔥' THEN 'Flame'
  WHEN '💪' THEN 'Dumbbell' WHEN '🏋️' THEN 'Dumbbell' WHEN '⭐' THEN 'Star'
  WHEN '🌟' THEN 'Star' WHEN '⚡' THEN 'Zap' WHEN '👑' THEN 'Crown'
  WHEN '🎖️' THEN 'Award' WHEN '🏅' THEN 'Medal' WHEN '⚔️' THEN 'Swords'
  WHEN '📈' THEN 'TrendingUp' WHEN '📅' THEN 'Calendar' WHEN '🌅' THEN 'Sunrise'
  WHEN '🌙' THEN 'Moon' WHEN '⛰️' THEN 'Mountain' WHEN '🦶' THEN 'Footprints'
  WHEN '🧭' THEN 'Compass' WHEN '⚖️' THEN 'Scale' WHEN '🔄' THEN 'Repeat'
  WHEN '✨' THEN 'Sparkles' WHEN '☀️' THEN 'Sun' WHEN '🍎' THEN 'Apple'
  WHEN '🎁' THEN 'Gift' WHEN '🎉' THEN 'PartyPopper' WHEN '🎊' THEN 'PartyPopper'
  WHEN '🏖️' THEN 'Sun' WHEN '🏃' THEN 'Footprints'
  ELSE COALESCE(event_icon, 'Star')
END
WHERE event_icon ~ '[^A-Za-z]';

UPDATE public.season_events SET badge_icon = CASE badge_icon
  WHEN '🏆' THEN 'Trophy' WHEN '🏅' THEN 'Medal' WHEN '🥇' THEN 'Medal'
  WHEN '🎖️' THEN 'Award' WHEN '⭐' THEN 'Star' WHEN '👑' THEN 'Crown'
  WHEN '🏖️' THEN 'Sun' WHEN '🎉' THEN 'PartyPopper'
  ELSE COALESCE(badge_icon, 'Medal')
END
WHERE badge_icon IS NOT NULL AND badge_icon ~ '[^A-Za-z]';

UPDATE public.season_event_tasks SET task_icon = CASE task_icon
  WHEN '🏆' THEN 'Trophy' WHEN '🎯' THEN 'Target' WHEN '🔥' THEN 'Flame'
  WHEN '💪' THEN 'Dumbbell' WHEN '🏋️' THEN 'Dumbbell' WHEN '⭐' THEN 'Star'
  WHEN '⚡' THEN 'Zap' WHEN '👑' THEN 'Crown' WHEN '🏅' THEN 'Medal'
  WHEN '⚔️' THEN 'Swords' WHEN '📈' THEN 'TrendingUp' WHEN '📅' THEN 'Calendar'
  WHEN '🌅' THEN 'Sunrise' WHEN '🌙' THEN 'Moon' WHEN '🔄' THEN 'Repeat'
  WHEN '✨' THEN 'Sparkles' WHEN '🎁' THEN 'Gift' WHEN '🎉' THEN 'PartyPopper'
  WHEN '🏃' THEN 'Footprints' WHEN '☀️' THEN 'Sun'
  ELSE COALESCE(task_icon, 'Target')
END
WHERE task_icon IS NOT NULL AND task_icon ~ '[^A-Za-z]';