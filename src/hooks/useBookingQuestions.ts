import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import type { BookingQuestion } from "@/lib/bookingQuestions";

/**
 * そのジムの予約時カスタム質問（`booking_questions`）。
 *
 * ログイン済みの画面用。公開ページ（体験・ドロップイン）は anon なので
 * `get_tenant_booking_questions` RPC を直接呼ぶ（テーブルに anon の口は開けていない）。
 *
 * 🔴 **読めなかったら空配列**。質問が読めないせいで予約自体ができなくなるより、
 * 質問を飛ばして予約できるほうが安全（未適用の環境でも従来どおり動く）。
 */
export function useBookingQuestions() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [questions, setQuestions] = useState<BookingQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!tenantId) {
      setQuestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("booking_questions")
      .select(
        "id, label, help_text, input_type, options, required, sort_order, is_active, ask_on_member, ask_on_trial",
      )
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true });
    if (error || !data) {
      setQuestions([]);
    } else {
      setQuestions(
        (data as Record<string, unknown>[]).map((row) => ({
          id: String(row.id),
          label: String(row.label ?? ""),
          help_text: (row.help_text as string | null) ?? null,
          input_type: String(row.input_type ?? "text"),
          options: Array.isArray(row.options) ? (row.options as string[]) : null,
          required: row.required === true,
          sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
          is_active: row.is_active !== false,
          ask_on_member: row.ask_on_member !== false,
          ask_on_trial: row.ask_on_trial === true,
        })),
      );
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { questions, loading, refetch };
}
