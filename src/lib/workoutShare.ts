export interface SetData {
  set: number;
  weight: number;
  reps: number;
}

export interface WorkoutSessionExercise {
  exercise_id: string;
  exercise_name: string;
  sets: SetData[];
  maxWeight: number;
  totalReps: number;
  setsCount: number;
}

export interface WorkoutSession {
  date: string; // YYYY-MM-DD
  exercises: WorkoutSessionExercise[];
  totalVolume: number;
  totalSets: number;
  exerciseCount: number;
  durationMin: number;
}

export interface RawWorkout {
  id: string;
  workout_date: string;
  weight: number | null;
  reps: number | null;
  sets: SetData[] | null;
  exercise_id: string;
  exercise_name: string;
}

export const normalizeSets = (w: { sets: SetData[] | null; weight: number | null; reps: number | null }): SetData[] => {
  if (w.sets && Array.isArray(w.sets) && w.sets.length > 0) {
    return w.sets.map((s, i) => ({
      set: s.set ?? i + 1,
      weight: Number(s.weight) || 0,
      reps: Number(s.reps) || 0,
    }));
  }
  if (w.weight != null) {
    return [{ set: 1, weight: Number(w.weight) || 0, reps: Number(w.reps) || 0 }];
  }
  return [];
};

/**
 * Build a workout session for a given date.
 * - allWorkouts: all workouts of the user
 * - date: YYYY-MM-DD of the session
 */
export const buildSession = (allWorkouts: RawWorkout[], date: string): WorkoutSession => {
  const sessionRows = allWorkouts.filter((w) => w.workout_date === date);

  // Group by exercise
  const byExercise = new Map<string, RawWorkout[]>();
  sessionRows.forEach((w) => {
    const k = w.exercise_id || w.exercise_name;
    if (!byExercise.has(k)) byExercise.set(k, []);
    byExercise.get(k)!.push(w);
  });

  const exercises: WorkoutSessionExercise[] = [];
  let totalVolume = 0;
  let totalSets = 0;

  byExercise.forEach((rows, key) => {
    const allSets: SetData[] = [];
    rows.forEach((r) => allSets.push(...normalizeSets(r)));
    if (allSets.length === 0) return;

    const maxWeight = allSets.reduce((m, s) => Math.max(m, s.weight), 0);
    const totalReps = allSets.reduce((m, s) => m + s.reps, 0);
    const volume = allSets.reduce((m, s) => m + s.weight * s.reps, 0);

    exercises.push({
      exercise_id: key,
      exercise_name: rows[0].exercise_name,
      sets: allSets,
      maxWeight,
      totalReps,
      setsCount: allSets.length,
    });
    totalVolume += volume;
    totalSets += allSets.length;
  });

  return {
    date,
    exercises: exercises.sort((a, b) => b.maxWeight - a.maxWeight),
    totalVolume: Math.round(totalVolume),
    totalSets,
    exerciseCount: exercises.length,
    durationMin: 60,
  };
};

/**
 * Convert total weight (kg) into a relatable metaphor string.
 */
export const volumeMetaphor = (totalKg: number): string => {
  if (totalKg <= 0) return "";
  if (totalKg < 1000) {
    const dogs = Math.max(1, Math.round(totalKg / 30));
    return `大型犬 約${dogs}匹分 🐕`;
  }
  if (totalKg < 3000) {
    const cars = Math.max(1, Math.round(totalKg / 900));
    return `軽自動車 約${cars}台分 🚗`;
  }
  if (totalKg < 10000) {
    const elephants = Math.max(1, Math.round(totalKg / 6000));
    return `アフリカゾウ 約${elephants}頭分 🐘`;
  }
  const whales = Math.max(1, Math.round(totalKg / 30000));
  return `シロナガスクジラ 約${whales}頭分 🐋`;
};

export const formatShareDate = (dateStr: string): string => {
  // Interpret yyyy-MM-dd as a JST wall-clock day
  const d = new Date(dateStr + "T00:00:00+09:00");
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dows = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return `${y}.${m}.${day} ${dows[d.getDay()]}`;
};

/**
 * Render the share card directly with the Canvas 2D API.
 * This bypasses html2canvas entirely so it works reliably in mobile WebViews.
 */
export type ShareCanvasTheme = "dark" | "light" | "transparent";

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

