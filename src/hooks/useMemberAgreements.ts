import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyTenantId } from "@/lib/tenantHelper";

/**
 * 契約・同意の記録（`member_agreements`）。
 *
 * ── 何を解こうとしているか ──────────────────────────────────
 * パーソナルジムは「体を触る・追い込む」業種で、事故と体調急変が起きうる。
 * それまでこのアプリには、規約への同意も、健康状態の申告も、
 * 「いつ何に同意したか」を残す場所が1つも無かった（2026-08-08 の棚卸し）。
 *
 * ── 🔴 これは同意「書」ではなく同意の「記録」 ────────────────
 * 電子署名でも、法的な契約書の保管でもない。
 * 「いつ・何に・同意を得た」という事実をジムが控えるための台帳。
 * 本文（規約そのもの）はここには入れない。紙・PDF はジム側の管理のまま。
 * **これを根拠に「同意済みだから責任は本人」と主張できる類のものではない**ので、
 * UI にもそう読める文言を書かないこと。
 */

export interface MemberAgreement {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  agreed_on: string; // YYYY-MM-DD
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

/**
 * よく使う同意の名目。自由入力もできるので、ここは「入り口を減らす」ための候補。
 * ジムごとに増減しうるため DB の CHECK では縛っていない（`title` は 1〜100 文字のみ）。
 */
export const AGREEMENT_PRESETS = [
  "利用規約・会員規約",
  "健康状態の申告",
  "同意書（トレーニングのリスク）",
  "個人情報の取り扱い",
  "写真・SNS掲載",
] as const;

export const useMemberAgreements = (userId: string | null) => {
  const [agreements, setAgreements] = useState<MemberAgreement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgreements = useCallback(async () => {
    if (!userId) {
      setAgreements([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("member_agreements")
      .select("*")
      .eq("user_id", userId)
      .order("agreed_on", { ascending: false });
    // マイグレーション未適用の環境では静かに空扱い（画面は落とさない）
    setAgreements(error ? [] : ((data ?? []) as MemberAgreement[]));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchAgreements();
  }, [fetchAgreements]);

  const addAgreement = async (input: { userId: string; title: string; agreedOn: string; note: string | null }) => {
    const tenantId = await fetchMyTenantId();
    if (!tenantId) return { error: new Error("ジムの情報が取得できませんでした") };
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from("member_agreements").insert({
      tenant_id: tenantId,
      user_id: input.userId,
      title: input.title,
      agreed_on: input.agreedOn,
      note: input.note,
      recorded_by: user?.id ?? null,
    });
    if (error) return { error };
    await fetchAgreements();
    return { error: null };
  };

  const deleteAgreement = async (id: string) => {
    const { error } = await supabase.from("member_agreements").delete().eq("id", id);
    if (error) return { error };
    await fetchAgreements();
    return { error: null };
  };

  return { agreements, loading, refetch: fetchAgreements, addAgreement, deleteAgreement };
};
