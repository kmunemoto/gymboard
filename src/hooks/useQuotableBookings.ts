import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { type QuotableBooking, pickQuotableBookings } from "@/lib/messageQuote";

/** 引用の候補を探しにいく範囲。これより外の予約は会話のきっかけにならない。 */
const LOOKBACK_DAYS = 30;
const LOOKAHEAD_DAYS = 60;

/**
 * チャットで引用できる予約（その相手の直近分）。
 *
 * ⚠️ 取得は**日付で絞る**。会話を開くたびに全予約を引くと、続いているお客様ほど重くなる。
 */
export const useQuotableBookings = (customerUserId: string | null) => {
  const [bookings, setBookings] = useState<QuotableBooking[]>([]);

  const fetchBookings = useCallback(async () => {
    if (!customerUserId) {
      setBookings([]);
      return;
    }
    const now = Date.now();
    const from = new Date(now - LOOKBACK_DAYS * 86400_000).toISOString();
    const to = new Date(now + LOOKAHEAD_DAYS * 86400_000).toISOString();

    const { data, error } = await supabase
      .from("bookings")
      .select("id, booking_date, booking_type, status")
      .eq("user_id", customerUserId)
      .gte("booking_date", from)
      .lte("booking_date", to)
      .order("booking_date", { ascending: true });

    if (error) {
      console.error("引用できる予約の取得に失敗:", error);
      setBookings([]);
      return;
    }
    setBookings(pickQuotableBookings((data ?? []) as QuotableBooking[]));
  }, [customerUserId]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  return { bookings, refetch: fetchBookings };
};