export async function renderShareCanvas(
  session: WorkoutSession,
  theme: ShareCanvasTheme,
  logoUrl?: string | null,
): Promise<HTMLCanvasElement> {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const isLight = theme === "light";
  const isTransparent = theme === "transparent";

  const nameColor = isTransparent ? "#FFFFFF" : isLight ? "#111111" : "#FFFFFF";
  const valueColor = isTransparent
    ? "rgba(255,255,255,0.85)"
    : isLight
      ? "#777777"
      : "#888888";
  const subtleColor = isTransparent
    ? "rgba(255,255,255,0.75)"
      : isLight
        ? "#999999"
        : "#666666";
  const accent = "#0ABAB5";

  // Background
  if (!isTransparent) {
    ctx.fillStyle = isLight ? "#FAF9F6" : "#0F0F0F";
    ctx.fillRect(0, 0, W, H);
  }

  // Optional drop shadow for transparent theme so text stays readable
  const applyShadow = () => {
    if (isTransparent) {
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  };
  applyShadow();

  const FONT_FAMILY =
    "'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const cx = W / 2;

  // Letter-spacing helper (canvas doesn't support letter-spacing on fillText)
  const fillTextSpaced = (
    text: string,
    x: number,
    y: number,
    spacing: number,
  ) => {
    if (!text) return;
    if (spacing <= 0) {
      ctx.fillText(text, x, y);
      return;
    }
    const chars = Array.from(text);
    const widths = chars.map((c) => ctx.measureText(c).width);
    const totalWidth =
      widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let cursor = x - totalWidth / 2;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = "left";
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], cursor, y);
      cursor += widths[i] + spacing;
    }
    ctx.textAlign = prevAlign;
  };

  // ---------- Time ----------
  let y = 350;
  ctx.fillStyle = subtleColor;
  ctx.font = `300 22px ${FONT_FAMILY}`;
  fillTextSpaced("トレーニング時間", cx, y, 22 * 0.3);

  y += 90;
  ctx.fillStyle = nameColor;
  ctx.font = `500 76px ${FONT_FAMILY}`;
  const minStr = String(session.durationMin);
  // Measure to position "分" suffix
  const minWidth = ctx.measureText(minStr).width;
  const suffix = "分";
  ctx.font = `300 36px ${FONT_FAMILY}`;
  const suffixWidth = ctx.measureText(suffix).width;
  const gap = 8;
  const totalW = minWidth + gap + suffixWidth;
  const startX = cx - totalW / 2;

  ctx.textAlign = "left";
  ctx.fillStyle = nameColor;
  ctx.font = `500 76px ${FONT_FAMILY}`;
  ctx.fillText(minStr, startX, y);
  ctx.fillStyle = subtleColor;
  ctx.font = `300 36px ${FONT_FAMILY}`;
  ctx.fillText(suffix, startX + minWidth + gap, y);
  ctx.textAlign = "center";

  // ---------- Exercises ----------
  const visibleExercises = session.exercises.slice(0, 6);
  const hiddenCount = session.exercises.length - visibleExercises.length;

  y += 110;
  for (const ex of visibleExercises) {
    ctx.fillStyle = nameColor;
    ctx.font = `500 38px ${FONT_FAMILY}`;
    ctx.fillText(ex.exercise_name, cx, y);
    y += 50;

    ctx.fillStyle = valueColor;
    ctx.font = `400 28px ${FONT_FAMILY}`;
    fillTextSpaced(`${ex.maxWeight}kg  ×  ${ex.totalReps}`, cx, y, 28 * 0.04);
    y += 74;
  }

  if (hiddenCount > 0) {
    ctx.fillStyle = subtleColor;
    ctx.font = `300 22px ${FONT_FAMILY}`;
    ctx.fillText(`+${hiddenCount} more`, cx, y);
    y += 60;
  }

  // ---------- Date ----------
  y += 30;
  ctx.fillStyle = subtleColor;
  ctx.font = `300 22px ${FONT_FAMILY}`;
  fillTextSpaced(formatShareDate(session.date), cx, y, 22 * 0.25);

  // ---------- Footer logo ----------
  // Disable shadow for footer crispness
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  const footerY = H - 140;
  let logoImg: HTMLImageElement | null = null;
  if (logoUrl) {
    try {
      logoImg = await loadImage(logoUrl);
    } catch {
      logoImg = null;
    }
  }

  // Compute footer total width
  ctx.font = `700 26px ${FONT_FAMILY}`;
  const saluteW = ctx.measureText("Salute").width;
  const nameGap = 8;
  const goshoW = ctx.measureText("御所南").width;
  const titleW = saluteW + nameGap + goshoW;

  const logoSize = 48;
  const logoGap = 16;
  const footerW = (logoImg ? logoSize + logoGap : 0) + titleW;
  let fx = cx - footerW / 2;

  if (logoImg) {
    ctx.drawImage(logoImg, fx, footerY - logoSize / 2 - 8, logoSize, logoSize);
    fx += logoSize + logoGap;
  }

  ctx.textAlign = "left";
  ctx.fillStyle = accent;
  ctx.font = `700 26px ${FONT_FAMILY}`;
  ctx.fillText("Salute", fx, footerY);
  ctx.fillStyle = nameColor;
  ctx.fillText("御所南", fx + saluteW + nameGap, footerY);

  // Subtitle
  ctx.fillStyle = subtleColor;
  ctx.font = `300 12px ${FONT_FAMILY}`;
  const subY = footerY + 22;
  // Use spaced helper centered on the title block
  const titleCenter = fx + titleW / 2;
  ctx.textAlign = "center";
  fillTextSpaced("PERSONAL GYM", titleCenter, subY, 12 * 0.45);

  return canvas;
}

/**
 * Generate a PNG Blob of the share image by calling the server-side SVG
 * endpoint and rasterizing it in the browser via <img> + <canvas>.
 * This works reliably in iOS PWAs where html2canvas / direct Canvas drawing
 * sometimes fail to produce a usable image.
 */
import { supabase } from "@/integrations/supabase/client";

export async function generateSharePngBlob(
  session: WorkoutSession,
  theme: ShareCanvasTheme,
): Promise<Blob> {
  const payload = {
    exercises: session.exercises.slice(0, 6).map((ex) => ({
      name: ex.exercise_name,
      weight: ex.maxWeight,
      reps: ex.totalReps,
    })),
    date: formatShareDate(session.date),
    duration: session.durationMin,
    theme,
  };

  const { data, error } = await supabase.functions.invoke(
    "generate-share-image",
    { body: payload },
  );
  if (error) throw error;
  const svgText =
    typeof data === "string"
      ? data
      : data instanceof Blob
        ? await data.text()
        : String(data);

  // Rasterize SVG -> PNG via <img> + <canvas>
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("svg image load failed"));
      im.src = url;
    });

    const W = 1080;
    const H = 1920;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    if (theme !== "transparent") {
      ctx.fillStyle = theme === "light" ? "#FAF9F6" : "#0F0F0F";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(img, 0, 0, W, H);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!blob) throw new Error("png blob failed");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}