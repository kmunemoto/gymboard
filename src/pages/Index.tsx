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

  // 🔴 **`user` ではなく `user.id` で見る**（2026-09-24）。
  //
  //    Supabase（auth-js 2.108）は、アプリに戻るたび（画面が隠れた→見えた）に
  //    ログインを確かめ直し、有効なら**毎回 SIGNED_IN を通知する**。そのたびに
  //    AuthContext の `user` は**同じ人の新しいオブジェクト**に差し替わる。
  //
  //    ここが `[user]` で走っていたので、戻るたびに status が "checking" に戻り、
  //    下の全画面の読み込み表示に切り替わって CustomerView / TrainerView が**丸ごと外れ**、
  //    作り直されて**必ずホームに戻っていた**。全員・毎回起きていた
  //    （宗本さん「予約画面を開いていて、他の所に飛んで帰ってきたらホームに戻る」
  //     「僕だけではなく、みんなこの現象になってます」）。
  //
  //    所属の確認は「誰か」にしか依存しない。同じ人なら確かめ直さない。
  const userId = user?.id ?? null;
  useEffect(() => {
    if (loading) return;
    if (!userId) {
      setStatus("checking");
      return;
    }
    let cancelled = false;
    setStatus("checking");
    (async () => {
      const { data: member } = await supabase
        .from("tenant_members")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (member) {
        setStatus("has");
        return;
      }
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "trainer")
        .maybeSingle();
      if (cancelled) return;
      setStatus(roleRow ? "missing-trainer" : "missing-customer");
    })();
    // 別の人に切り替わったら、前の人の問い合わせの結果で上書きしない
    return () => { cancelled = true; };
  }, [userId, loading]);

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
