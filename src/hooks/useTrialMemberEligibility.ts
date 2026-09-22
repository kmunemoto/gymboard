import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Status = "idle" | "checking" | "allowed" | "member";

/** Only the result is public. Name patterns stay in the server's private settings. */
export function useTrialMemberEligibility(tenantId: string | null | undefined, name: string, enabled: boolean) {
  const guestName = name.trim();
  const key = JSON.stringify([tenantId, guestName]);
  const [result, setResult] = useState<{ key: string; status: Status } | null>(null);
  const rejectedKey = useRef<string | null>(null);
  const active = enabled && Boolean(tenantId && guestName);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("trial-book", {
          body: { tenant_id: tenantId, guest_name: guestName, check_only: true },
        });
        if (cancelled || rejectedKey.current === key) return;
        // This is optional early guidance. An old Edge deployment or a failed
        // precheck must not disable ordinary bookings; the final POST enforces
        // the same private rules before it writes anything.
        const status: Status = error ? "idle"
          : data?.code === "member_booking_required" ? "member"
          : data?.ok === true ? "allowed" : "idle";
        setResult({ key, status });
      } catch {
        if (!cancelled && rejectedKey.current !== key) setResult({ key, status: "idle" });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, tenantId, guestName, key]);

  // A late precheck cannot undo a rejection from the authoritative booking POST.
  const status: Status = rejectedKey.current === key ? "member"
    : !active ? "idle" : result?.key === key ? result.status : "checking";
  return {
    status,
    requireMemberBooking: () => { rejectedKey.current = key; setResult({ key, status: "member" }); },
  };
}
