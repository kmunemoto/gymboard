import { Users, Search, ChevronRight, Sparkles, UserCheck, Trash2, CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { planPrices, PlanType } from "@/lib/dummyData";
import { useAllCustomerProfiles, ProfileWithBooking } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface TrainerClientListProps {
  onSelectClient: (clientId: string) => void;
}

const TrainerClientList = ({ onSelectClient }: TrainerClientListProps) => {
  const { profiles, loading, setProfiles } = useAllCustomerProfiles();
  const [search, setSearch] = useState("");
  const [genderTab, setGenderTab] = useState<"all" | "male" | "female">("all");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const searchFiltered = profiles.filter(c =>
    (c.display_name || "").includes(search) || (c.plan || "").includes(search)
  );
  const maleCount = searchFiltered.filter(c => c.gender === "male").length;
  const femaleCount = searchFiltered.filter(c => c.gender === "female").length;
  const filtered = searchFiltered.filter(c => {
    if (genderTab === "all") return true;
    return c.gender === genderTab;
  });

  const formatPrice = (plan: string) => {
    const p = planPrices[plan as PlanType];
    return p !== undefined ? `¥${p.toLocaleString()}` : "";
  };

  const formatNextBooking = (profile: ProfileWithBooking) => {
    if (!profile.next_booking_date) return null;
    const dt = new Date(profile.next_booking_date);
    const dateStr = format(dt, "M/d(E) HH:mm", { locale: ja });
    return { dateStr, type: profile.next_booking_type || "通常" };
  };

  const handleDeleteCustomer = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.rpc("delete_customer_cascade", { _customer_id: deleteTarget });
    if (error) {
      toast.error("削除に失敗しました");
      setDeleting(false);
      return;
    }
    setProfiles(prev => prev.filter(p => p.user_id !== deleteTarget));
    setDeleteTarget(null);
    setDeleting(false);
    toast.success("顧客データを削除しました");
  };

  const deleteTargetName = profiles.find(p => p.user_id === deleteTarget)?.display_name || "この顧客";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="pb-24 md:pb-0">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <Users className="w-5 h-5 text-accent" />
          顧客一覧
        </h1>
        <span className="text-sm text-muted-foreground">{profiles.length}名</span>
      </div>

      <div className="relative mb-3 sm:mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="名前・プランで検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-11"
        />
      </div>

      <Tabs value={genderTab} onValueChange={(v) => setGenderTab(v as "all" | "male" | "female")} className="mb-3 sm:mb-4">
        <TabsList className="grid grid-cols-3 w-full h-9">
          <TabsTrigger value="all" className="text-xs">全体（{searchFiltered.length}）</TabsTrigger>
          <TabsTrigger value="male" className="text-xs">男性（{maleCount}）</TabsTrigger>
          <TabsTrigger value="female" className="text-xs">女性（{femaleCount}）</TabsTrigger>
        </TabsList>
      </Tabs>

      {profiles.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">まだ顧客が登録されていません</p>
            <p className="text-xs mt-1">顧客がアカウントを作成すると、ここに表示されます</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const initial = (c.display_name || "?")[0];
            const nextBooking = formatNextBooking(c);
            return (
              <Card
                key={c.user_id}
                className="card-hover cursor-pointer"
                onClick={() => onSelectClient(c.user_id)}
              >
                <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                  <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl gym-gradient flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0 relative">
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{c.display_name || "名前未設定"}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.plan || "未契約"} {formatPrice(c.plan || "")}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {c.trial_completed ? (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 gap-0.5">
                          <UserCheck className="w-2.5 h-2.5" />
                          既存顧客
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] px-1.5 py-0 h-4 gap-0.5 bg-accent text-accent-foreground">
                          <Sparkles className="w-2.5 h-2.5" />
                          初回体験
                        </Badge>
                      )}
                      {nextBooking ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-0.5 text-primary border-primary/30">
                          <CalendarDays className="w-2.5 h-2.5" />
                          次回 {nextBooking.dateStr}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-0.5 text-muted-foreground">
                          予約なし
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="flex items-center gap-1">
                      <button
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(c.user_id); }}
                        title="削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>顧客データの削除</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTargetName}」さんのデータを完全に削除しますか？予約・トレーニング記録・食事記録・メッセージなど、すべてのデータが消去されます。この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCustomer} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrainerClientList;
