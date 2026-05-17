import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  icon: string;
  target: string;
  published_at: string;
  created_at: string;
  created_by: string | null;
  image_url?: string | null;
  image_url2?: string | null;
}

/** Customer-facing list: published announcements visible to current user, plus read state. */
export const useAnnouncements = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<Announcement[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const nowIso = new Date().toISOString();
    const [{ data: anns }, { data: reads }] = await Promise.all([
      supabase
        .from("announcements")
        .select("*")
        .lte("published_at", nowIso)
        .order("published_at", { ascending: false }),
      supabase
        .from("announcement_reads")
        .select("announcement_id")
        .eq("user_id", user.id),
    ]);
    setItems((anns as Announcement[] | null) ?? []);
    setReadIds(new Set(((reads as { announcement_id: string }[] | null) ?? []).map((r) => r.announcement_id)));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const markRead = async (announcementId: string) => {
    if (!user) return;
    if (readIds.has(announcementId)) return;
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(announcementId);
      return next;
    });
    await supabase.from("announcement_reads").insert({
      user_id: user.id,
      announcement_id: announcementId,
    });
  };

  const markAllRead = async () => {
    if (!user) return;
    const unreadItems = items.filter((a) => !readIds.has(a.id));
    if (unreadItems.length === 0) return;
    setReadIds((prev) => {
      const next = new Set(prev);
      unreadItems.forEach((a) => next.add(a.id));
      return next;
    });
    const rows = unreadItems.map((a) => ({
      user_id: user.id,
      announcement_id: a.id,
    }));
    await supabase.from("announcement_reads").upsert(rows, {
      onConflict: "user_id,announcement_id",
      ignoreDuplicates: true,
    });
  };

  const unreadCount = items.filter((a) => !readIds.has(a.id)).length;

  return { items, readIds, unreadCount, loading, refetch: fetchAll, markRead, markAllRead };
};

/** Lightweight unread-count hook for header bell badge. */
export const useAnnouncementUnreadCount = () => {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refetch = useCallback(async () => {
    if (!user) return;
    const nowIso = new Date().toISOString();
    const [{ data: anns }, { data: reads }] = await Promise.all([
      supabase.from("announcements").select("id").lte("published_at", nowIso),
      supabase.from("announcement_reads").select("announcement_id").eq("user_id", user.id),
    ]);
    const readSet = new Set(((reads as { announcement_id: string }[] | null) ?? []).map((r) => r.announcement_id));
    const unread = ((anns as { id: string }[] | null) ?? []).filter((a) => !readSet.has(a.id)).length;
    setCount(unread);
  }, [user]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { count, refetch };
};