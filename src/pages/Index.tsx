import { useAuth } from "@/contexts/AuthContext";
import CustomerView from "@/components/customer/CustomerView";
import TrainerView from "@/components/trainer/TrainerView";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (role === "trainer") {
    return <TrainerView />;
  }

  return <CustomerView />;
};

export default Index;
