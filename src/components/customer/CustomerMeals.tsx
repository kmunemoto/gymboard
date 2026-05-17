import { useState, useRef, useEffect, useMemo } from "react";
import { ImagePlus, Loader2, Utensils, Flame, Beef, Droplets, Wheat, Leaf, Trash2, Pencil, ChevronDown, Sunrise, Sun, Moon, Apple, CalendarDays, Bot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { resolveMealPhotoUrls } from "@/lib/mealPhotoUrl";
import { getJSTNow, toJSTDate } from "@/lib/timezone";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface DishDetail {
  name: string;
  weight_g: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
}

interface Meal {
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
  dishes?: DishDetail[] | null;
}

const MealTypeIcon = ({ type, className }: { type: string; className?: string }) => {
  const Cmp = type === "朝食" ? Sunrise : type === "昼食" ? Sun : type === "夕食" ? Moon : type === "間食" ? Apple : Utensils;
  return <Cmp className={className || "w-3.5 h-3.5"} />;
};

const mealTypeOptions = ["朝食", "昼食", "夕食", "間食"];

const PFC_GOALS = { p: 30, f: 20, c: 50 };

const CustomerMeals = () => {
  const { user } = useAuth();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload options
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [selectedMealType, setSelectedMealType] = useState("");
  const [quantityNote, setQuantityNote] = useState("");

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Meal | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit time state
  const [editTarget, setEditTarget] = useState<Meal | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchMeals = async () => {
    const { data, error } = await supabase
      .from("meals")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) {
      const resolved = await resolveMealPhotoUrls(data as unknown as Meal[]);
      setMeals(resolved);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMeals();
  }, []);

  const convertToJpeg = (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp" || file.type === "image/gif") {
        resolve(file);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas not supported")); return; }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) { reject(new Error("Conversion failed")); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        }, "image/jpeg", 0.9);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
      img.src = url;
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    // Auto-detect meal type based on current time
    const hour = getJSTNow().getHours();
    let autoType = "";
    if (hour >= 5 && hour < 10) autoType = "朝食";
    else if (hour >= 10 && hour < 15) autoType = "昼食";
    else if (hour >= 15 && hour < 21) autoType = "夕食";
    else autoType = "間食";
    setSelectedMealType(autoType);
    setQuantityNote("");
    setPendingFile(file);
    setShowUploadDialog(true);
  };

  const handleUploadConfirm = async () => {
    if (!pendingFile) return;
    setShowUploadDialog(false);
    setUploading(true);
    try {
      const convertedFile = await convertToJpeg(pendingFile);
      const storagePath = `${user!.id}/${Date.now()}-${convertedFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("meal-photos")
        .upload(storagePath, convertedFile);
      if (uploadError) throw uploadError;

      const { data: mealData, error: insertError } = await supabase
        .from("meals")
        .insert({ image_url: storagePath, user_id: user?.id })
        .select()
        .single();
      if (insertError) throw insertError;

      const { getMealPhotoUrl } = await import("@/lib/mealPhotoUrl");
      const resolvedUrl = await getMealPhotoUrl(storagePath);
      const newMeal = { ...(mealData as unknown as Meal), resolved_image_url: resolvedUrl };
      setMeals((prev) => [newMeal, ...prev]);
      toast.success("写真をアップロードしました。AI分析中...");

      const { data: fnData, error: fnError } = await supabase.functions.invoke("analyze-meal", {
        body: {
          mealId: newMeal.id,
          imageUrl: storagePath,
          mealTypeHint: selectedMealType || undefined,
          quantityNote: quantityNote.trim() || undefined,
        },
      });

      const isFallback = fnError || fnData?.fallback || fnData?.error;

      if (isFallback) {
        console.warn("AI analysis failed, using dummy data:", fnError || fnData?.error);
        const dummyAnalysis = {
          meal_type: selectedMealType || "食事",
          calories: 500,
          protein: 20.0,
          fat: 15.0,
          carbs: 60.0,
          fiber: 5.0,
          feedback: "AI分析に一時的に接続できませんでした。ダミーデータを表示しています。",
          analyzed: true,
        };
        await supabase.from("meals").update(dummyAnalysis).eq("id", newMeal.id);
        toast.info("ダミーの分析結果を表示しています");
        fetchMeals();
      } else {
        toast.success("AI分析が完了しました！");
        fetchMeals();
      }
    } catch (err) {
      console.error(err);
      toast.error("アップロードに失敗しました");
    } finally {
      setUploading(false);
      setPendingFile(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const imgUrl = deleteTarget.image_url;
      if (!imgUrl.startsWith("http://") && !imgUrl.startsWith("https://")) {
        await supabase.storage.from("meal-photos").remove([imgUrl]);
      }
      const { error } = await supabase.from("meals").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      setMeals((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      toast.success("食事記録を削除しました");
    } catch (err) {
      console.error(err);
      toast.error("削除に失敗しました");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const openEditTime = (meal: Meal) => {
    const d = toJSTDate(meal.created_at);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    setEditDate(`${year}-${month}-${day}`);
    setEditTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setEditTarget(meal);
  };

  const handleSaveTime = async () => {
    if (!editTarget || !editDate || !editTime) return;
    setSaving(true);
    try {
      // Treat user input as JST wall-clock time
      const newDateTime = new Date(`${editDate}T${editTime}:00+09:00`);
      const { error } = await supabase
        .from("meals")
        .update({ created_at: newDateTime.toISOString() })
        .eq("id", editTarget.id);
      if (error) throw error;
      toast.success("日時を変更しました");
      fetchMeals();
    } catch (err) {
      console.error(err);
      toast.error("日時の変更に失敗しました");
    } finally {
      setSaving(false);
      setEditTarget(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = toJSTDate(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const getDateKey = (dateStr: string) => {
    const d = toJSTDate(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const formatDateLabel = (key: string) => {
    const [, m, d] = key.split("-");
    const today = getDateKey(new Date().toISOString());
    const yesterday = getDateKey(new Date(Date.now() - 86400000).toISOString());
    const label = `${parseInt(m)}月${parseInt(d)}日`;
    if (key === today) return `今日 (${label})`;
    if (key === yesterday) return `昨日 (${label})`;
    return label;
  };

  const groupedMeals = useMemo(() => {
    const groups: { dateKey: string; meals: Meal[]; totals: { calories: number; protein: number; fat: number; carbs: number }; pfc: { pPct: number; fPct: number; cPct: number } }[] = [];
    const map = new Map<string, Meal[]>();
    for (const meal of meals) {
      const key = getDateKey(meal.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(meal);
    }
    const sortedKeys = [...map.keys()].sort((a, b) => b.localeCompare(a));
    for (const dateKey of sortedKeys) {
      const dayMeals = map.get(dateKey)!;
      const totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
      for (const m of dayMeals) {
        if (m.analyzed) {
          totals.calories += m.calories ?? 0;
          totals.protein += m.protein ?? 0;
          totals.fat += m.fat ?? 0;
          totals.carbs += m.carbs ?? 0;
        }
      }
      const pKcal = totals.protein * 4;
      const fKcal = totals.fat * 9;
      const cKcal = totals.carbs * 4;
      const totalKcal = pKcal + fKcal + cKcal;
      const pfc = totalKcal > 0
        ? { pPct: Math.round((pKcal / totalKcal) * 100), fPct: Math.round((fKcal / totalKcal) * 100), cPct: Math.round((cKcal / totalKcal) * 100) }
        : { pPct: 0, fPct: 0, cPct: 0 };
      groups.push({ dateKey, meals: dayMeals, totals, pfc });
    }
    return groups;
  }, [meals]);

  return (
    <div className="px-4 py-4 space-y-5 slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Utensils className="w-5 h-5 text-accent" />
            食事管理
          </h1>
          <p className="text-sm text-muted-foreground mt-1">写真を撮るだけでAIが自動分析</p>
        </div>
        <Button
          variant="accent"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
          {uploading ? "分析中..." : "写真を追加"}
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : meals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ImagePlus className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">食事の写真を撮って記録を始めましょう</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedMeals.map(({ dateKey, meals: dayMeals, totals, pfc }) => (
            <div key={dateKey} className="space-y-3">
              <div className="text-sm font-bold text-foreground flex items-center gap-1.5"><CalendarDays className="w-4 h-4" />{formatDateLabel(dateKey)}</div>
              <Card className="border-accent/30 bg-accent/5">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-end gap-4">
                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground mb-1">合計カロリー</p>
                      <div className="flex items-baseline gap-1">
                        <Flame className="w-5 h-5 text-destructive shrink-0" />
                        <span className="text-3xl font-extrabold text-foreground">{totals.calories.toLocaleString()}</span>
                        <span className="text-sm text-muted-foreground">kcal</span>
                      </div>
                    </div>
                    <div className="flex gap-4 text-center">
                      <div>
                        <p className="text-[10px] text-muted-foreground">P</p>
                        <p className="text-sm font-bold text-accent">{totals.protein.toFixed(1)}<span className="text-[10px] text-muted-foreground ml-0.5">g</span></p>
                        <p className="text-[10px] font-semibold text-accent">{pfc.pPct}%</p>
                        <p className="text-[9px] text-muted-foreground">目標{PFC_GOALS.p}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">F</p>
                        <p className="text-sm font-bold text-warning">{totals.fat.toFixed(1)}<span className="text-[10px] text-muted-foreground ml-0.5">g</span></p>
                        <p className="text-[10px] font-semibold text-warning">{pfc.fPct}%</p>
                        <p className="text-[9px] text-muted-foreground">目標{PFC_GOALS.f}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">C</p>
                        <p className="text-sm font-bold text-info">{totals.carbs.toFixed(1)}<span className="text-[10px] text-muted-foreground ml-0.5">g</span></p>
                        <p className="text-[10px] font-semibold text-info">{pfc.cPct}%</p>
                        <p className="text-[9px] text-muted-foreground">目標{PFC_GOALS.c}%</p>
                      </div>
                    </div>
                  </div>
                  {(pfc.pPct + pfc.fPct + pfc.cPct) > 0 && (
                    <div className="space-y-1">
                      <div className="relative">
                        <div className="flex h-2.5 rounded-full overflow-hidden">
                          <div className="bg-accent transition-all" style={{ width: `${pfc.pPct}%` }} />
                          <div className="bg-warning transition-all" style={{ width: `${pfc.fPct}%` }} />
                          <div className="bg-info transition-all" style={{ width: `${pfc.cPct}%` }} />
                        </div>
                        <div className="absolute top-0 h-full w-0.5 bg-foreground/60 rounded" style={{ left: `${PFC_GOALS.p}%` }} title="P目標" />
                        <div className="absolute top-0 h-full w-0.5 bg-foreground/60 rounded" style={{ left: `${PFC_GOALS.p + PFC_GOALS.f}%` }} title="F目標" />
                      </div>
                      <div className="flex justify-between text-[9px] text-muted-foreground">
                        <span>実績バランス</span>
                        <span>▼ 目標ライン</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {dayMeals.map((meal) => (
                <Card key={meal.id} className="overflow-hidden card-hover">
                  <CardContent className="p-0">
                    <div className="relative">
                      <img
                        src={meal.resolved_image_url || meal.image_url}
                        alt="食事写真"
                        className="w-full h-48 object-cover"
                      />
                      <div className="absolute top-2 left-2 bg-foreground/70 text-primary-foreground px-2.5 py-1 rounded-lg text-xs font-bold backdrop-blur-sm flex items-center gap-1">
                        <MealTypeIcon type={meal.meal_type} className="w-3 h-3" />{meal.meal_type}
                      </div>
                      <button
                        onClick={() => openEditTime(meal)}
                        className="absolute top-2 right-12 bg-foreground/70 text-primary-foreground px-2.5 py-1 rounded-lg text-xs backdrop-blur-sm flex items-center gap-1 hover:bg-foreground/90 transition-colors"
                      >
                        {formatDate(meal.created_at)}
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(meal)}
                        className="absolute top-2 right-2 bg-destructive/80 text-destructive-foreground p-1.5 rounded-lg backdrop-blur-sm hover:bg-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {meal.analyzed ? (
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-5 gap-2">
                          <NutrientBadge icon={Flame} label="カロリー" value={`${meal.calories ?? 0}`} unit="kcal" color="text-destructive" />
                          <NutrientBadge icon={Beef} label="タンパク質" value={`${meal.protein ?? 0}`} unit="g" color="text-accent" />
                          <NutrientBadge icon={Droplets} label="脂質" value={`${meal.fat ?? 0}`} unit="g" color="text-warning" />
                          <NutrientBadge icon={Wheat} label="炭水化物" value={`${meal.carbs ?? 0}`} unit="g" color="text-info" />
                          <NutrientBadge icon={Leaf} label="食物繊維" value={`${meal.fiber ?? 0}`} unit="g" color="text-success" />
                        </div>

                        {/* Dishes breakdown accordion */}
                        {meal.dishes && Array.isArray(meal.dishes) && meal.dishes.length > 0 && (
                          <DishesBreakdown dishes={meal.dishes} />
                        )}

                        {meal.feedback && (
                          <div className="bg-accent/10 rounded-xl p-3">
                            <p className="text-xs font-bold text-accent mb-1 flex items-center gap-1"><Bot className="w-3.5 h-3.5" />AIアドバイス</p>
                            <p className="text-sm text-foreground leading-relaxed">{meal.feedback}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">AI分析中...</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Upload Options Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={(open) => { if (!open) { setShowUploadDialog(false); setPendingFile(null); } }}>
        <DialogContent className="max-w-[340px] rounded-xl">
          <DialogHeader>
            <DialogTitle>食事の情報（任意）</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>食事タイプ</Label>
              <div className="flex gap-2 flex-wrap">
                {mealTypeOptions.map((t) => (
                  <button
                    key={t}
                    onClick={() => setSelectedMealType(t)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors inline-flex items-center gap-1 ${
                      selectedMealType === t
                        ? "bg-accent text-accent-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    <MealTypeIcon type={t} className="w-3 h-3" />{t}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>量の補足（任意）</Label>
              <Input
                placeholder="例：大盛り、半分残した、2人前"
                value={quantityNote}
                onChange={(e) => setQuantityNote(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">入力するとAIの推定精度が向上します</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowUploadDialog(false); setPendingFile(null); }}>キャンセル</Button>
            <Button onClick={handleUploadConfirm} disabled={uploading}>
              分析開始
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>この食事記録を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              削除すると元に戻すことはできません。写真と分析データが完全に削除されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit DateTime Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-[340px] rounded-xl">
          <DialogHeader>
            <DialogTitle>食事の日時を変更</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>日付</Label>
              <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>時間</Label>
              <Input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>キャンセル</Button>
            <Button onClick={handleSaveTime} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const DishesBreakdown = ({ dishes }: { dishes: DishDetail[] }) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-accent font-medium hover:text-accent/80 transition-colors w-full">
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        内訳を見る（{dishes.length}品）
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-1.5">
          {dishes.map((dish, i) => (
            <div key={i} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{dish.name}</p>
                <p className="text-muted-foreground">{dish.weight_g}g</p>
              </div>
              <div className="flex gap-3 text-right shrink-0 ml-2">
                <span className="text-destructive font-semibold">{dish.calories}<span className="text-muted-foreground font-normal">kcal</span></span>
                <span className="text-accent">P{dish.protein}</span>
                <span className="text-warning">F{dish.fat}</span>
                <span className="text-info">C{dish.carbs}</span>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const NutrientBadge = ({
  icon: Icon,
  label,
  value,
  unit,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  unit: string;
  color: string;
}) => (
  <div className="text-center">
    <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
    <p className="text-xs text-muted-foreground leading-none mb-0.5">{label}</p>
    <p className="text-sm font-bold">{value}</p>
    <p className="text-[10px] text-muted-foreground">{unit}</p>
  </div>
);

export default CustomerMeals;
