import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "customer" | "trainer";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRole = (userId: string) => {
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.warn("Failed to fetch role, defaulting to customer:", error.message);
        }
        setRole((data?.role as AppRole) ?? "customer");
        setLoading(false);
      });
  };

  useEffect(() => {
    // 1. Restore session from storage first
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // 2. Listen for subsequent auth changes (do NOT await inside)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        // Always keep session/user in sync so tokens stay fresh
        setSession(newSession);
        setUser((prevUser) => {
          const nextUser = newSession?.user ?? null;

          if (event === "SIGNED_OUT" || !nextUser) {
            setRole(null);
            setLoading(false);
            return nextUser;
          }

          // For TOKEN_REFRESHED / USER_UPDATED / INITIAL_SESSION on the same user,
          // do NOT toggle loading or refetch the role — this would unmount the
          // current view (e.g. when returning from another app) and reset tabs.
          const isSameUser = prevUser?.id === nextUser.id;
          if (event === "SIGNED_IN" && !isSameUser) {
            setLoading(true);
            fetchRole(nextUser.id);
          }
          return nextUser;
        });
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, role, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
