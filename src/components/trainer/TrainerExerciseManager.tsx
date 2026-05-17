import { useState, useEffect, useMemo } from "react";
import { Plus, Pencil, Trash2, Dumbbell, Loader2, Search, X, Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadMuscleGroupMap } from "@/lib/muscleGroup";

interface Exercise {
  id: string;
  name: string;
  category: string;
  muscle_group: string;
  default_weight: number | null;
  default_reps: number | null;
  default_sets: number | null;
  notes: string | null;
  sort_order: number;
}

const MUSCLE_GROUPS = ["胸", "背中", "肩", "脚", "二頭筋", "三頭筋", "腹筋", "その他"] as const;
type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

interface FormState {
  name: string;
  muscle_group: MuscleGroup;
  default_weight: string;
  default_reps: string;
  default_sets: string;
  notes: string;
}

const emptyForm: FormState = {
  name: "",
  muscle_group: "胸",
  default_weight: "",
  default_reps: "",
  default_sets: "",
  notes: "",
};

const TrainerExerciseManager = () => {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | MuscleGroup>("all");
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Exercise | null>(null);

  useEffect(() => {
    fetchExercises();
  }, []);

  const fetchExercises = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("exercises")
      .select("*")
      .order("muscle_group" as any)
      .order("sort_order" as any)
      .order("name");
    if (error) {
      toast.error("種目の取得に失敗しました");
    } else {
      setExercises((data as any) || []);
    }
    setLoading(false);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setSheetOpen(true);
  };

  const openEdit = (ex: Exercise) => {
    setEditingId(ex.id);
    setForm({
      name: ex.name,
      muscle_group: (MUSCLE_GROUPS as readonly string[]).includes(ex.muscle_group)
        ? (ex.muscle_group as MuscleGroup)
        : "その他",
      default_weight: ex.default_weight != null ? String(ex.default_weight) : "",
      default_reps: ex.default_reps != null ? String(ex.default_reps) : "",
      default_sets: ex.default_sets != null ? String(ex.default_sets) : "",
      notes: ex.notes ?? "",
    });
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error("種目名を入力してください");
      return;
    }
    const dup = exercises.find(
      (e) => e.name === name && e.id !== editingId,
    );
    if (dup) {
      toast.error("同じ名前の種目が既に存在します");
      return;
    }
    setSaving(true);
    const payload = {
      name,
      category: form.muscle_group, // keep category in sync
      muscle_group: form.muscle_group,
      default_weight: form.default_weight ? Number(form.default_weight) : null,
      default_reps: form.default_reps ? parseInt(form.default_reps, 10) : null,
      default_sets: form.default_sets ? parseInt(form.default_sets, 10) : null,
      notes: form.notes.trim() || null,
    };
    if (editingId) {
      const { error } = await supabase
        .from("exercises")
        .update(payload as any)
        .eq("id", editingId);
      if (error) {
        toast.error("更新に失敗しました");
        setSaving(false);
        return;
      }
      toast.success("種目を更新しました");
    } else {
      const { error } = await supabase.from("exercises").insert(payload as any);
      if (error) {
        toast.error("追加に失敗しました");
        setSaving(false);
        return;
      }
      toast.success(`「${name}」を追加しました`);
    }
    await fetchExercises();
    await loadMuscleGroupMap(true);
    setSaving(false);
    closeSheet();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase
      .from("exercises")
      .delete()
      .eq("id", deleteTarget.id);
    if (error) {
      toast.error("削除に失敗しました");
      return;
    }
    setExercises((prev) => prev.filter((e) => e.id !== deleteTarget.id));
    toast.success(`「${deleteTarget.name}」を削除しました`);
    setDeleteTarget(null);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exercises.filter((e) => {
      if (filter !== "all" && e.muscle_group !== filter) return false;
      if (q && !e.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [exercises, filter, search]);

  const grouped = useMemo(() => {
    const out: { group: string; items: Exercise[] }[] = [];
    for (const g of MUSCLE_GROUPS) {
      const items = filtered.filter((e) => e.muscle_group === g);
      if (items.length) out.push({ group: g, items });
    }
    return out;
  }, [filtered]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="pb-32 md:pb-0 space-y-4 slide-up">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl accent-gradient flex items-center justify-center shrink-0">
          <Dumbbell className="w-4.5 h-4.5 text-accent-foreground" />
        </div>
        <h1 className="text-lg font-bold">種目管理</h1>
        <span className="text-xs text-muted-foreground ml-1">
          （{exercises.length}種目）
        </span>
        <Button
          onClick={openAdd}
          size="sm"
          className="ml-auto gap-1 h-9"
        >
          <Plus className="w-4 h-4" />
          追加
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="種目名で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-11"
        />
      </div>

      {/* Filter pills (horizontal scroll) */}
      <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-thin">
        {(["all", ...MUSCLE_GROUPS] as const).map((g) => {
          const active = filter === g;
          return (
            <button
              key={g}
              onClick={() => setFilter(g as any)}
              className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
                active
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {g === "all" ? "すべて" : g}
            </button>
          );
        })}
      </div>

      {/* Grouped list */}
      {grouped.map(({ group, items }) => (
        <section key={group}>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 px-1">
            {group}（{items.length}）
          </h2>
          <div className="space-y-1.5">
            {items.map((ex) => (
              <Card key={ex.id} className="card-hover">
                <CardContent className="p-3 flex items-center gap-2">
                  <span className="text-[10px] font-bold bg-accent/10 text-accent rounded-full px-2 py-0.5 shrink-0">
                    {ex.muscle_group}
                  </span>
                  <button
                    onClick={() => openEdit(ex)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="text-sm font-medium truncate">{ex.name}</div>
                    {(ex.default_weight != null ||
                      ex.default_reps != null ||
                      ex.default_sets != null) && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {ex.default_weight != null && `${ex.default_weight}kg`}
                        {ex.default_reps != null && ` × ${ex.default_reps}回`}
                        {ex.default_sets != null && ` × ${ex.default_sets}set`}
                      </div>
                    )}
                  </button>
                  <button
                    onClick={() => openEdit(ex)}
                    aria-label="編集"
                    className="p-2 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(ex)}
                    aria-label="削除"
                    className="p-2 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}

      {filtered.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-12">
          該当する種目がありません
        </div>
      )}

      {/* Floating add button (mobile) */}
      <button
        onClick={openAdd}
        className="md:hidden fixed bottom-20 right-4 z-30 w-14 h-14 rounded-full accent-gradient text-accent-foreground shadow-lg flex items-center justify-center"
        aria-label="種目を追加"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Add/Edit slide-up sheet (native) */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col">
          <div
            className="flex-1 bg-black/40"
            onClick={closeSheet}
            aria-hidden
          />
          <div className="bg-background rounded-t-2xl p-5 max-h-[92vh] overflow-y-auto safe-area-bottom shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold">
                {editingId ? "種目を編集" : "種目を追加"}
              </h2>
              <button
                onClick={closeSheet}
                className="p-2 -mr-2 text-muted-foreground"
                aria-label="閉じる"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-xs">
                  種目名 <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例：ラテラルレイズ"
                  className="h-11 mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">
                  部位 <span className="text-destructive">*</span>
                </Label>
                <select
                  value={form.muscle_group}
                  onChange={(e) =>
                    setForm({ ...form, muscle_group: e.target.value as MuscleGroup })
                  }
                  className="mt-1 w-full h-11 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {MUSCLE_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">デフォルト重量</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={form.default_weight}
                    onChange={(e) =>
                      setForm({ ...form, default_weight: e.target.value })
                    }
                    placeholder="kg"
                    className="h-11 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">回数</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={form.default_reps}
                    onChange={(e) =>
                      setForm({ ...form, default_reps: e.target.value })
                    }
                    placeholder="回"
                    className="h-11 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">セット</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={form.default_sets}
                    onChange={(e) =>
                      setForm({ ...form, default_sets: e.target.value })
                    }
                    placeholder="set"
                    className="h-11 mt-1"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">メモ</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="フォームの注意点など"
                  rows={3}
                  className="mt-1"
                />
              </div>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="w-full h-12 gap-1.5"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-background rounded-2xl p-5 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold mb-2">種目を削除</h3>
            <p className="text-sm text-muted-foreground mb-5">
              「{deleteTarget.name}」を削除しますか？<br />
              過去のトレーニング記録には影響しません。
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 h-11"
              >
                キャンセル
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                className="flex-1 h-11"
              >
                削除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrainerExerciseManager;
