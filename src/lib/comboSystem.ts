export const getComboMultiplier = (comboCount: number): number => {
  if (comboCount <= 1) return 1.0;
  if (comboCount === 2) return 1.2;
  if (comboCount === 3) return 1.5;
  if (comboCount === 4) return 1.8;
  return 2.0;
};

/** Number of flame icons to render for a given combo count. */
export const getComboFlameCount = (comboCount: number): number => {
  if (comboCount <= 1) return 0;
  if (comboCount === 2) return 1;
  if (comboCount === 3) return 2;
  if (comboCount === 4) return 3;
  return 4;
};

export const getComboColor = (comboCount: number): string => {
  if (comboCount <= 1) return "#999";
  if (comboCount === 2) return "#F59E0B"; // orange
  if (comboCount === 3) return "#F97316";
  if (comboCount === 4) return "#EF4444";
  return "#DC2626"; // red
};