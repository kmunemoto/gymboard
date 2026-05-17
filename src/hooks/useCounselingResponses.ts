import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CounselingResponse {
  id: string;
  last_name: string;
  first_name: string;
  last_name_kana: string | null;
  first_name_kana: string | null;
  age: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  ward: string | null;
  purposes: string[] | null;
  experience_level: string | null;
  target_frequency: string | null;
  exercise_habit: string | null;
  diet_pattern: string | null;
  sleep_hours: string | null;
  pain_areas: string[] | null;
  medical_history: string | null;
  notes: string | null;
  trainer_memo: string | null;
  reviewed: boolean;
  created_at: string;
}

export const useCounselingResponses = () => {
  const queryClient = useQueryClient();

  const { data: responses = [], isLoading } = useQuery({
    queryKey: ["counseling_responses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("counseling_responses")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CounselingResponse[];
    },
  });

  const markReviewed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("counseling_responses")
        .update({ reviewed: true } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["counseling_responses"] }),
  });

  const updateMemo = useMutation({
    mutationFn: async ({ id, memo }: { id: string; memo: string }) => {
      const { error } = await supabase
        .from("counseling_responses")
        .update({ trainer_memo: memo } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["counseling_responses"] }),
  });

  const unreadCount = responses.filter((r) => !r.reviewed).length;

  return { responses, isLoading, markReviewed, updateMemo, unreadCount };
};
