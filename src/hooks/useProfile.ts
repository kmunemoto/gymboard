import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SAME_DAY_FORFEIT_STATUS } from "@/hooks/useBookings";

export interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  plan: string | null;
  paid_this_month: boolean;
  trial_completed: boolean;
  line_user_id: string | null;
  cycle_start_date: string | null;
  show_usage_period: boolean;
  calendar_token: string | null;
  best_streak: number;
  last_streak_notified: number;
  game_mode_enabled: boolean;
  training_goal: string | null;
  milestone_goal?: string | null;
  milestone_goal_set_at?: string | null;
  /** プランの猶予（大目に見る）をこのお客様に適用するか。null/true=適用（既定）、false=適用しない */
  grace_enabled: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileWithBooking extends Profile {
  next_booking_date: string | null;
  next_booking_type: string | null;
  /** 最終来店日（過去の非キャンセル予約のうち最新のもの）。来店実績が無ければ null。 */
  last_visit_date: string | null;
  gender: "male" | "female" | null;
}

const PROFILE_UPDATED_EVENT = "profile-updated";

export const useProfile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = () => setRefreshKey((k) => k + 1);

  const updateDisplayName = async (nextDisplayName: string) => {
    const { default: i18n } = await import("@/lib/i18n");
    if (!user) {
      return { error: new Error(i18n.t("hooks.loginInfoNotFound")) };
    }

    const trimmedName = nextDisplayName.trim();
    if (!trimmedName) {
      return { error: new Error(i18n.t("hooks.enterName")) };
    }

    const { data: updatedRow, error: updateError } = await supabase
      .from("profiles")
      .update({ display_name: trimmedName })
      .eq("user_id", user.id)
      .select("*")
      .maybeSingle();

    if (updateError) {
      return { error: updateError };
    }

    const nextProfile = updatedRow
      ? (updatedRow as Profile)
      : await (async () => {
          const { data: insertedRow, error: insertError } = await supabase
            .from("profiles")
            .insert({
              user_id: user.id,
              display_name: trimmedName,
            })
            .select("*")
            .single();

          if (insertError) {
            throw insertError;
          }

          return insertedRow as Profile;
        })().catch((error) => ({ error } as const));

    if ("error" in nextProfile) {
      return { error: nextProfile.error };
    }

    setProfile(nextProfile);
    window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: nextProfile }));
    return { data: nextProfile, error: null };
  };

  const updateGameMode = async (enabled: boolean) => {
    if (!user) {
      const { default: i18n } = await import("@/lib/i18n");
      return { error: new Error(i18n.t("hooks.loginInfoNotFound")) };
    }
    const { error } = await supabase
      .from("profiles")
      .update({ game_mode_enabled: enabled } as any)
      .eq("user_id", user.id);
    if (error) return { error };
    setProfile((p) => (p ? { ...p, game_mode_enabled: enabled } : p));
    refetch();
    return { error: null };
  };

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchProfile = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!cancelled) {
        if (!error) {
          setProfile((data as Profile) ?? null);
        }
        setLoading(false);
      }
    };

    fetchProfile();
    return () => {
      cancelled = true;
    };
  }, [user, refreshKey]);

  useEffect(() => {
    const handleProfileUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<Profile>;
      if (customEvent.detail?.user_id === user?.id) {
        setProfile(customEvent.detail);
      }
    };

    window.addEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated);
  }, [user?.id]);

  return { profile, loading, refetch, updateDisplayName, updateGameMode };
};

