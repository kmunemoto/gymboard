import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

// ルート単位でコード分割し、初期バンドルを小さく保つ。
const Index = lazy(() => import("./pages/Index.tsx"));
const Auth = lazy(() => import("./pages/Auth.tsx"));
const AuthCallback = lazy(() => import("./pages/AuthCallback.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe.tsx"));
const TrialBooking = lazy(() => import("./pages/TrialBooking.tsx"));
const Privacy = lazy(() => import("./pages/Privacy.tsx"));
const Terms = lazy(() => import("./pages/Terms.tsx"));
const Tokushoho = lazy(() => import("./pages/Tokushoho.tsx"));
const Onboarding = lazy(() => import("./pages/Onboarding.tsx"));
const JoinGym = lazy(() => import("./pages/JoinGym.tsx"));
const DeleteAccount = lazy(() => import("./pages/DeleteAccount.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center">
    <DumbbellLoader className="w-8 h-8 text-muted-foreground" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/unsubscribe" element={<Unsubscribe />} />
              <Route path="/trial" element={<TrialBooking />} />
              <Route path="/trial/:tenantId" element={<TrialBooking />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/tokushoho" element={<Tokushoho />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/join" element={<JoinGym />} />
              <Route path="/join/:code" element={<JoinGym />} />
              <Route path="/delete-account" element={<DeleteAccount />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
      <Sonner />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
