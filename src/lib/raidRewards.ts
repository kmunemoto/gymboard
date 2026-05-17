import { supabase } from "@/integrations/supabase/client";

export const equipRaidItem = async (
  userId: string,
  category: "weapon" | "background",
  itemKey: string | null,
) => {
  const col = category === "weapon" ? "equipped_weapon" : "equipped_background";
  const { error } = await (supabase as any)
    .from("user_avatars")
    .update({ [col]: itemKey })
    .eq("user_id", userId);
  if (error) throw error;
};

export const RANK_LABEL_JP: Record<string, string> = {
  mvp: "MVP",
  contributor: "貢献者",
  participant: "参加者",
  none: "未参加",
};