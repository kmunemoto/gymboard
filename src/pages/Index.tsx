import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import CustomerView from "@/components/customer/CustomerView";
import TrainerView from "@/components/trainer/TrainerView";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const { user, role, loading } = useAuth();
  const [tenantCheck, setTenantCheck] = useState<"checking" | "has" | "missing">("checking");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setTenantCheck("missing");
      return;
    }
    setTenantCheck("checking");
    supabase
      .from("tenant_members")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setTenantCheck(data ? "has" : "missing");
      });
  }, [user, loading]);

  if (loading || (user && tenantCheck === "checking")) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (tenantCheck === "missing") {
    return <Navigate to="/onboarding" replace />;
  }

  if (role === "trainer") {
    return <TrainerView />;
  }

  return <CustomerView />;
};

export default Index;
