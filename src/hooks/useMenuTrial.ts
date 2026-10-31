import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseMenuTrial, type MenuTrialInfo } from "@/lib/menuTrial";

/**
 * メニューの体験予約ページ（`/trial/:tenantId/menu/:menuId`・2026-10-31）のメニュー・シフト・案内。
 * 未ログインで開くので RPC（`get_menu_trial_public`）で読む（booking_menus は anon に開けていない）。
 *
 * - `none`        … menuId が無い（ふつうの体験予約ページ）。何も読まない
 * - `loading`     … 読み込み中。🔴 この間にトレーニングの体験の枠・案内を出さない（ページ側で待つ）
 * - `ready`       … 受け付けている
 * - `unavailable` … 受け付けていない（オフ・体験オフ・担当なし）・URL のジムと違うメニュー・読めない
 *
 * src/lib/menuTrial.ts
 */
export type MenuTrialStatus = "none" | "loading" | "ready" | "unavailable";

export const useMenuTrial = (menuId: string | undefined, tenantId: string | undefined) => {
  const [menu, setMenu] = useState<MenuTrialInfo | null>(null);
  const [status, setStatus] = useState<MenuTrialStatus>(menuId ? "loading" : "none");

  const reload = useCallback(async () => {
    if (!menuId) {
      setMenu(null);
      setStatus("none");
      return;
    }
    const { data, error } = await supabase.rpc("get_menu_trial_public", { p_menu_id: menuId });
    if (error) console.error("Failed to load menu trial:", error);
    const parsed = error ? null : parseMenuTrial(Array.isArray(data) ? data[0] : data);
    // URL のジムと違うメニューは出さない（あるジムのページに別のジムの枠を出さない）
    const ok = parsed && (!tenantId || parsed.tenantId === tenantId) ? parsed : null;
    setMenu(ok);
    setStatus(ok ? "ready" : "unavailable");
  }, [menuId, tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { menu, status, reload };
};
