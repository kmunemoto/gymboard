import { Suspense, lazy, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

// お客様用とジム用は、どちらか一方しか使わない。静的に import していると
// お客様がジムの管理画面一式（予定表・顧客管理・設定など）まで、
// ジム側がお客様の画面一式まで丸ごとダウンロードすることになるため、
// ログイン後の役割が決まってから必要な方だけ読み込む。
const CustomerView = lazy(() => import("@/components/customer/CustomerView"));
const TrainerView = lazy(() => import("@/components/trainer/TrainerView"));

type Status = "checking" | "has" | "missing-trainer" | "missing-customer";

const Index = () => {
  const { user, role, loading } = useAuth();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setStatus("checking");
      return;
    }
    setStatus("checking");
    (async () => {
      const { data: member } = await supabase
        .from("tenant_members")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (member) {
        setStatus("has");
        return;
      }
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "trainer")
        .maybeSingle();
      setStatus(roleRow ? "missing-trainer" : "missing-customer");
    })();
  }, [user, loading]);

  const fullScreenLoader = (
    <div className="min-h-screen flex items-center justify-center">
      <DumbbellLoader className="w-16 h-16 text-accent" />
    </div>
  );

  if (loading || (user && status === "checking")) {
    return fullScreenLoader;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (status === "missing-trainer") {
    return <Navigate to="/onboarding" replace />;
  }
  if (status === "missing-customer") {
    return <Navigate to="/join" replace />;
  }

  // 読み込み中の見た目は、上の判定中と同じローダーに揃える（画面がちらつかない）
  return (
    <Suspense fallback={fullScreenLoader}>
      {role === "trainer" ? <TrainerView /> : <CustomerView />}
    </Suspense>
  );
};

export default Index;
