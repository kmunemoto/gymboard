import { Users, Search, ChevronRight, ChevronDown, ChevronUp, Sparkles, UserCheck, Trash2, CalendarDays, Target, ArrowUpDown, EyeOff, Moon, Clock, PauseCircle, MailQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAllCustomerProfiles, ProfileWithBooking } from "@/hooks/useProfile";
import { isMilestoneOverdue } from "@/lib/milestoneGoal";
import { isDormant, daysSinceLastActivity, DEFAULT_DORMANT_DAYS } from "@/lib/dormancy";
import { MEMBER_STATUS_LABEL, isSuspended, suspensionLabel } from "@/lib/memberLifecycle";
import { getJSTNow } from "@/lib/timezone";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

interface TrainerClientListProps {
  onSelectClient: (clientId: string) => void;
}

// 顧客一覧の並び替え。ジム（トレーナー）側で選べるようにする。
// - action  : 要対応順（既定）。再予約が要る既存→棚卸し時期→通常→未予約の体験客、の順。
// - booking : 次回予約順。来店が近い順、予約なしは下にまとめる。
// - name    : 名前順（localeCompare 'ja'）。名前未設定は末尾。
//             ふりがな（profiles.name_kana）が入っていればそれで並べる＝五十音順になる。
//             未入力の人は表示名でしか並べられず、漢字はコードポイント順になる
//             （2026-08-08 に name_kana を足すまでは全員がこの状態だった）。
//             ふりがな有り／無しを分けずに1つのキーで比べるのは、混在していても
//             「入っている人だけ正しく並ぶ」ほうが、2ブロックに割れるより読みやすいため。
// - created : 登録順。状態が変わっても並びが動かない固定表示。
type SortMode = "action" | "booking" | "name" | "created";
const SORT_MODES: readonly SortMode[] = ["action", "booking", "name", "created"];
const SORT_STORAGE_KEY = "gymboard.clientListSortMode";

// 「しばらく来ていない（休眠）お客様」を一覧下部に畳むしきい値。"off"=畳まない。
type DormantThreshold = "off" | "30" | "60" | "90";
const DORMANT_THRESHOLDS: readonly DormantThreshold[] = ["off", "30", "60", "90"];
const DORMANT_STORAGE_KEY = "gymboard.clientListDormantDays";
const DEFAULT_DORMANT_THRESHOLD = String(DEFAULT_DORMANT_DAYS) as DormantThreshold;

const isUnnamed = (c: ProfileWithBooking) => !c.display_name || c.display_name === "名前未設定";

// 並び替えモードごとの比較関数を返す。再取得（realtime）で同点行がちらつかないよう、
// どのモードでも最終キーは user_id で必ず一意化する。
const makeComparator = (
  sortMode: SortMode,
  now: Date,
): ((a: ProfileWithBooking, b: ProfileWithBooking) => number) => {
  const byUserId = (a: ProfileWithBooking, b: ProfileWithBooking) => a.user_id.localeCompare(b.user_id);

  switch (sortMode) {
    case "name":
      return (a, b) => {
        const au = isUnnamed(a);
        const bu = isUnnamed(b);
        if (au !== bu) return au ? 1 : -1; // 名前未設定は末尾へ
        const key = (c: ProfileWithBooking) => c.name_kana?.trim() || c.display_name || "";
        return (
          key(a).localeCompare(key(b), "ja", { numeric: true, sensitivity: "base" }) ||
          (a.created_at || "").localeCompare(b.created_at || "") ||
          byUserId(a, b)
        );
      };

    case "created":
      return (a, b) => (a.created_at || "").localeCompare(b.created_at || "") || byUserId(a, b);

    case "booking":
      // 予約ありを上（近い順）、予約なしは下ブロック（登録順で安定化）。
      return (a, b) =>
        (a.next_booking_date ? 0 : 1) - (b.next_booking_date ? 0 : 1) ||
        (a.next_booking_date || "").localeCompare(b.next_booking_date || "") ||
        (a.created_at || "").localeCompare(b.created_at || "") ||
        byUserId(a, b);

    case "action":
    default: {
      // 先勝ち(first-match-wins)で要対応の層を割り当てる（0が最上位）。
      const rank = (c: ProfileWithBooking) => {
        const existing = c.trial_completed === true;
        if (existing && !c.next_booking_date) return 0; // 既存なのに次回予約なし＝再予約が要る（離脱リスク）
        if (existing && isMilestoneOverdue(c.milestone_goal_set_at ?? null, now)) return 1; // 棚卸し時期
        if (!c.trial_completed && !c.next_booking_date) return 3; // 未予約の体験客は最下部
        return 2; // 通常（順調な既存＋予約ありの体験）
      };
      return (a, b) =>
        rank(a) - rank(b) ||
        (a.next_booking_date || "").localeCompare(b.next_booking_date || "") ||
        (a.created_at || "").localeCompare(b.created_at || "") ||
        byUserId(a, b);
    }
  }
};

