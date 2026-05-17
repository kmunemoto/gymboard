export function buildGoogleCalendarUrl(date: string, startTime: string, endTime: string, planName?: string): string {
  const dateClean = date.replace(/-/g, "");
  const startClean = startTime.replace(":", "") + "00";
  const endClean = endTime.replace(":", "") + "00";

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "パーソナルジムSalute御所南 トレーニング",
    dates: `${dateClean}T${startClean}/${dateClean}T${endClean}`,
    ctz: "Asia/Tokyo",
    details: `予約プラン：${planName || "パーソナルトレーニング"}\nお着替え等の準備のため、開始5分前にお越しください。`,
    location: "パーソナルジムSalute御所南",
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
