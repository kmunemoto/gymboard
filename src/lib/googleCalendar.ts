import { BRAND_FALLBACK_GYM_NAME } from "@/lib/brand";

export function buildGoogleCalendarUrl(
  date: string,
  startTime: string,
  endTime: string,
  planName?: string,
  gymName?: string,
): string {
  const dateClean = date.replace(/-/g, "");
  const startClean = startTime.replace(":", "") + "00";
  const endClean = endTime.replace(":", "") + "00";
  const gym = gymName || BRAND_FALLBACK_GYM_NAME;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${gym} トレーニング`,
    dates: `${dateClean}T${startClean}/${dateClean}T${endClean}`,
    ctz: "Asia/Tokyo",
    details: `予約プラン：${planName || "パーソナルトレーニング"}\nお着替え等の準備のため、開始5分前にお越しください。`,
    location: gym,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