const TrainerClientList = ({ onSelectClient }: TrainerClientListProps) => {
  const { t } = useTranslation();
  const { profiles, loading, setProfiles } = useAllCustomerProfiles();
  const { plans: tenantPlans } = useTenant();
  const [search, setSearch] = useState("");
  const [genderTab, setGenderTab] = useState<"all" | "male" | "female">("all");
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    if (typeof window === "undefined") return "action";
    const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
    return SORT_MODES.includes(saved as SortMode) ? (saved as SortMode) : "action";
  });
  const [dormantThreshold, setDormantThreshold] = useState<DormantThreshold>(() => {
    if (typeof window === "undefined") return DEFAULT_DORMANT_THRESHOLD;
    const saved = window.localStorage.getItem(DORMANT_STORAGE_KEY);
    return DORMANT_THRESHOLDS.includes(saved as DormantThreshold) ? (saved as DormantThreshold) : DEFAULT_DORMANT_THRESHOLD;
  });
  const [dormantOpen, setDormantOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, sortMode);
    } catch {
      /* localStorage 非対応環境では保存をスキップ（並びは既定で動作） */
    }
  }, [sortMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DORMANT_STORAGE_KEY, dormantThreshold);
    } catch {
      /* localStorage 非対応環境では保存をスキップ */
    }
  }, [dormantThreshold]);

  // ふりがな・電話番号でも引けるようにする。漢字が読めない・思い出せないときに
  // 「たなか」や下4桁で辿れるのが実務上いちばん効く。
  const searchFiltered = profiles.filter(c =>
    (c.display_name || "").includes(search) ||
    (c.plan || "").includes(search) ||
    (c.name_kana || "").includes(search) ||
    (c.phone || "").includes(search)
  );

  // 「しばらく来ていない（休眠）」お客様をメインリストから分離する。
  // しきい値が "off" のときは分離せず全員をメイン表示（従来どおり）。
  const nowJst = getJSTNow();
  const thresholdDays = dormantThreshold === "off" ? null : Number(dormantThreshold);
  const hidden = (c: ProfileWithBooking) => thresholdDays !== null && isDormant(c, thresholdDays, nowJst);
  const activePool = thresholdDays === null ? searchFiltered : searchFiltered.filter(c => !hidden(c));
  const dormantPool = thresholdDays === null ? [] : searchFiltered.filter(hidden);

  // 性別タブのカウントは「メインに表示中」の人数に合わせる（タブ数字と行が一致するように）。
  const maleCount = activePool.filter(c => c.gender === "male").length;
  const femaleCount = activePool.filter(c => c.gender === "female").length;

  const byGender = (arr: ProfileWithBooking[]) =>
    genderTab === "all" ? arr : arr.filter(c => c.gender === genderTab);

  // メインリスト: 選択中の並び替えモードで整列（検索・性別タブで絞った後）。
  const sorted = [...byGender(activePool)].sort(makeComparator(sortMode, new Date()));
  // 休眠ドロワー: 最終来店が新しい順（最近来た人が上＝一番長く来ていない人が下）。
  const dormantSorted = [...byGender(dormantPool)].sort((a, b) => {
    const av = a.last_visit_date || "";
    const bv = b.last_visit_date || "";
    if (av !== bv) return bv.localeCompare(av);
    return a.user_id.localeCompare(b.user_id);
  });

  const formatPrice = (planName: string) => {
    const match = tenantPlans.find((p) => p.plan_name === planName);
    return match ? `¥${match.price.toLocaleString()}` : "";
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
      toast.error(t("clientList.deleteFailed"));
      setDeleting(false);
      return;
    }
    setProfiles(prev => prev.filter(p => p.user_id !== deleteTarget));
    setDeleteTarget(null);
    setDeleting(false);
    toast.success(t("clientList.deleteSuccess"));
  };

  const deleteTargetName = profiles.find(p => p.user_id === deleteTarget)?.display_name || t("clientList.deleteFallback");

  const now = new Date();

  // 顧客カード1行の描画。メインリストと休眠ドロワーで共通利用する。
  // dormantDays を渡すと「◯日来店なし」バッジを表示する。
  const renderRow = (c: ProfileWithBooking, dormantDays?: number) => {
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
            <p className="font-bold text-sm truncate">{c.display_name || t("common.nameUnset")}</p>
            <p className="text-xs text-muted-foreground truncate">{c.plan || t("clientList.noPlan")} {formatPrice(c.plan || "")}</p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {c.trial_completed ? (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 gap-0.5">
                  <UserCheck className="w-2.5 h-2.5" />
                  {t("clientList.existingClient")}
                </Badge>
              ) : (
                <Badge className="text-[10px] px-1.5 py-0 h-4 gap-0.5 bg-accent text-accent-foreground">
                  <Sparkles className="w-2.5 h-2.5" />
                  {t("clientList.trialClient")}
                </Badge>
              )}
              {nextBooking ? (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-0.5 text-primary border-primary/30">
                  <CalendarDays className="w-2.5 h-2.5" />
                  {t("clientList.nextBooking", { date: nextBooking.dateStr })}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-0.5 text-muted-foreground">
                  {t("clientList.noBooking")}
                </Badge>
              )}
              {/*
                未招待（CSV で取り込んだが、本人がまだ一度もログインしていない）。
                この人にはアプリからの通知が一切届かないので、予約や記録より先に見せる。
              */}
              {c.imported_at && !c.claimed_at && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-0.5 bg-muted text-muted-foreground border-muted-foreground/30">
                  <MailQuestion className="w-2.5 h-2.5" />
                  {c.invited_at ? t("dataImport.invitedBadge") : t("dataImport.unclaimedBadge")}
                </Badge>
              )}
              {/*
                休会中。退会（withdrawn）はそもそも一覧に載らないので、ここに出るのは休会だけ。
                他のバッジより先に置いて、予約や未記録の判断より前に目に入るようにする。
              */}
              {isSuspended(c.status) && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-0.5 bg-muted text-muted-foreground border-muted-foreground/30">
                  <PauseCircle className="w-2.5 h-2.5" />
                  {suspensionLabel(c.suspended_from, c.suspended_until)
                    ? t("member.suspendedUntilBadge", { period: suspensionLabel(c.suspended_from, c.suspended_until) })
                    : MEMBER_STATUS_LABEL.suspended}
                </Badge>
              )}
              {isMilestoneOverdue(c.milestone_goal_set_at, now) && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-0.5 bg-warning/15 text-warning border-warning/40">
                  <Target className="w-2.5 h-2.5" />
                  {t("clientList.milestoneOverdueBadge")}
                </Badge>
              )}
              {dormantDays !== undefined && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-0.5 text-muted-foreground border-muted-foreground/30">
                  <Clock className="w-2.5 h-2.5" />
                  {t("clientList.dormantBadge", { days: dormantDays })}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(c.user_id); }}
                title={t("clientList.deleteAria")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <DumbbellLoader className="w-6 h-6 text-accent" />
      </div>
    );
  }

  return (
    <div className="pb-24 md:pb-0">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <Users className="w-5 h-5 text-accent" />
          {t("clientList.title")}
        </h1>
        <span className="text-sm text-muted-foreground">{t("clientList.peopleUnit", { count: profiles.length })}</span>
      </div>

      <div className="relative mb-3 sm:mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={t("clientList.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-11"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3 sm:mb-4">
        <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
          <SelectTrigger className="h-9 w-full text-xs gap-1.5" aria-label={t("clientList.sortLabel")}>
            <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="action">{t("clientList.sortAction")}</SelectItem>
            <SelectItem value="booking">{t("clientList.sortBooking")}</SelectItem>
            <SelectItem value="name">{t("clientList.sortName")}</SelectItem>
            <SelectItem value="created">{t("clientList.sortCreated")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={dormantThreshold} onValueChange={(v) => setDormantThreshold(v as DormantThreshold)}>
          <SelectTrigger className="h-9 w-full text-xs gap-1.5" aria-label={t("clientList.dormantThresholdLabel")}>
            <EyeOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{t("clientList.dormantOff")}</SelectItem>
            <SelectItem value="30">{t("clientList.dormantDays", { count: 30 })}</SelectItem>
            <SelectItem value="60">{t("clientList.dormantDays", { count: 60 })}</SelectItem>
            <SelectItem value="90">{t("clientList.dormantDays", { count: 90 })}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={genderTab} onValueChange={(v) => setGenderTab(v as "all" | "male" | "female")} className="mb-3 sm:mb-4">
        <TabsList className="grid grid-cols-3 w-full h-9">
          {/* data-testid を付けてあるのは、E2E が**文言で判定しない**ため
              （5言語 i18n ＋ 兄弟アプリが語彙を差し替える。e2e/trainer-smoke.spec.ts の冒頭） */}
          <TabsTrigger value="all" data-testid="gender-tab-all" className="text-xs">{t("clientList.tabAll", { count: activePool.length })}</TabsTrigger>
          <TabsTrigger value="male" data-testid="gender-tab-male" className="text-xs">{t("clientList.tabMale", { count: maleCount })}</TabsTrigger>
          <TabsTrigger value="female" data-testid="gender-tab-female" className="text-xs">{t("clientList.tabFemale", { count: femaleCount })}</TabsTrigger>
        </TabsList>
      </Tabs>

      {profiles.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t("clientList.emptyTitle")}</p>
            <p className="text-xs mt-1">{t("clientList.emptyHelp")}</p>
          </CardContent>
        </Card>
      ) : sorted.length === 0 && dormantSorted.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t("clientList.visibleEmpty")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {sorted.length > 0 && (
            <div className="space-y-2">
              {sorted.map((c) => renderRow(c))}
            </div>
          )}

          {dormantSorted.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setDormantOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border bg-muted/40 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                aria-expanded={dormantOpen}
              >
                <span className="flex items-center gap-2">
                  <Moon className="w-4 h-4" />
                  {t("clientList.dormantSection", { count: dormantSorted.length })}
                </span>
                {dormantOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {dormantOpen && (
                <div className="space-y-2 mt-2">
                  {dormantSorted.map((c) => renderRow(c, daysSinceLastActivity(c, nowJst)))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clientList.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("clientList.deleteDesc", { name: deleteTargetName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCustomer} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting && <DumbbellLoader className="w-4 h-4 mr-1" />}
              {t("common.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrainerClientList;
