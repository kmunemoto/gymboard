import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function callAI(apiKey: string, messages: unknown[], model = "google/gemini-2.5-flash") {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`AI error ${res.status}: ${text}`), { status: res.status });
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function parseJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { mealId, imageUrl, mealTypeHint, quantityNote } = await req.json();
    if (!mealId || !imageUrl) {
      return new Response(JSON.stringify({ error: "mealId and imageUrl required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Resolve storage path to signed URL
    let resolvedImageUrl = imageUrl;
    if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
      const { data: signedData, error: signError } = await supabase.storage
        .from("meal-photos")
        .createSignedUrl(imageUrl, 600);
      if (signError || !signedData?.signedUrl) {
        console.error("Failed to create signed URL:", signError);
        throw new Error("Could not access uploaded image");
      }
      resolvedImageUrl = signedData.signedUrl;
    }

    // Build extra context from user hints
    let extraContext = "";
    if (mealTypeHint) extraContext += `\nユーザーの申告：この食事は「${mealTypeHint}」です。`;
    if (quantityNote) extraContext += `\n量の補足情報：「${quantityNote}」`;

    // ========== STAGE 1: Identify dishes ==========
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

    const stage1Content = await callAI(LOVABLE_API_KEY, [
      { role: "system", content: stage1System },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: resolvedImageUrl, detail: "high" } },
          { type: "text", text: "この食事の写真に映っているすべての料理を特定してください。" },
        ],
      },
    ]);

    let stage1Result;
    try { stage1Result = parseJson(stage1Content); } catch { stage1Result = null; }

    if (!stage1Result?.dishes?.length) {
      console.error("Stage 1 failed:", stage1Content);
      return new Response(JSON.stringify({ error: "料理の特定に失敗しました。もう一度お試しください。" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Stage 1 result:", JSON.stringify(stage1Result));

    // ========== STAGE 2: Calculate nutrition ==========
    const dishList = stage1Result.dishes.map((d: { name: string; weight_g: number; ingredients: string[] }, i: number) =>
      `${i + 1}. ${d.name}（${d.weight_g}g）- 食材: ${d.ingredients.join("、")}`
    ).join("\n");

    const mealTypeInstruction = mealTypeHint
      ? `\nユーザー申告の食事タイプ: ${mealTypeHint}（この情報を meal_type に使用してください）`
      : "";

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

    const stage2Content = await callAI(LOVABLE_API_KEY, [
      { role: "system", content: stage2System },
      { role: "user", content: "上記の食事内容の栄養素を計算してください。" },
    ]);

    let analysis;
    try { analysis = parseJson(stage2Content); } catch { analysis = null; }

    if (!analysis) {
      console.error("Stage 2 failed:", stage2Content);
      return new Response(JSON.stringify({ error: "栄養素の計算に失敗しました。もう一度お試しください。" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Stage 2 result:", JSON.stringify(analysis));

    const total = analysis.total || analysis;
    const dishes = analysis.dishes || null;

    // Update the meal record in DB
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
      .eq("id", mealId);

    if (updateError) {
      console.error("DB update error:", updateError);
      throw new Error("Database update failed");
    }

    return new Response(JSON.stringify({ success: true, analysis: { ...total, dishes, feedback: analysis.feedback } }), {
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
