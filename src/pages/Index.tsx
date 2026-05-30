import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import CustomerView from "@/components/customer/CustomerView";
import TrainerView from "@/components/trainer/TrainerView";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

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

  if (loading || (user && status === "checking")) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <DumbbellLoader className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
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

  if (role === "trainer") {
    return <TrainerView />;
  }

  return <CustomerView />;
};

export default Index;
