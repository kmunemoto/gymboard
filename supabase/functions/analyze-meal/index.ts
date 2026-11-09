import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { isSafeOwnStoragePath } from "../_shared/storagePath.ts";
import { MEAL_STAGE_TIMEOUTS, askWithFallback, type AiCaller } from "../_shared/mealAiModel.ts";

// どの版が動いているかを外から確かめるための印（全部の応答に付く。中身は日付だけ）。
// Edge Function は push でも Publish でも出ないので、デプロイの確認に使う（mem/ops/edge-function-deploy.md）。
const BUILD = "2026-11-09-gemini-4-argon";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "x-gymboard-build": BUILD,
};

// AI を1回呼ぶ。モデルは _shared/mealAiModel.ts（主: 一番賢いモデル・予備: 速いモデル）が決める。
// 時間切れは AbortController で切る（Edge Function 全体の時間に収めるため）。
async function callAI(apiKey: string, messages: unknown[], model: string, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw Object.assign(new Error(`AI error ${res.status}: ${text}`), { status: res.status });
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

const caller = (apiKey: string, messages: unknown[]): AiCaller =>
  (model, timeoutMs) => callAI(apiKey, messages, model, timeoutMs);

const logFallback = (stage: string) => (message: string, detail?: unknown) =>
  console.error(`[analyze-meal] ${stage}: ${message}`, detail ?? "");

function parseJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ---- AUTH: verify caller JWT ----
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // 🔴 imageUrl（リクエストの値）は使わない。写真は食事の行（meals.image_url）から読む（下の 🔴 参照）。
    //    古いアプリも新しいアプリも、送ってくる imageUrl は meals.image_url と同じ値なので、動きは変わらない。
    const { mealId, mealTypeHint, quantityNote } = await req.json();
    if (!mealId) {
      return new Response(JSON.stringify({ error: "mealId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // ---- OWNERSHIP CHECK ----
    const { data: mealRow, error: mealErr } = await supabase
      .from("meals").select("id, user_id, image_url").eq("id", mealId).maybeSingle();
    if (mealErr || !mealRow) {
      return new Response(JSON.stringify({ error: "Meal not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (mealRow.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // 写真の場所は食事の行から読む（リクエストの値は信じない）。
    // 🔴 2026-10-31 の点検: 以前はリクエストの imageUrl をそのまま service_role の createSignedUrl に渡していた。
    //    storage-js はパスを文字列でつなぐだけなので、`../../../bucket/<バケット>/empty` を渡すと
    //    「バケットを空にする」API に service_role で届き、全部のジムの写真・チャットの添付を消せた
    //    （`../../../../../functions/v1/<名前>` なら service_role 専用の関数も起動できた）。
    //    行の image_url も本人が書けるので、行の値も isSafeOwnStoragePath で確かめてから使う。
    const imageUrl = typeof mealRow.image_url === "string" ? mealRow.image_url : "";
    let resolvedImageUrl = imageUrl;
    if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
      // 本人のフォルダの中の普通のファイル名だけ（..・%・\・?・# を含むものは通さない）
      if (!isSafeOwnStoragePath(imageUrl, userId)) {
        return new Response(JSON.stringify({ error: "Invalid image path" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: signedData, error: signError } = await supabase.storage
        .from("meal-photos").createSignedUrl(imageUrl, 600);
      if (signError || !signedData?.signedUrl) {
        console.error("Failed to create signed URL:", signError);
        throw new Error("Could not access uploaded image");
      }
      resolvedImageUrl = signedData.signedUrl;
    }

    let extraContext = "";
    if (mealTypeHint) extraContext += `\nユーザーの申告：この食事は「${mealTypeHint}」です。`;
    if (quantityNote) extraContext += `\n量の補足情報：「${quantityNote}」`;

    const stage1System = `あなたは日本の食事写真を分析する専門家です。写真に映っているすべての料理と食材を正確に特定してください。

【ルール】
- 料理名は具体的に書くこと（×「炒め物」→ ○「豚肉とキャベツの野菜炒め」）
- 器のサイズから量を推定すること（茶碗1杯のご飯=約150g、味噌汁椀1杯=約200ml）
- 調味料・油も考慮すること（炒め物には油約大さじ1=12g等）
- ソース・ドレッシング・マヨネーズなどの付属調味料も含めること
- 日本の一般的な外食・家庭料理の一人前サイズを基準にすること
- 見落としがないよう、メインのおかず・副菜・汁物・主食・飲み物すべてリストアップすること${extraContext}

以下のJSON形式で回答してください（JSON以外のテキストは不要）：
{
  "dishes": [
    { "name": "料理名", "weight_g": 推定グラム数, "ingredients": ["主な食材1", "食材2"] }
  ]
}`;

    // 1段目: 写真から料理を特定する（主のモデルで読めなければ予備で聞き直す）
    const stage1 = await askWithFallback(
      caller(LOVABLE_API_KEY, [
        { role: "system", content: stage1System },
        { role: "user", content: [
          { type: "image_url", image_url: { url: resolvedImageUrl, detail: "high" } },
          { type: "text", text: "この食事の写真に映っているすべての料理を特定してください。" },
        ]},
      ]),
      (text) => {
        let parsed;
        try { parsed = parseJson(text); } catch { parsed = null; }
        return parsed?.dishes?.length ? parsed : null;
      },
      MEAL_STAGE_TIMEOUTS.dishes,
      logFallback("stage1"),
    );
    const stage1Result = stage1.result;

    if (!stage1Result?.dishes?.length) {
      console.error("Stage 1 failed:", stage1.raw);
      return new Response(JSON.stringify({ error: "料理の特定に失敗しました。もう一度お試しください。" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dishList = stage1Result.dishes.map((d: { name: string; weight_g: number; ingredients: string[] }, i: number) =>
      `${i + 1}. ${d.name}（${d.weight_g}g）- 食材: ${d.ingredients.join("、")}`
    ).join("\n");

    const mealTypeInstruction = mealTypeHint
      ? `\nユーザー申告の食事タイプ: ${mealTypeHint}（この情報を meal_type に使用してください）` : "";

    const stage2System = `あなたは管理栄養士です。以下の食事内容の栄養素を、日本食品標準成分表2020年版（八訂）に基づいて正確に計算してください。

【食事内容】
${dishList}
${mealTypeInstruction}

【計算ルール】
- 各料理について食材ごとに栄養素を計算し、合算すること
- 調理による栄養素の変化を考慮すること（揚げ物の吸油率10-15%、茹で野菜のビタミン損失等）
- カロリーはアトウォーター係数（タンパク質4kcal/g、脂質9kcal/g、炭水化物4kcal/g）で検算すること
- 推定値に自信がない場合は、少し多めに見積もること（ダイエット目的のユーザーが多いため）
- 調味料（醤油・砂糖・みりん・油・マヨネーズ等）の栄養素も必ず加算すること

【アドバイスのルール（250文字以内）】
- 良い点を1つ、改善点を1〜2つ、具体的な代替案とセットで提示
- 代替案は入手しやすい日本の食材で提案（例：「フランクフルトを鶏むね肉のグリルに置き換えると脂質が約15g減らせます」）
- PFCバランスの偏りがあれば具体的な数値で指摘
- 4文以内に簡潔にまとめる

以下のJSON形式のみで回答（JSON以外のテキストは不要）：
{
  "dishes": [
    { "name": "料理名", "weight_g": グラム(整数), "calories": kcal(整数), "protein": g(小数点1桁), "fat": g(小数点1桁), "carbs": g(小数点1桁), "fiber": g(小数点1桁) }
  ],
  "total": { "meal_type": "朝食 or 昼食 or 夕食 or 間食", "calories": 合計kcal(整数), "protein": g(小数点1桁), "fat": g(小数点1桁), "carbs": g(小数点1桁), "fiber": g(小数点1桁) },
  "feedback": "アドバイステキスト"
}`;

    // 2段目: 栄養の計算とアドバイス（同じく、読めなければ予備で聞き直す）
    const stage2 = await askWithFallback(
      caller(LOVABLE_API_KEY, [
        { role: "system", content: stage2System },
        { role: "user", content: "上記の食事内容の栄養素を計算してください。" },
      ]),
      (text) => {
        try { return parseJson(text); } catch { return null; }
      },
      MEAL_STAGE_TIMEOUTS.nutrition,
      logFallback("stage2"),
    );
    const analysis = stage2.result;
    console.log(`[analyze-meal] models stage1=${stage1.model} stage2=${stage2.model}`);

    if (!analysis) {
      console.error("Stage 2 failed:", stage2.raw);
      return new Response(JSON.stringify({ error: "栄養素の計算に失敗しました。もう一度お試しください。" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const total = analysis.total || analysis;
    const dishes = analysis.dishes || null;

    // Update meal — scoped to verified owner
    const { error: updateError } = await supabase
      .from("meals")
      .update({
        meal_type: total.meal_type || mealTypeHint || "食事",
        calories: total.calories || 0,
        protein: total.protein || 0,
        fat: total.fat || 0,
        carbs: total.carbs || 0,
        fiber: total.fiber || 0,
        feedback: analysis.feedback || "",
        dishes: dishes,
        analyzed: true,
      })
      .eq("id", mealId)
      .eq("user_id", userId);

    if (updateError) {
      console.error("DB update error:", updateError);
      throw new Error("Database update failed");
    }

    // models: どちらのモデルが答えたか（画面は使わない。確かめ用）
    return new Response(JSON.stringify({ success: true, analysis: { ...total, dishes, feedback: analysis.feedback }, models: { dishes: stage1.model, nutrition: stage2.model } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("analyze-meal error:", e);
    const err = e as { status?: number; message?: string };
    if (err.status === 429) {
      return new Response(JSON.stringify({ error: "レート制限に達しました。しばらく待ってから再試行してください。" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (err.status === 402) {
      return new Response(JSON.stringify({ error: "クレジットが不足しています。" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
