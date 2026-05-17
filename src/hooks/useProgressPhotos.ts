import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type PhotoType = "front" | "side" | "back";

export interface ProgressPhoto {
  id: string;
  user_id: string;
  photo_url: string; // storage path
  photo_type: PhotoType;
  taken_date: string; // YYYY-MM-DD
  notes: string | null;
  created_at: string;
  signed_url?: string;
}

export const useProgressPhotos = (userIdOverride?: string) => {
  const { user } = useAuth();
  const userId = userIdOverride ?? user?.id;
  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPhotos = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("progress_photos")
      .select("*")
      .eq("user_id", userId)
      .order("taken_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      setPhotos([]);
      setLoading(false);
      return;
    }
    const list = (data || []) as ProgressPhoto[];
    // generate signed URLs in batch
    const paths = list.map((p) => p.photo_url);
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("progress-photos")
        .createSignedUrls(paths, 60 * 60);
      if (signed) {
        const map = new Map(signed.map((s, i) => [paths[i], s.signedUrl]));
        list.forEach((p) => {
          p.signed_url = map.get(p.photo_url) || undefined;
        });
      }
    }
    setPhotos(list);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  return { photos, loading, refetch: fetchPhotos };
};