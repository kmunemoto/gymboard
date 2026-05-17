import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// JST helpers
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const nowJst = () => new Date(Date.now() + JST_OFFSET_MS);
const lastDayOfMonth = (year: number, monthIndex0: number) =>
  new Date(year, monthIndex0 + 1, 0).getDate();
const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtJa = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // LINE通知は無効化されました（ユーザー要望）。
    return new Response(
      JSON.stringify({ disabled: true, reason: "monthly report LINE notification disabled by request" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

    // 以下は無効化済みコード（参考用）
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Today in JST
    const today = nowJst();
    const y = today.getFullYear();
    const m = today.getMonth(); // 0-indexed
    const todayDay = today.getDate();

    // The contract start day (= cycle_start_date day-of-month) we send to today.
    // Send happens the day AFTER the period end. Period end = start day of THIS cycle in prev month.
    // So target start day = todayDay - 1, with month-rollover handling.
    let targetStartDay = todayDay - 1;
    if (targetStartDay === 0) {
      // Today is the 1st → previous month's last day
      targetStartDay = lastDayOfMonth(y, m - 1);
    }

    // Period: from (prev month, targetStartDay) to (this month, targetStartDay)
    // Handle months where prev month has fewer days (clamp), but since targetStartDay was derived
    // from existing dates, prev month should support it. Still clamp safely.
    const prevMonthLast = lastDayOfMonth(y, m - 1);
    const periodStart = new Date(y, m - 1, Math.min(targetStartDay, prevMonthLast));
    const periodEnd = new Date(y, m, Math.min(targetStartDay, lastDayOfMonth(y, m)));
    // periodEnd is the last day of the cycle (inclusive boundary as user-facing label).

    const periodStartStr = fmt(periodStart);
    const periodEndStr = fmt(periodEnd);
    const periodLabel = `${fmtJa(periodStart)} 〜 ${fmtJa(periodEnd)}`;

    // Fetch all customers with LINE linked
    const { data: customers, error: profErr } = await supabase
      .from("profiles")
      .select("user_id, display_name, line_user_id, cycle_start_date")
      .not("line_user_id", "is", null);

    if (profErr) throw profErr;
    if (!customers || customers.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "no customers with LINE" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter: cycle_start_date day matches targetStartDay (null → treat as day=1)
    const matched = customers.filter((c) => {
      let day = 1;
      if (c.cycle_start_date) {
        const d = new Date(c.cycle_start_date as string);
        // cycle_start_date is a DATE; parse safely as YYYY-MM-DD
        const parts = (c.cycle_start_date as string).split("-");
        if (parts.length === 3) day = parseInt(parts[2], 10);
        else day = d.getDate();
      }
      return day === targetStartDay;
    });

    const results: any[] = [];

    for (const customer of matched) {
      // Booking count in period [periodStart, periodEnd) — period end exclusive
      const { count: bookingCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("user_id", customer.user_id)
        .gte("booking_date", periodStartStr)
        .lt("booking_date", periodEndStr)
        .neq("status", "キャンセル済み");

      const message =
        `トレーニングレポートが届きました📊\n\n` +
        `期間：${periodLabel}\n` +
        `来店回数：${bookingCount || 0}回\n\n` +
        `アプリのホーム画面から詳しいレポートをご覧ください！`;

      const res = await fetch(`${supabaseUrl}/functions/v1/send-line-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          line_user_id: customer.line_user_id,
          message,
        }),
      });

      results.push({
        user_id: customer.user_id,
        success: res.ok,
        period: periodLabel,
      });
    }

    return new Response(
      JSON.stringify({
        targetStartDay,
        period: { start: periodStartStr, end: periodEndStr, label: periodLabel },
        candidates: customers.length,
        matched: matched.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("monthly-report-notification error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