export const useAllCustomerProfiles = () => {
  const [profiles, setProfiles] = useState<ProfileWithBooking[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProfiles = useCallback(async () => {
    // 1. Resolve current trainer's tenant
    const { fetchMyTenantId } = await import("@/lib/tenantHelper");
    const tenantId = await fetchMyTenantId();
    if (!tenantId) {
      setProfiles([]);
      setLoading(false);
      return;
    }

    // 2. Get customers belonging to the same tenant
    const { data: members } = await supabase
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "customer")
      .eq("status", "active");

    if (!members || members.length === 0) {
      setProfiles([]);
      setLoading(false);
      return;
    }

    const customerIds = members.map((m: any) => m.user_id);

    // 3. Fetch profiles
    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .in("user_id", customerIds);

    // 4. Fetch ALL bookings for these customers (not just future)
    // 同日キャンセル消化(SAME_DAY_FORFEIT_STATUS)は実際には来店していないため、
    // 「次回予約」「最終来店日」の算出対象からは除外する（プラン消化数の算出は
    // courseProgress.ts が別途行うため、そちらは意図的に触れない）。
    const { data: allBookings } = await supabase
      .from("bookings")
      .select("user_id, booking_date, booking_type, status")
      .in("user_id", customerIds)
      .neq("status", "キャンセル済み")
      .neq("status", SAME_DAY_FORFEIT_STATUS)
      .order("booking_date", { ascending: true });

    // 4b. Fetch genders from user_avatars
    const { data: avatarRows } = await supabase
      .from("user_avatars")
      .select("user_id, gender")
      .in("user_id", customerIds);
    const genderMap: Record<string, "male" | "female" | null> = {};
    (avatarRows || []).forEach((r: any) => { genderMap[r.user_id] = r.gender ?? null; });

    // 予約マップを構築（allBookings は booking_date 昇順）:
    //  - nextBookingMap: 各ユーザーの「今後の最も近い予約」
    //  - lastVisitMap: 各ユーザーの「最終来店日（過去の非キャンセル予約の最新）」。
    //    昇順走査で過去分を上書きすると、最終値が最新の過去予約になる。
    const now = new Date();
    const nextBookingMap: Record<string, { booking_date: string; booking_type: string }> = {};
    const lastVisitMap: Record<string, string> = {};
    allBookings?.forEach((b) => {
      if (new Date(b.booking_date) > now) {
        if (!nextBookingMap[b.user_id]) {
          nextBookingMap[b.user_id] = { booking_date: b.booking_date, booking_type: b.booking_type };
        }
      } else {
        lastVisitMap[b.user_id] = b.booking_date;
      }
    });

    // Build profile map
    const profileMap = new Map<string, Profile>();
    (profileData || []).forEach((p) => profileMap.set(p.user_id, p as Profile));

    // Merge: include ALL customerIds, even those without a profile row
    const merged: ProfileWithBooking[] = customerIds.map((uid) => {
      const p = profileMap.get(uid);
      return {
        id: p?.id || uid,
        user_id: uid,
        display_name: p?.display_name || "名前未設定",
        avatar_url: p?.avatar_url || null,
        plan: p?.plan || null,
        paid_this_month: p?.paid_this_month || false,
        trial_completed: p?.trial_completed || false,
        line_user_id: p?.line_user_id || null,
        cycle_start_date: p?.cycle_start_date || null,
        show_usage_period: p?.show_usage_period ?? true,
        calendar_token: (p as any)?.calendar_token || null,
        best_streak: p?.best_streak || 0,
        last_streak_notified: p?.last_streak_notified || 0,
        game_mode_enabled: (p as any)?.game_mode_enabled ?? true,
        training_goal: (p as any)?.training_goal ?? null,
        milestone_goal: (p as any)?.milestone_goal ?? null,
        milestone_goal_set_at: (p as any)?.milestone_goal_set_at ?? null,
        grace_enabled: (p as any)?.grace_enabled ?? null,
        created_at: p?.created_at || new Date().toISOString(),
        updated_at: p?.updated_at || new Date().toISOString(),
        next_booking_date: nextBookingMap[uid]?.booking_date || null,
        next_booking_type: nextBookingMap[uid]?.booking_type || null,
        last_visit_date: lastVisitMap[uid] ?? null,
        gender: genderMap[uid] ?? null,
      };
    });

    setProfiles(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // Realtime: refetch when bookings or profiles change
  useEffect(() => {
    const channel = supabase
      .channel("customer-list-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
        fetchProfiles();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        fetchProfiles();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_avatars" }, () => {
        fetchProfiles();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchProfiles]);

  return { profiles, loading, setProfiles };
};
