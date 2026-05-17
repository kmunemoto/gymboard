/** Build a side-by-side comparison image as a Blob (PNG). */
export async function buildCompareImage(
  beforeUrl: string,
  afterUrl: string,
  beforeDate: string,
  afterDate: string,
  daysBetween: number,
  watermark = "Salute 御所南",
): Promise<Blob> {
  const [beforeImg, afterImg] = await Promise.all([loadImage(beforeUrl), loadImage(afterUrl)]);

  const targetH = 1200;
  const beforeW = Math.round((beforeImg.width / beforeImg.height) * targetH);
  const afterW = Math.round((afterImg.width / afterImg.height) * targetH);

  const gap = 24;
  const headerH = 160;
  const footerH = 80;
  const padding = 32;
  const canvasW = beforeW + afterW + gap + padding * 2;
  const canvasH = targetH + headerH + footerH + padding * 2;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Header — elapsed days
  ctx.fillStyle = "#333333";
  ctx.textAlign = "center";
  ctx.font = "bold 64px system-ui, -apple-system, sans-serif";
  ctx.fillText(`${daysBetween}日間の変化`, canvasW / 2, padding + 70);
  ctx.fillStyle = "#999999";
  ctx.font = "32px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `${formatDate(beforeDate)} → ${formatDate(afterDate)}`,
    canvasW / 2,
    padding + 120,
  );

  // Photos
  const photoY = padding + headerH;
  ctx.drawImage(beforeImg, padding, photoY, beforeW, targetH);
  ctx.drawImage(afterImg, padding + beforeW + gap, photoY, afterW, targetH);

  // Date labels above each photo
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(padding, photoY, beforeW, 56);
  ctx.fillRect(padding + beforeW + gap, photoY, afterW, 56);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`Before  ${formatDate(beforeDate)}`, padding + 16, photoY + 38);
  ctx.fillText(`After  ${formatDate(afterDate)}`, padding + beforeW + gap + 16, photoY + 38);

  // Watermark bottom right
  ctx.fillStyle = "rgba(120, 95, 60, 0.75)";
  ctx.font = "bold 28px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(watermark, canvasW - padding, canvasH - padding);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function formatDate(d: string): string {
  const dt = new Date(d);
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, "0")}.${String(dt.getDate()).padStart(2, "0")}`;
}

export function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(b).getTime() - new Date(a).getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}