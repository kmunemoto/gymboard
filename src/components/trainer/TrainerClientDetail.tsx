import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MONTHLY_REPORT_ENABLED } from "@/lib/featureFlags";
import { ArrowLeft, Save, Dumbbell, Weight, Activity, Plus, Trash2, CalendarDays, CreditCard, MessageSquare, CheckCircle2, X, Utensils, Flame, Beef, Droplets, Wheat, Leaf, Pencil, Clock, RotateCcw, Send, AlertCircle, CalendarIcon, Target } from "lucide-react";
import { exerciseCategories } from "@/lib/dummyData";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTenant } from "@/hooks/useTenant";
import { fetchMyTenantId } from "@/lib/tenantHelper";
import { useMeasurements } from "@/hooks/useMeasurements";
import { useMessages } from "@/hooks/useMessages";
import { Switch } from "@/components/ui/switch";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { format, addMonths, differenceInDays, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { getJSTNow, getJSTToday, formatJST } from "@/lib/timezone";
import { evaluateAndAwardMissions } from "@/lib/missionRewards";
import { applyRaidDamage, checkTrainingMilestones, computeSessionVolume, processSessionRewards, type MilestoneAchieved, type SessionRewardResult } from "@/lib/raidUtils";
import { updateEventProgress } from "@/hooks/useSeasonEvents";
import { getComboMultiplier } from "@/lib/comboSystem";
import DiagnosisHistorySection from "@/components/customer/posture/DiagnosisHistorySection";
import TrainerMonthlyComment from "./TrainerMonthlyComment";
import MuscleBalanceRadar from "@/components/customer/MuscleBalanceRadar";

import SessionExpSummaryDialog from "@/components/customer/SessionExpSummaryDialog";
import MilestoneAchievedDialog from "@/components/customer/MilestoneAchievedDialog";
import TrainerWeightJourneyPanel from "./TrainerWeightJourneyPanel";
import { getMuscleIconUrl } from "@/lib/muscleMapIcon";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

interface TrainerClientDetailProps {
  clientId: string;
  onBack: () => void;
}

interface SetEntry {
  weight: string;
  reps: string;
}

interface ExerciseEntry {
  exerciseId: string;
  name: string;
  sets: SetEntry[];
}

interface ExerciseMaster {
  id: string;
  name: string;
  category: string;
}

interface WorkoutRecord {
  id: string;
  workout_date: string;
  exercise_id: string;
  weight: number | null;
  reps: number | null;
  sets: { set: number; weight: number; reps: number }[] | null;
  exercise_name?: string;
  notes?: string | null;
}

interface MealRecord {
  id: string;
  image_url: string;
  resolved_image_url?: string;
  meal_type: string;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  fiber: number | null;
  feedback: string | null;
  analyzed: boolean;
  created_at: string;
}

const TrainingGrowthChart = ({ workoutRecords, loadingRecords }: { workoutRecords: WorkoutRecord[]; loadingRecords: boolean }) => {
  const { t } = useTranslation();
  const exerciseNames = useMemo(() => {
    const names = new Set<string>();
    workoutRecords.forEach((w) => { if (w.exercise_name) names.add(w.exercise_name); });
    return Array.from(names).sort();
  }, [workoutRecords]);

  const [selectedExercise, setSelectedExercise] = useState("");

  useEffect(() => {
    if (exerciseNames.length > 0 && !selectedExercise) {
      setSelectedExercise(exerciseNames[0]);
    }
  }, [exerciseNames, selectedExercise]);

  const chartData = useMemo(() => {
    const points: { date: string; weight: number; reps: number }[] = [];
    [...workoutRecords].reverse().forEach((w) => {
      if (w.exercise_name === selectedExercise) {
        const setsData = w.sets || (w.weight != null ? [{ set: 1, weight: w.weight!, reps: w.reps! }] : []);
        if (setsData.length === 0) return;
        const best = setsData.reduce((a, b) => (b.weight > a.weight ? b : a), setsData[0]);
        if (best.weight == null || best.reps == null) return;
        const d = new Date(w.workout_date);
        points.push({ date: `${d.getMonth() + 1}/${d.getDate()}`, weight: best.weight, reps: best.reps });
      }
    });
    return points;
  }, [selectedExercise, workoutRecords]);

  if (loadingRecords) return null;
  if (workoutRecords.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <TrendingUp className="w-3.5 h-3.5" />
        {t("clientDetail.growthChart")}
      </h2>
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <Select value={selectedExercise} onValueChange={setSelectedExercise}>
            <SelectTrigger className="w-full h-11 text-sm font-medium">
              <SelectValue placeholder={t("clientDetail.selectExercise")} />
            </SelectTrigger>
            <SelectContent>
              {exerciseNames.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {chartData.length > 1 ? (
            <div className="h-44 sm:h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
                  <YAxis yAxisId="w" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} unit="kg" domain={["dataMin - 5", "dataMax + 5"]} width={42} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} unit={t("exercise.repsUnit")} width={38} />
                  <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", fontSize: "11px" }} />
                  <Line yAxisId="w" type="monotone" dataKey="weight" stroke="hsl(174, 65%, 50%)" strokeWidth={2.5} isAnimationActive={false} dot={{ r: 4, fill: "hsl(174, 65%, 50%)", strokeWidth: 2, stroke: "hsl(var(--background))" }} activeDot={{ r: 6 }} name={t("clientDetail.weight")} />
                  <Line yAxisId="r" type="monotone" dataKey="reps" stroke="hsl(210, 40%, 58%)" strokeWidth={2} strokeDasharray="5 5" isAnimationActive={false} dot={{ r: 3, fill: "hsl(210, 40%, 58%)", strokeWidth: 2, stroke: "hsl(var(--background))" }} name={t("clientDetail.reps")} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-28 flex items-center justify-center text-sm text-muted-foreground">
              {chartData.length === 0 ? t("clientDetail.noExerciseRecord") : t("clientDetail.needTwoPoints")}
            </div>
          )}

          {chartData.length > 0 && (
            <div className="flex justify-center gap-6 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 rounded bg-[hsl(174,65%,50%)]" />
                {t("clientDetail.weight")}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 rounded" style={{ borderTop: "2px dashed hsl(210,40%,58%)", height: 0 }} />
                {t("clientDetail.reps")}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};

const TrainerClientDetail = ({ clientId, onBack }: TrainerClientDetailProps) => {
  const { t } = useTranslation();
  const { plans: tenantPlans } = useTenant();
  const [profile, setProfile] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);
  const [showUsagePeriod, setShowUsagePeriod] = useState(true);
  const [clientPlan, setClientPlan] = useState<string>('');
  const [bodyWeight, setBodyWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [savingMeasurement, setSavingMeasurement] = useState(false);
  const [measurementDate, setMeasurementDate] = useState<Date>(getJSTNow());
  const { measurements, chartData: measurementChartData, saveMeasurement, deleteMeasurement, latest: latestMeasurement, loading: loadingMeasurements } = useMeasurements(clientId);
  const [deleteMeasurementTarget, setDeleteMeasurementTarget] = useState<string | null>(null);
  const [trainingDate, setTrainingDate] = useState(getJSTToday());
  const [exercises, setExercises] = useState<ExerciseEntry[]>([{ exerciseId: "", name: "", sets: [{ weight: "", reps: "" }] }]);
  const [memo, setMemo] = useState("");
  const [exerciseMasters, setExerciseMasters] = useState<ExerciseMaster[]>([]);
  const [showNewExercise, setShowNewExercise] = useState<number | null>(null);
  const [newExName, setNewExName] = useState("");
  const [workoutRecords, setWorkoutRecords] = useState<WorkoutRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sessionResult, setSessionResult] = useState<SessionRewardResult | null>(null);
  const [showSessionSummary, setShowSessionSummary] = useState(false);
  const [milestoneQueue, setMilestoneQueue] = useState<MilestoneAchieved[]>([]);
  const [clientMeals, setClientMeals] = useState<MealRecord[]>([]);
  const [loadingMeals, setLoadingMeals] = useState(true);
  const [clientBookings2, setClientBookings2] = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingRecordIds, setEditingRecordIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<WorkoutRecord | null>(null);
  const [cycleStartDate, setCycleStartDate] = useState<string>("");
  const [trainingGoal, setTrainingGoal] = useState<string>("");
  const [editingGoal, setEditingGoal] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState<string>("");
  const [chatInput, setChatInput] = useState("");
  const [clientGender, setClientGender] = useState<"male" | "female" | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Check if client has an auth account (user_roles entry)
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const { messages: chatMessages, loading: loadingChat, sendMessage, markAsRead } = useMessages(isRegistered ? clientId : null);

  // Fetch profile and check registration
  useEffect(() => {
    const fetchProfile = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", clientId)
        .maybeSingle();
      if (data) {
        setProfile(data);
        setHasProfile(true);
        // Resolve current plan: prefer tenant_members.plan_id mapping, fallback to profiles.plan
        const { data: mem } = await supabase
          .from("tenant_members")
          .select("plan_id, tenant_plans:plan_id(plan_name)")
          .eq("user_id", clientId)
          .maybeSingle();
        const linkedName = (mem as any)?.tenant_plans?.plan_name as string | undefined;
        setClientPlan(linkedName || data.plan || '');
        setCycleStartDate(data.cycle_start_date || "");
        setTrainingGoal((data as any).training_goal || "");
        setShowUsagePeriod(data.show_usage_period ?? true);
      } else {
        setHasProfile(false);
      }
      // Check if this user has a role (meaning they have an auth account)
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("user_id", clientId)
        .limit(1);
      setIsRegistered(!!(roles && roles.length > 0));
      setLoadingProfile(false);
    };
    fetchProfile();
  }, [clientId]);

  // Fetch user_avatars gender
  useEffect(() => {
    const fetchGender = async () => {
      const { data } = await supabase
        .from("user_avatars")
        .select("gender")
        .eq("user_id", clientId)
        .maybeSingle();
      setClientGender(((data as any)?.gender as "male" | "female" | null) ?? null);
    };
    fetchGender();
  }, [clientId]);

  // Fetch exercises master
  useEffect(() => {
    const fetchExercises = async () => {
      const { data } = await supabase
        .from("exercises")
        .select("*")
        .order("category")
        .order("name");
      if (data) setExerciseMasters(data);
    };
    fetchExercises();
  }, []);

  // Fetch workout records
  useEffect(() => {
    const fetchRecords = async () => {
      const { data } = await supabase
        .from("workouts")
        .select("*, exercises(name, muscle_group)")
        .eq("user_id", clientId)
        .order("workout_date", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(50);
      if (data) {
        setWorkoutRecords(data.map((w: any) => ({
          ...w,
          exercise_name: w.exercises?.name || t("common.unknown"),
          muscle_group: w.exercises?.muscle_group ?? null,
        })));
      }
      setLoadingRecords(false);
    };
    fetchRecords();
  }, [clientId]);

  // Fetch client meals
  useEffect(() => {
    const fetchMeals = async () => {
      const { data } = await supabase
        .from("meals")
        .select("*")
        .eq("user_id", clientId)
        .order("created_at", { ascending: false });
      if (data) {
        const { resolveMealPhotoUrls } = await import("@/lib/mealPhotoUrl");
        const resolved = await resolveMealPhotoUrls(data as MealRecord[]);
        setClientMeals(resolved);
      }
      setLoadingMeals(false);
    };
    fetchMeals();
  }, [clientId]);

  // Fetch client bookings from DB
  useEffect(() => {
    const fetchBookings = async () => {
      const { data } = await supabase
        .from("bookings")
        .select("*")
        .eq("user_id", clientId)
        .order("booking_date", { ascending: true });
      if (data) {
        setClientBookings2(data.map((row) => {
          const dt = new Date(row.booking_date);
          const h = dt.getHours();
          const m = dt.getMinutes();
          const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          const endMin = h * 60 + m + 60;
          const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
          return {
            id: row.id,
            date: row.booking_date,
            startTime,
            endTime,
            status: row.status,
            booking_type: row.booking_type,
          };
        }));
      }
      setLoadingBookings(false);
    };
    fetchBookings();
  }, [clientId]);

  // Mark chat as read when viewing
  useEffect(() => {
    if (isRegistered && chatMessages.length > 0) {
      markAsRead();
    }
  }, [chatMessages.length, isRegistered]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

  if (loadingProfile) {
    return (
      <div className="flex items-center justify-center py-20">
        <DumbbellLoader className="w-6 h-6 text-accent" />
      </div>
    );
  }

  const displayName = profile?.display_name || t("common.nameUnset");
  const initial = displayName[0];

  const getPrice = (planName: string): number => {
    const match = tenantPlans.find((p) => p.plan_name === planName);
    return match?.price ?? 0;
  };

  const bookings = clientBookings2;

  const handleSendChat = async () => {
    if (!chatInput.trim() || !isRegistered) return;
    await sendMessage(chatInput.trim(), clientId);
    setChatInput("");
  };

  const addExercise = () => setExercises([...exercises, { exerciseId: "", name: "", sets: [{ weight: "", reps: "" }] }]);
  const updateExerciseSet = (exIdx: number, setIdx: number, field: keyof SetEntry, value: string) => {
    const updated = [...exercises];
    const updatedSets = [...updated[exIdx].sets];
    updatedSets[setIdx] = { ...updatedSets[setIdx], [field]: value };
    updated[exIdx] = { ...updated[exIdx], sets: updatedSets };
    setExercises(updated);
  };
  const addSet = (exIdx: number) => {
    const updated = [...exercises];
    updated[exIdx] = { ...updated[exIdx], sets: [...updated[exIdx].sets, { weight: "", reps: "" }] };
    setExercises(updated);
  };
  const removeSet = (exIdx: number, setIdx: number) => {
    const updated = [...exercises];
    if (updated[exIdx].sets.length <= 1) return;
    updated[exIdx] = { ...updated[exIdx], sets: updated[exIdx].sets.filter((_, i) => i !== setIdx) };
    setExercises(updated);
  };
  const removeExercise = (i: number) => {
    if (exercises.length <= 1) return;
    setExercises(exercises.filter((_, idx) => idx !== i));
  };

  const handleSelectExercise = (i: number, exerciseId: string) => {
    if (exerciseId === "__new__") {
      setShowNewExercise(i);
      setNewExName("");
      return;
    }
    const master = exerciseMasters.find(e => e.id === exerciseId);
    if (master) {
      const updated = [...exercises];
      const m: any = master;
      const dw = m.default_weight;
      const dr = m.default_reps;
      const ds = m.default_sets;
      let sets = updated[i].sets;
      // Autofill defaults only if user hasn't entered anything yet
      const isEmpty = sets.length === 1 && !sets[0].weight && !sets[0].reps;
      if (isEmpty && (dw != null || dr != null || ds != null)) {
        const setCount = Math.max(1, Number(ds) || 1);
        sets = Array.from({ length: setCount }, () => ({
          weight: dw != null ? String(dw) : "",
          reps: dr != null ? String(dr) : "",
        }));
      }
      updated[i] = { ...updated[i], exerciseId: master.id, name: master.name, sets };
      setExercises(updated);
    }
  };

  const handleAddNewExercise = async (i: number) => {
    if (!newExName.trim()) return;
    const { data, error } = await supabase
      .from("exercises")
      .insert({ name: newExName.trim(), category: t("clientDetail.categoryOther") })
      .select()
      .single();
    if (error) {
      toast.error(t("clientDetail.addExerciseFailed"));
      return;
    }
    setExerciseMasters(prev => [...prev, data]);
    const updated = [...exercises];
    updated[i] = { ...updated[i], exerciseId: data.id, name: data.name };
    setExercises(updated);
    setShowNewExercise(null);
    setNewExName("");
    toast.success(t("clientDetail.addedToMaster", { name: data.name }));
  };

  const handleSave = async () => {
    const validEntries = exercises.filter(ex => ex.exerciseId && ex.sets.some(s => s.weight && s.reps));
    if (validEntries.length === 0) {
      toast.error(t("clientDetail.errFillAll"));
      return;
    }
    setSaving(true);

    const { fetchMyTenantId } = await import("@/lib/tenantHelper");
    const tenantId = await fetchMyTenantId();
    if (!tenantId) { toast.error(t("clientDetail.errNoTenant")); setSaving(false); return; }

    const rows = validEntries.map(ex => ({
      user_id: clientId,
      exercise_id: ex.exerciseId,
      tenant_id: tenantId,
      weight: parseFloat(ex.sets[0].weight) || null,
      reps: parseInt(ex.sets[0].reps, 10) || null,
      sets: ex.sets.filter(s => s.weight && s.reps).map((s, i) => ({
        set: i + 1,
        weight: parseFloat(s.weight),
        reps: parseInt(s.reps, 10),
      })),
      workout_date: trainingDate,
      notes: memo.trim() || null,
    }));

    if (editingDate) {
      // Edit mode: delete old records, insert new ones
      const { error: delErr } = await supabase.from("workouts").delete().in("id", editingRecordIds);
      if (delErr) { toast.error(t("clientDetail.errUpdate")); setSaving(false); return; }
      const { data, error } = await supabase.from("workouts").insert(rows as any).select("*, exercises(name)");
      if (error) { toast.error(t("clientDetail.errUpdate")); setSaving(false); return; }
      const newRecords = (data || []).map((w: any) => ({ ...w, exercise_name: w.exercises?.name || t("common.unknown") }));
      setWorkoutRecords(prev => [...newRecords, ...prev.filter(r => !editingRecordIds.includes(r.id))]);
      setEditingDate(null);
      setEditingRecordIds([]);
      toast.success(t("clientDetail.updatedToast"));
    } else {
      // New mode: insert
      const { data, error } = await supabase.from("workouts").insert(rows as any).select("*, exercises(name)");
      if (error) { toast.error(t("clientDetail.errSave")); setSaving(false); return; }
      const newRecords = (data || []).map((w: any) => ({ ...w, exercise_name: w.exercises?.name || t("common.unknown") }));
      setWorkoutRecords(prev => [...newRecords, ...prev]);
      toast.success(t("clientDetail.savedToast"), { description: t("clientDetail.savedDesc", { name: displayName }) });
    }

    // Evaluate today's missions for this customer (fire-and-forget UI feedback via toast)
    try {
      const result = await evaluateAndAwardMissions(clientId, trainingDate);
      for (const m of result.newlyCompleted) {
        toast.success(t("clientDetail.missionAchieved", { name: m.name }), { description: t("clientDetail.missionExp", { exp: m.exp }) });
      }
      if (result.bonusAwarded) {
        toast.success(t("clientDetail.missionAllComplete"), { description: t("clientDetail.missionBonus") });
      }
    } catch (e) {
      // non-fatal
    }

    // Process session rewards (session exp + combo bonus + level recompute)
    try {
      const sess = await processSessionRewards(clientId, trainingDate);
      if (sess) {
        setSessionResult(sess);
        setShowSessionSummary(true);
      }
    } catch (e) {
      // non-fatal
    }

    // Check milestones (cumulative session count rewards)
    try {
      const mr = await checkTrainingMilestones(clientId);
      if (mr && mr.achieved && mr.achieved.length > 0) {
        setMilestoneQueue(mr.achieved);
      }
    } catch (e) {
      // non-fatal
    }

    // Apply raid damage (volume from this entire session = all today's records for this user)
    try {
      const { data: todayWs } = await supabase
        .from("workouts")
        .select("sets, weight, reps")
        .eq("user_id", clientId)
        .eq("workout_date", trainingDate);
      const vol = computeSessionVolume((todayWs || []) as any);
      if (vol > 0) {
        const r = await applyRaidDamage(clientId, trainingDate, vol);
        if (r?.defeated) {
          toast.success(t("clientDetail.raidDefeated"), { description: t("clientDetail.raidDefeatedDesc") });
        }
      }
    } catch (e) {
      // non-fatal
    }

    // Update season event progress
    try {
      const ev = await updateEventProgress(clientId);
      for (const c of (ev?.completed_events || [])) {
        toast.success(t("clientDetail.eventComplete", { name: c.event_name }), {
          description: t("clientDetail.eventRewardDesc", { exp: c.reward_exp, coins: c.reward_coins, badge: c.badge_name ? t("clientDetail.eventBadgeSuffix", { badge: c.badge_name }) : "" }),
        });
      }
    } catch (e) {
      // non-fatal
    }

    setTrainingDate(getJSTToday());
    setExercises([{ exerciseId: "", name: "", sets: [{ weight: "", reps: "" }] }]);
    setMemo("");
    setSaving(false);
  };

  const handlePlanChange = async (planName: string) => {
    const selected = tenantPlans.find((p) => p.plan_name === planName);
    if (selected) {
      const tenantId = await fetchMyTenantId();
      if (tenantId) {
        await supabase
          .from("tenant_members")
          .update({ plan_id: selected.id })
          .eq("tenant_id", tenantId)
          .eq("user_id", clientId);
      }
    }
    const { error } = await supabase.from("profiles").update({ plan: planName }).eq("user_id", clientId);
    if (error) { toast.error(t("clientDetail.planChangeFailed")); return; }
    setClientPlan(planName);
    toast.success(t("clientDetail.planChangedToast", { name: displayName, plan: planName }));
  };

  const handleSaveGoal = async () => {
    const trimmed = goalDraft.trim();
    setSavingGoal(true);
    const { error } = await supabase
      .from("profiles")
      .update({ training_goal: trimmed || null } as any)
      .eq("user_id", clientId);
    setSavingGoal(false);
    if (error) { toast.error(t("clientDetail.goalSaveFailed")); return; }
    setTrainingGoal(trimmed);
    setEditingGoal(false);
    toast.success(t("clientDetail.goalSavedToast"));
  };



  const handleCycleStartDateChange = async (newDate: string) => {
    const { error } = await supabase.from("profiles").update({ cycle_start_date: newDate || null }).eq("user_id", clientId);
    if (error) { toast.error(t("clientDetail.cycleUpdateFailed")); return; }
    setCycleStartDate(newDate);
    toast.success(t("clientDetail.cycleUpdatedToast"));
  };

  const handleResetCycleToToday = async () => {
    const today = getJSTToday();
    await handleCycleStartDateChange(today);
  };

  const handleShowUsagePeriodToggle = async (checked: boolean) => {
    const { error } = await supabase.from("profiles").update({ show_usage_period: checked }).eq("user_id", clientId);
    if (error) { toast.error(t("clientDetail.updateFailed")); return; }
    setShowUsagePeriod(checked);
    toast.success(checked ? t("clientDetail.shownToast") : t("clientDetail.hiddenToast"));
  };

  const handleGenderChange = async (g: "male" | "female") => {
    // Ensure avatar row exists, then update
    const { data: existing } = await supabase
      .from("user_avatars")
      .select("user_id")
      .eq("user_id", clientId)
      .maybeSingle();
    if (!existing) {
      const { error: insErr } = await (supabase as any)
        .from("user_avatars")
        .insert({ user_id: clientId, gender: g });
      if (insErr) { toast.error(t("clientDetail.genderUpdateFailed")); return; }
    } else {
      const { error } = await (supabase as any)
        .from("user_avatars")
        .update({ gender: g })
        .eq("user_id", clientId);
      if (error) { toast.error(t("clientDetail.genderUpdateFailed")); return; }
    }
    setClientGender(g);
    toast.success(g === "male" ? t("clientDetail.genderMaleToast") : t("clientDetail.genderFemaleToast"));
  };

  const openEdit = (dateKey: string) => {
    const records = groupedRecords[dateKey] || [];
    if (records.length === 0) return;
    setEditingDate(dateKey);
    setEditingRecordIds(records.map(r => r.id));
    setTrainingDate(dateKey);
    setExercises(records.map(r => {
      const setsData = r.sets || (r.weight != null ? [{ set: 1, weight: r.weight!, reps: r.reps! }] : [{ set: 1, weight: 0, reps: 0 }]);
      return {
        exerciseId: r.exercise_id,
        name: r.exercise_name || "",
        sets: setsData.map((s: any) => ({ weight: String(s.weight ?? ""), reps: String(s.reps ?? "") })),
      };
    }));
    const existingMemo = records.find(r => r.notes && r.notes.trim())?.notes || "";
    setMemo(existingMemo);
    // Scroll to top of form
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingDate(null);
    setEditingRecordIds([]);
    setTrainingDate(getJSTToday());
    setExercises([{ exerciseId: "", name: "", sets: [{ weight: "", reps: "" }] }]);
    setMemo("");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("workouts").delete().eq("id", deleteTarget.id);
    if (error) { toast.error(t("clientDetail.errDelete")); return; }
    setWorkoutRecords(prev => prev.filter(r => r.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast.success(t("clientDetail.deletedToast"));
  };


  const groupedRecords = workoutRecords.reduce((acc, r) => {
    const dateKey = r.workout_date;
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(r);
    return acc;
  }, {} as Record<string, WorkoutRecord[]>);

  const sortedDates = Object.keys(groupedRecords).sort((a, b) => b.localeCompare(a));

  return (
    <div className="pb-24 md:pb-0 max-w-full overflow-x-hidden">
      {/* Header */}
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4 min-h-[44px]">
        <ArrowLeft className="w-4 h-4" />
        {t("clientDetail.backToList")}
      </button>

      <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl gym-gradient flex items-center justify-center text-primary-foreground font-bold text-base sm:text-lg shrink-0">
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold truncate">{displayName}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">{clientPlan}</p>
        </div>
      </div>

      {/* Training Goal */}
      <section className="mb-4 sm:mb-6">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5" />
          {t("clientDetail.sectionGoal")}
        </h2>
        {editingGoal ? (
          <Card>
            <CardContent className="p-3 sm:p-4 space-y-2">
              <Textarea
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                placeholder={t("clientDetail.goalPlaceholder")}
                rows={4}
                className="text-sm resize-none break-all"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setEditingGoal(false); setGoalDraft(trainingGoal); }} disabled={savingGoal} className="h-8 text-xs">
                  {t("common.cancelShort")}
                </Button>
                <Button size="sm" onClick={handleSaveGoal} disabled={savingGoal} className="h-8 text-xs gap-1">
                  <Save className="w-3 h-3" />
                  {savingGoal ? t("common.saving") : t("common.save")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : trainingGoal ? (
          <button
            type="button"
            onClick={() => { setGoalDraft(trainingGoal); setEditingGoal(true); }}
            className="w-full text-left"
          >
            <Card className="bg-primary/5 border-primary/30 hover:bg-primary/10 transition-colors">
              <CardContent className="p-3 sm:p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                  <Target className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium whitespace-pre-wrap break-all leading-relaxed">{trainingGoal}</p>
                  <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                    <Pencil className="w-3 h-3" />
                    {t("clientDetail.goalTapEdit")}
                  </p>
                </div>
              </CardContent>
            </Card>
          </button>
        ) : (
          <Card className="border-dashed">
            <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{t("clientDetail.goalEmpty")}</span>
              <Button size="sm" variant="outline" onClick={() => { setGoalDraft(""); setEditingGoal(true); }} className="h-8 text-xs gap-1 shrink-0">
                <Plus className="w-3 h-3" />
                {t("clientDetail.goalSetBtn")}
              </Button>
            </CardContent>
          </Card>
        )}
      </section>



      {/* Plan */}
      <section className="mb-4 sm:mb-6">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <CreditCard className="w-3.5 h-3.5" />
          {t("clientDetail.sectionPlan")}
        </h2>
        <Card>
          <CardContent className="p-3 sm:p-4 space-y-3 sm:space-y-4">
            {tenantPlans.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">
                {t("clientDetail.noPlans")}
              </div>
            ) : (
              <div>
                <select
                  value={clientPlan}
                  onChange={(e) => handlePlanChange(e.target.value)}
                  className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  {!tenantPlans.some((p) => p.plan_name === clientPlan) && (
                    <option value="" disabled>{t("clientDetail.planSelectPrompt")}</option>
                  )}
                  {tenantPlans.map((p) => (
                    <option key={p.id} value={p.plan_name}>{p.plan_name}</option>
                  ))}
                </select>
                <p className="text-sm font-bold mt-2">{t("clientDetail.monthlyPrice", { price: getPrice(clientPlan).toLocaleString() })}</p>
              </div>
            )}

            {/* Cycle Start Date */}
            <div className="pt-2 border-t border-border space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t("clientDetail.cycleStart")}</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={cycleStartDate}
                  onChange={(e) => handleCycleStartDateChange(e.target.value)}
                  className="flex-1 h-9 text-sm"
                />
                <Button variant="outline" size="sm" onClick={handleResetCycleToToday} className="shrink-0 h-9 text-xs gap-1">
                  <RotateCcw className="w-3 h-3" />
                  {t("clientDetail.resetToToday")}
                </Button>
              </div>
              {cycleStartDate && (
                <p className="text-xs text-muted-foreground">
                  {t("clientDetail.expiry", { date: format(addMonths(parseISO(cycleStartDate), 1), "yyyy年M月d日", { locale: ja }) })}
                  {(() => {
                    const remaining = differenceInDays(addMonths(parseISO(cycleStartDate), 1), getJSTNow());
                    if (remaining < 0) return <span className="text-destructive font-bold ml-1">{t("clientDetail.expired")}</span>;
                    if (remaining <= 3) return <span className="text-warning font-bold ml-1">{t("clientDetail.daysLeft", { count: remaining })}</span>;
                    return <span className="ml-1">{t("clientDetail.daysLeft", { count: remaining })}</span>;
                  })()}
                </p>
              )}
            </div>

            {/* Show Usage Period Toggle */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t("clientDetail.showUsagePeriod")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${showUsagePeriod ? 'text-success' : 'text-muted-foreground'}`}>
                  {showUsagePeriod ? t("clientDetail.shown") : t("clientDetail.hidden")}
                </span>
                <Switch checked={showUsagePeriod} onCheckedChange={handleShowUsagePeriodToggle} />
              </div>
            </div>

            {/* Gender Setting */}
            <div className="pt-2 border-t border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("clientDetail.gender")}</span>
                {!clientGender && (
                  <span className="text-xs text-muted-foreground">{t("clientDetail.genderUnset")}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleGenderChange("male")}
                  className={cn(
                    "h-10 rounded-md border text-sm font-medium transition-colors",
                    clientGender === "male"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-input bg-background text-foreground hover:bg-muted"
                  )}
                >
                  {t("common.male")}
                </button>
                <button
                  type="button"
                  onClick={() => handleGenderChange("female")}
                  className={cn(
                    "h-10 rounded-md border text-sm font-medium transition-colors",
                    clientGender === "female"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-input bg-background text-foreground hover:bg-muted"
                  )}
                >
                  {t("common.female")}
                </button>
              </div>
            </div>

            {/* Diet goal (weight journey) */}
            <TrainerWeightJourneyPanel clientId={clientId} />
          </CardContent>
        </Card>
      </section>

      {/* Tabbed sections */}
      <Tabs defaultValue="training" className="space-y-4">
        <TabsList className="grid grid-cols-7 w-full">
          <TabsTrigger value="overview" className="text-[10px] sm:text-xs px-1">{t("clientDetail.tabOverview")}</TabsTrigger>
          <TabsTrigger value="training" className="text-[10px] sm:text-xs px-1">{t("clientDetail.tabTraining")}</TabsTrigger>
          <TabsTrigger value="meals" className="text-[10px] sm:text-xs px-1">{t("clientDetail.tabMeals")}</TabsTrigger>
          <TabsTrigger value="bookings" className="text-[10px] sm:text-xs px-1">{t("clientDetail.tabBookings")}</TabsTrigger>
          <TabsTrigger value="skeletal" className="text-[10px] sm:text-xs px-1">{t("clientDetail.tabSkeletal")}</TabsTrigger>
          {MONTHLY_REPORT_ENABLED && (
            <TabsTrigger value="report" className="text-[10px] sm:text-xs px-1">{t("clientDetail.tabReport")}</TabsTrigger>
          )}
          <TabsTrigger value="chat" className="text-[10px] sm:text-xs px-1">{t("clientDetail.tabChat")}</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4 sm:space-y-6">
          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              {t("clientDetail.weightChart")}
            </h2>
             <Card>
              <CardContent className="p-3 sm:p-4">
                {measurementChartData.length > 0 ? (
                  <div className="h-40 sm:h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={measurementChartData}>
                        <defs>
                          <linearGradient id={`wg-${clientId}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(174, 65%, 50%)" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="hsl(174, 65%, 50%)" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id={`fg-${clientId}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(210, 40%, 58%)" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="hsl(210, 40%, 58%)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(30, 10%, 92%)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(220, 6%, 55%)" axisLine={false} tickLine={false} />
                        <YAxis yAxisId="w" tick={{ fontSize: 10 }} stroke="hsl(220, 6%, 55%)" axisLine={false} tickLine={false} domain={['dataMin - 2', 'dataMax + 2']} unit="kg" width={38} />
                        <YAxis yAxisId="f" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(220, 6%, 55%)" axisLine={false} tickLine={false} domain={['dataMin - 2', 'dataMax + 2']} unit="%" width={38} />
                        <Tooltip contentStyle={{ background: 'hsl(0,0%,100%)', border: 'none', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: '11px' }} />
                        <Area yAxisId="w" type="monotone" dataKey="weight" stroke="hsl(174, 65%, 50%)" fill={`url(#wg-${clientId})`} strokeWidth={2} name={t("clientDetail.weightSeries")} />
                        <Area yAxisId="f" type="monotone" dataKey="bodyFat" stroke="hsl(210, 40%, 58%)" fill={`url(#fg-${clientId})`} strokeWidth={2} name={t("clientDetail.fatSeries")} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">{t("clientDetail.noData")}</p>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Training Growth Chart */}
          <TrainingGrowthChart workoutRecords={workoutRecords} loadingRecords={loadingRecords} />

          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Weight className="w-3.5 h-3.5" />
              {t("clientDetail.measurementInput")}
            </h2>
            <Card>
              <CardContent className="p-3 sm:p-4 space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("clientDetail.measureDate")}</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full h-11 justify-start text-left font-normal", !measurementDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {measurementDate ? format(measurementDate, "yyyy年M月d日", { locale: ja }) : t("clientDetail.selectDate")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={measurementDate}
                        onSelect={(d) => d && setMeasurementDate(d)}
                        disabled={(date) => date > getJSTNow()}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("clientDetail.weightKg")}</label>
                    <Input type="number" step="0.1" placeholder={latestMeasurement?.weight?.toString() || "73.5"} value={bodyWeight} onChange={(e) => setBodyWeight(e.target.value)} className="h-11" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("clientDetail.bodyFatPct")}</label>
                    <Input type="number" step="0.1" placeholder={latestMeasurement?.body_fat?.toString() || "18.0"} value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} className="h-11" />
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={savingMeasurement || (!bodyWeight && !bodyFat)}
                  onClick={async () => {
                    setSavingMeasurement(true);
                    const dateStr = format(measurementDate, "yyyy-MM-dd");
                    const w = bodyWeight ? parseFloat(bodyWeight) : null;
                    const f = bodyFat ? parseFloat(bodyFat) : null;
                    const ok = await saveMeasurement(dateStr, w, f);
                    if (ok) { setBodyWeight(""); setBodyFat(""); setMeasurementDate(getJSTNow()); }
                    setSavingMeasurement(false);
                  }}
                >
                  {savingMeasurement ? <DumbbellLoader className="w-4 h-4 mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                  {t("clientDetail.saveMeasurement")}
                </Button>
              </CardContent>
            </Card>
          </section>

          {/* Measurement History */}
          {measurements.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                {t("clientDetail.measurementList")}
              </h2>
              <Card>
                <CardContent className="p-3 sm:p-4">
                  <div className="space-y-1">
                    {[...measurements].reverse().map((m) => {
                      const d = new Date(m.measured_date);
                      return (
                        <div key={m.id} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-sm font-medium whitespace-nowrap">
                              {format(d, "M/d (E)", { locale: ja })}
                            </span>
                            <div className="flex gap-3 text-xs text-muted-foreground">
                              {m.weight != null && <span>{m.weight} kg</span>}
                              {m.body_fat != null && <span>{m.body_fat}%</span>}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => setDeleteMeasurementTarget(m.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Delete Measurement Confirmation */}
          <AlertDialog open={!!deleteMeasurementTarget} onOpenChange={(open) => !open && setDeleteMeasurementTarget(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("clientDetail.deleteRecordTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("clientDetail.deleteMeasureDesc")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={async () => {
                    if (deleteMeasurementTarget) {
                      await deleteMeasurement(deleteMeasurementTarget);
                      setDeleteMeasurementTarget(null);
                    }
                  }}
                >
                  {t("common.deleteAction")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>


          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Dumbbell className="w-3.5 h-3.5" />
              {t("clientDetail.recentTraining")}
            </h2>
            {loadingRecords ? (
              <div className="flex justify-center py-8"><DumbbellLoader className="w-5 h-5 text-accent" /></div>
            ) : sortedDates.length > 0 ? (
              <div className="space-y-2">
                {sortedDates.slice(0, 3).map((date) => (
                  <Card key={date}>
                    <CardContent className="p-3">
                      <p className="text-xs font-bold text-muted-foreground mb-1">
                        {formatJST(date, "M月d日（E）", { locale: ja })}
                      </p>
                      <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        {groupedRecords[date].map((r) => {
                          const setsData = r.sets || (r.weight != null ? [{ set: 1, weight: r.weight, reps: r.reps }] : []);
                          const totalVolume = setsData.reduce((sum: number, s: any) => sum + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0);
                          return (
                            <span key={r.id} className="text-xs bg-muted rounded-lg px-2 py-1 break-all">
                              {r.exercise_name} {setsData.map((s: any) => `${s.weight}kg×${s.reps}`).join(", ")}
                              {totalVolume > 0 && (
                                <span className="ml-1.5 text-muted-foreground/70">{t("clientDetail.totalVolume", { volume: totalVolume })}</span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card><CardContent className="p-4 text-sm text-muted-foreground text-center">{t("clientDetail.noRecord")}</CardContent></Card>
            )}
          </section>
        </TabsContent>

        {/* Training input */}
        <TabsContent value="training" className="space-y-4">
          {/* Muscle Balance Radar */}
          <MuscleBalanceRadar userId={clientId} cycleStartDate={cycleStartDate || null} />

          <Card>
            <CardContent className="p-3 sm:p-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" /> {t("clientDetail.dateLabel")}
                </label>
                <Input type="date" value={trainingDate} onChange={(e) => setTrainingDate(e.target.value)} className="w-full sm:w-48 h-11" />
              </div>

              <div className="space-y-3">
                {exercises.map((ex, i) => (
                  <div key={i} className="rounded-xl border border-border p-3 bg-muted/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground">{t("clientDetail.exerciseNum", { n: i + 1 })}</span>
                      {exercises.length > 1 && (
                        <button onClick={() => removeExercise(i)} className="text-destructive hover:text-destructive/80 transition-colors p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <select
                      value={ex.exerciseId || ""}
                      onChange={(e) => handleSelectExercise(i, e.target.value)}
                      className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="" disabled>{t("clientDetail.selectExercisePrompt")}</option>
                      {(() => {
                        const cats = Array.from(
                          new Set(
                            exerciseMasters.map(
                              (e: any) => e.muscle_group || e.category || t("clientDetail.categoryOther"),
                            ),
                          ),
                        );
                        return cats.map((cat) => {
                          const catExercises = exerciseMasters.filter(
                            (e: any) => (e.muscle_group || e.category) === cat,
                          );
                          if (catExercises.length === 0) return null;
                          return (
                            <optgroup key={cat} label={cat}>
                              {catExercises.map((e) => (
                                <option key={e.id} value={e.id}>{e.name}</option>
                              ))}
                            </optgroup>
                          );
                        });
                      })()}
                      <option value="__new__">{t("clientDetail.addNewExercise")}</option>
                    </select>
                    {showNewExercise === i && (
                      <div className="flex gap-2">
                        <Input
                          placeholder={t("clientDetail.newExercisePh")}
                          value={newExName}
                          onChange={(e) => setNewExName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddNewExercise(i); }}
                          className="flex-1 h-11"
                          autoFocus
                        />
                        <Button size="sm" variant="outline" className="h-11" onClick={() => handleAddNewExercise(i)}>
                          {t("common.confirm")}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-11" onClick={() => setShowNewExercise(null)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                    {ex.sets.map((s, si) => (
                      <div key={si} className="space-y-1">
                        {ex.sets.length > 1 && (
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-muted-foreground">{t("clientDetail.setNum", { n: si + 1 })}</span>
                            <button onClick={() => removeSet(i, si)} className="text-destructive/60 hover:text-destructive transition-colors p-0.5">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground mb-0.5 block">{t("clientDetail.weightUnit")}</label>
                            <Input type="number" step="0.5" placeholder="60" value={s.weight} onChange={(e) => updateExerciseSet(i, si, "weight", e.target.value)} className="h-11" />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground mb-0.5 block">{t("clientDetail.repsUnit")}</label>
                            <Input type="number" placeholder="10" value={s.reps} onChange={(e) => updateExerciseSet(i, si, "reps", e.target.value)} className="h-11" />
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addSet(i)}
                      className="w-full text-xs text-accent font-medium py-1.5 rounded-lg border border-dashed border-accent/40 hover:bg-accent/5 transition-colors flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> {t("clientDetail.addSet")}
                    </button>
                  </div>
                ))}
              </div>

              <Button variant="outline" size="sm" onClick={addExercise} className="w-full gap-1.5 h-11">
                <Plus className="w-3.5 h-3.5" />
                {t("clientDetail.addExercise")}
              </Button>

              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("clientDetail.memo")}</label>
                <Textarea placeholder={t("clientDetail.memoPh")} value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
              </div>
            </CardContent>
          </Card>

           <div className="flex justify-end gap-2">
            {editingDate && (
              <Button variant="outline" size="lg" onClick={cancelEdit} className="gap-2 w-full sm:w-auto">
                <X className="w-4 h-4" />
                {t("clientDetail.cancelEdit")}
              </Button>
            )}
            <Button variant="accent" size="lg" onClick={handleSave} disabled={saving} className="gap-2 w-full sm:w-auto">
              {saving ? <DumbbellLoader className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {editingDate ? t("clientDetail.saveChanges") : t("clientDetail.saveRecord")}
            </Button>
          </div>

          {editingDate && (
            <div className="rounded-lg bg-accent/10 border border-accent/30 px-4 py-2 text-sm text-accent font-medium flex items-center gap-2">
              <Pencil className="w-4 h-4" />
              {t("clientDetail.editMode", { date: formatJST(editingDate, "yyyy年M月d日（E）", { locale: ja }) })}
            </div>
          )}

          {/* Past records from DB */}
          {loadingRecords ? (
            <div className="flex justify-center py-8"><DumbbellLoader className="w-5 h-5 text-accent" /></div>
          ) : sortedDates.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">{t("clientDetail.pastRecords")}</h2>
              <div className="space-y-2">
                {sortedDates.map((date) => (
                  <Card key={date}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-bold text-muted-foreground">
                          {formatJST(date, "yyyy年M月d日（E）", { locale: ja })}
                        </p>
                        <button onClick={() => openEdit(date)} className="p-1.5 rounded-lg hover:bg-muted transition-colors flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" title={t("clientDetail.editAria")}>
                          <Pencil className="w-3.5 h-3.5" />
                          <span>{t("common.edit")}</span>
                        </button>
                      </div>
                      <div className="space-y-1.5 overflow-hidden">
                        {groupedRecords[date].map((r) => {
                          const setsData = r.sets || (r.weight != null ? [{ set: 1, weight: r.weight, reps: r.reps }] : []);
                          const muscleIconUrl = getMuscleIconUrl(r.exercise_name, clientGender ?? "male", (r as any).muscle_group ?? null);
                          return (
                          <div key={r.id} className="flex items-start gap-2 text-sm min-w-0">
                            <Dumbbell className="w-3 h-3 text-accent shrink-0 mt-1" />
                            <span className="font-medium break-all min-w-0">{r.exercise_name}</span>
                            <span className="text-muted-foreground whitespace-nowrap shrink-0">
                              {setsData.map((s: any, si: number) => (
                                <span key={si}>{si > 0 && " / "}{s.weight}kg×{s.reps}</span>
                              ))}
                            </span>
                            {muscleIconUrl && (
                              <img
                                src={muscleIconUrl}
                                alt=""
                                loading="lazy"
                                className="w-24 h-24 object-contain opacity-60 shrink-0 ml-2"
                              />
                            )}
                            <button onClick={() => setDeleteTarget(r)} className="ml-auto p-1.5 rounded-lg hover:bg-destructive/10 transition-colors shrink-0" title={t("common.delete")}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive/70" />
                            </button>
                          </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </TabsContent>

        {/* Meals */}
        <TabsContent value="meals" className="space-y-4">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Utensils className="w-3.5 h-3.5" />
            {t("clientDetail.mealsSection")}
          </h2>
          {loadingMeals ? (
            <div className="flex justify-center py-8"><DumbbellLoader className="w-5 h-5 text-accent" /></div>
          ) : clientMeals.length > 0 ? (
            <div className="space-y-3">
              {clientMeals.map((meal) => (
                <Card key={meal.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    <div className="relative">
                      <img src={meal.resolved_image_url || meal.image_url} alt={t("clientDetail.mealPhotoAlt")} className="w-full h-40 object-cover" />
                      <div className="absolute top-2 left-2 bg-foreground/70 text-primary-foreground px-2 py-0.5 rounded-lg text-xs font-bold backdrop-blur-sm">
                        {meal.meal_type}
                      </div>
                      <div className="absolute top-2 right-2 bg-foreground/70 text-primary-foreground px-2 py-0.5 rounded-lg text-xs backdrop-blur-sm">
                        {new Date(meal.created_at).toLocaleDateString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })}
                      </div>
                    </div>
                    {meal.analyzed ? (
                      <div className="p-3 space-y-2">
                        <div className="grid grid-cols-5 gap-1 text-center">
                          <div><Flame className="w-3.5 h-3.5 mx-auto text-destructive" /><p className="text-[10px] text-muted-foreground">カロリー</p><p className="text-xs font-bold">{meal.calories ?? 0}</p></div>
                          <div><Beef className="w-3.5 h-3.5 mx-auto text-accent" /><p className="text-[10px] text-muted-foreground">タンパク質</p><p className="text-xs font-bold">{meal.protein ?? 0}g</p></div>
                          <div><Droplets className="w-3.5 h-3.5 mx-auto text-warning" /><p className="text-[10px] text-muted-foreground">脂質</p><p className="text-xs font-bold">{meal.fat ?? 0}g</p></div>
                          <div><Wheat className="w-3.5 h-3.5 mx-auto text-info" /><p className="text-[10px] text-muted-foreground">炭水化物</p><p className="text-xs font-bold">{meal.carbs ?? 0}g</p></div>
                          <div><Leaf className="w-3.5 h-3.5 mx-auto text-success" /><p className="text-[10px] text-muted-foreground">食物繊維</p><p className="text-xs font-bold">{meal.fiber ?? 0}g</p></div>
                        </div>
                        {meal.feedback && (
                          <div className="bg-accent/10 rounded-lg p-2">
                            <p className="text-[10px] font-bold text-accent mb-0.5">AIアドバイス</p>
                            <p className="text-xs text-foreground leading-relaxed">{meal.feedback}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 flex items-center gap-2 text-muted-foreground">
                        <DumbbellLoader className="w-4 h-4" />
                        <span className="text-xs">AI分析中...</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card><CardContent className="p-4 text-sm text-muted-foreground text-center">食事記録なし</CardContent></Card>
          )}
        </TabsContent>

        {/* Bookings */}
        <TabsContent value="bookings">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" />
            予約一覧
          </h2>
          {loadingBookings ? (
            <div className="flex justify-center py-8"><DumbbellLoader className="w-5 h-5 text-accent" /></div>
          ) : bookings.length > 0 ? (
            <div className="space-y-2">
              {bookings.map((b: any) => (
                <Card key={b.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl accent-gradient flex items-center justify-center shrink-0">
                      <CalendarDays className="w-4 h-4 text-accent-foreground" />
                    </div>
                    <div>
                      <p className="font-bold text-sm">
                        {formatJST(b.date, "M月d日（E）", { locale: ja })}
                      </p>
                      <p className="text-xs text-muted-foreground">{b.startTime}〜{b.endTime}</p>
                      {b.booking_type && (
                        <span className="text-[10px] text-muted-foreground">{b.booking_type}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card><CardContent className="p-4 text-sm text-muted-foreground text-center">予約なし</CardContent></Card>
          )}
        </TabsContent>

        {/* Skeletal Diagnosis History */}
        <TabsContent value="skeletal">
          <DiagnosisHistorySection userId={clientId} allowDelete />
        </TabsContent>

        {/* Monthly Report */}
        <TabsContent value="report">
          <TrainerMonthlyComment clientId={clientId} />
        </TabsContent>

        {/* Chat */}
        <TabsContent value="chat">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            チャット
          </h2>
          {!isRegistered ? (
            <Card>
              <CardContent className="p-6 text-center space-y-2">
                <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">この顧客はまだアプリに登録していないため、チャット機能は利用できません。</p>
              </CardContent>
            </Card>
          ) : loadingChat ? (
            <div className="flex justify-center py-8"><DumbbellLoader className="w-5 h-5 text-accent" /></div>
          ) : (
            <div className="space-y-3">
              <Card>
                <CardContent className="p-3 max-h-[400px] overflow-y-auto">
                  {chatMessages.length > 0 ? (
                    <div className="space-y-2">
                      {chatMessages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.sender_id !== clientId ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                            msg.sender_id !== clientId
                              ? 'accent-gradient text-accent-foreground rounded-br-md'
                              : 'bg-muted text-foreground rounded-bl-md'
                          }`}>
                            <p>{msg.content}</p>
                            <p className="text-[10px] opacity-60 mt-1">
                              {new Date(msg.created_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })}
                            </p>
                          </div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">メッセージなし</p>
                  )}
                </CardContent>
              </Card>
              <div className="flex items-end gap-2">
                <textarea
                  placeholder="メッセージを入力..."
                  value={chatInput}
                  onChange={(e) => {
                    setChatInput(e.target.value);
                    const el = e.target;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={(e) => {
                    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
                    if (e.key === "Enter" && !e.shiftKey && !isMobile && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  rows={1}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none overflow-y-auto"
                  style={{ maxHeight: 120 }}
                />
                <Button onClick={handleSendChat} disabled={!chatInput.trim()} className="h-10 w-10 p-0 shrink-0">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>この記録を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (() => {
                const s = deleteTarget.sets || (deleteTarget.weight != null ? [{ set: 1, weight: deleteTarget.weight, reps: deleteTarget.reps }] : []);
                return `${deleteTarget.exercise_name} ${s.map((x: any) => `${x.weight}kg×${x.reps}`).join(", ")} の記録を削除します。この操作は取り消せません。`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">削除する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SessionExpSummaryDialog
        open={showSessionSummary}
        result={sessionResult}
        onClose={() => setShowSessionSummary(false)}
      />
      {milestoneQueue.length > 0 && (
        <MilestoneAchievedDialog
          milestones={milestoneQueue}
          onClose={() => setMilestoneQueue([])}
        />
      )}
    </div>
  );
};

export default TrainerClientDetail;
