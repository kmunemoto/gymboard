import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resvg, initWasm } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ExerciseInput {
  name: string;
  weight: number;
  reps: number;
  muscleGroup?: string;
}

interface Payload {
  exercises: ExerciseInput[];
  date: string;
  duration: number;
  theme: "dark" | "light" | "transparent";
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

let wasmInitialized = false;
let notoFontBytes: Uint8Array | null = null;
let notoBoldFontBytes: Uint8Array | null = null;

async function ensureWasm() {
  if (wasmInitialized) return;
  const wasmRes = await fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm");
  const wasmBuf = await wasmRes.arrayBuffer();
  await initWasm(wasmBuf);
  wasmInitialized = true;
}

async function loadFonts() {
  if (!notoFontBytes) {
    const r = await fetch(
      "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf",
    );
    if (r.ok) {
      notoFontBytes = new Uint8Array(await r.arrayBuffer());
    }
  }
  if (!notoBoldFontBytes) {
    const r = await fetch(
      "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf",
    );
    if (r.ok) {
      notoBoldFontBytes = new Uint8Array(await r.arrayBuffer());
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await ensureWasm();
    await loadFonts();

    const body = (await req.json()) as Payload;
    const { exercises = [], date = "", duration = 60, theme = "dark" } = body;

    const bgColor =
      theme === "light" ? "#FAF9F6" : theme === "dark" ? "#0F0F0F" : "none";
    const textColor = theme === "light" ? "#111111" : "#FFFFFF";
    const subColor = theme === "light" ? "#999999" : "#888888";
    const accentColor = "#0ABAB5";

    const visible = exercises.slice(0, 6);
    const hiddenCount = exercises.length - visible.length;

    const FF = "'Noto Sans JP', sans-serif";

    let exerciseSvg = "";
    let y = 600;
    for (const ex of visible) {
      exerciseSvg += `<text x="540" y="${y}" font-family="${FF}" font-size="40" font-weight="500" fill="${textColor}" text-anchor="middle">${escapeXml(ex.name)}</text>`;
      y += 56;
      if (ex.muscleGroup) {
        exerciseSvg += `<text x="540" y="${y}" font-family="${FF}" font-size="22" font-weight="600" fill="${accentColor}" text-anchor="middle">[${escapeXml(ex.muscleGroup)}]</text>`;
        y += 36;
      }
      exerciseSvg += `<text x="540" y="${y}" font-family="${FF}" font-size="32" font-weight="400" fill="${subColor}" text-anchor="middle">${ex.weight}kg × ${ex.reps}</text>`;
      y += 80;
    }
    if (hiddenCount > 0) {
      exerciseSvg += `<text x="540" y="${y}" font-family="${FF}" font-size="26" font-weight="300" fill="${subColor}" text-anchor="middle">+${hiddenCount} more</text>`;
      y += 60;
    }

    const dateY = y + 50;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  ${bgColor !== "none" ? `<rect width="1080" height="1920" fill="${bgColor}"/>` : ""}
  <text x="540" y="380" font-family="${FF}" font-size="28" font-weight="300" fill="${subColor}" text-anchor="middle" letter-spacing="6">トレーニング時間</text>
  <text x="540" y="490" font-family="${FF}" font-size="84" font-weight="500" fill="${textColor}" text-anchor="middle">${duration}<tspan font-size="40" font-weight="300" fill="${subColor}" dx="10">分</tspan></text>
  ${exerciseSvg}
  <text x="540" y="${dateY}" font-family="${FF}" font-size="28" font-weight="300" fill="${subColor}" text-anchor="middle" letter-spacing="6">${escapeXml(date)}</text>
  <text x="540" y="1780" font-family="${FF}" font-size="40" font-weight="700" fill="${accentColor}" text-anchor="middle">Salute <tspan fill="${textColor}">御所南</tspan></text>
  <text x="540" y="1820" font-family="${FF}" font-size="22" font-weight="300" fill="${subColor}" text-anchor="middle" letter-spacing="8">PERSONAL GYM</text>
</svg>`;

    const fontBuffers: Uint8Array[] = [];
    if (notoFontBytes) fontBuffers.push(notoFontBytes);
    if (notoBoldFontBytes) fontBuffers.push(notoBoldFontBytes);

    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: 1080 },
      background: theme === "transparent" ? "rgba(0,0,0,0)" : undefined,
      font: {
        fontBuffers,
        loadSystemFonts: false,
        defaultFontFamily: "Noto Sans JP",
      },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    return new Response(pngBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("generate-share-image error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});