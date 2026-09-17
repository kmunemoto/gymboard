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
  /** 紐付け先の会員アカウント（profiles.user_id）。未紐付けなら null。トレーナーが手動で設定する */
  user_id: string | null;
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

  const linkToClient = useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string | null }) => {
      const { error } = await supabase
        .from("counseling_responses")
        .update({ user_id: userId } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["counseling_responses"] }),
  });

  const unreadCount = responses.filter((r) => !r.reviewed).length;

  return { responses, isLoading, markReviewed, updateMemo, linkToClient, unreadCount };
};

/**
 * カルテ画面（TrainerClientDetail）向け。指定した顧客に紐付いた最新のカウンセリング回答
 * （既往歴・注意部位のみ）を1件取得する。紐付けが無ければ null。
 * 同じ顧客が複数回申し込んでいる場合は created_at が最新の1件を「現在の禁忌事項」とみなす。
 */
export interface ClientPrecautions {
  id: string;
  pain_areas: string[] | null;
  medical_history: string | null;
  created_at: string;
}

export const useClientPrecautions = (clientId: string | undefined) => {
  return useQuery({
    queryKey: ["client_precautions", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("counseling_responses")
        .select("id, pain_areas, medical_history, created_at")
        .eq("user_id", clientId as string)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ClientPrecautions | null;
    },
    enabled: !!clientId,
  });
};
