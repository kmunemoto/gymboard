import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Pencil, Trash2, X, Check, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { loadTenantMuscleGroups } from "@/lib/tenantMuscleGroups";

// 部位（胸・背中など）の追加・改名・削除。種目管理画面の「部位を編集」から開く。
// - トレーニング部位バランス(レーダーチャート)の軸は tenant_muscle_groups を見るため、
//   ここでの変更は保存直後にお客様画面のレーダーチャートにも反映される。
// - 改名時は、その部位を使っている既存の種目(exercises.muscle_group/category)も
//   まとめて新しい名前に更新し、過去の記録が「宙に浮く」ことを防ぐ。
// - 削除時、その部位を使っている種目があれば「その他」に付け替えてから削除する
//   （種目管理の一覧から消えてしまう＝見えなくなることを防ぐ）。「その他」は
//   常設の固定区分のため、このテーブル(tenant_muscle_groups)には含めない。

interface MuscleGroupRow {
  id: string;
  name: string;
  sort_order: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 部位の追加・改名・削除が完了した後、親（種目一覧）に再取得を促す */
  onChanged: () => void;
}

const TrainerMuscleGroupManager = ({ open, onClose, onChanged }: Props) => {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<MuscleGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MuscleGroupRow | null>(null);
  const [deleteInUseCount, setDeleteInUseCount] = useState<number | null>(null);

  useEffect(() => {
    if (open) fetchGroups();
  }, [open]);

  const fetchGroups = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tenant_muscle_groups")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true });
    if (error) {
      toast.error(t("muscleGroupManage.fetchFailed"));
    } else {
      setGroups(data || []);
    }
    setLoading(false);
  };

  const refreshEverything = async () => {
    await fetchGroups();
    await loadTenantMuscleGroups(true);
    onChanged();
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error(t("muscleGroupManage.errEnterName"));
      return;
    }
    if (groups.some((g) => g.name === name)) {
      toast.error(t("muscleGroupManage.errDuplicate"));
      return;
    }
    setSaving(true);
    const { fetchMyTenantId, withTenant } = await import("@/lib/tenantHelper");
    const tenantId = await fetchMyTenantId();
    const nextOrder = groups.length > 0 ? Math.max(...groups.map((g) => g.sort_order)) + 1 : 0;
    const { error } = await supabase
      .from("tenant_muscle_groups")
      .insert(withTenant({ name, sort_order: nextOrder }, tenantId));
    setSaving(false);
    if (error) {
      toast.error(t("muscleGroupManage.addFailed"));
      return;
    }
    toast.success(t("muscleGroupManage.addedToast", { name }));
    setNewName("");
    await refreshEverything();
  };

  const startEdit = (g: MuscleGroupRow) => {
    setEditingId(g.id);
    setEditingName(g.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };

  const handleRename = async (g: MuscleGroupRow) => {
    const newVal = editingName.trim();
    if (!newVal) {
      toast.error(t("muscleGroupManage.errEnterName"));
      return;
    }
    if (newVal === g.name) {
      cancelEdit();
      return;
    }
    if (groups.some((x) => x.id !== g.id && x.name === newVal)) {
      toast.error(t("muscleGroupManage.errDuplicate"));
      return;
    }
    setSaving(true);
    const { error: gErr } = await supabase
      .from("tenant_muscle_groups")
      .update({ name: newVal })
      .eq("id", g.id);
    if (gErr) {
      toast.error(t("muscleGroupManage.updateFailed"));
      setSaving(false);
      return;
    }
    // 既存の種目をまとめて新しい名前に追従させる（RLSにより自テナント内のみ対象）。
    const { error: exErr } = await supabase
      .from("exercises")
      .update({ muscle_group: newVal, category: newVal })
      .eq("muscle_group", g.name);
    if (exErr) {
      console.error("[TrainerMuscleGroupManager] cascade rename failed:", exErr.message);
    }
    setSaving(false);
    cancelEdit();
    toast.success(t("muscleGroupManage.updatedToast"));
    await refreshEverything();
  };

  const openDeleteConfirm = async (g: MuscleGroupRow) => {
    const { count } = await supabase
      .from("exercises")
      .select("id", { count: "exact", head: true })
      .eq("muscle_group", g.name);
    setDeleteInUseCount(count ?? 0);
    setDeleteTarget(g);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    if ((deleteInUseCount ?? 0) > 0) {
      const { error: exErr } = await supabase
        .from("exercises")
        .update({ muscle_group: "その他", category: "その他" })
        .eq("muscle_group", deleteTarget.name);
      if (exErr) {
        console.error("[TrainerMuscleGroupManager] reassign before delete failed:", exErr.message);
      }
    }
    const { error } = await supabase
      .from("tenant_muscle_groups")
      .delete()
      .eq("id", deleteTarget.id);
    setSaving(false);
    if (error) {
      toast.error(t("muscleGroupManage.deleteFailed"));
      return;
    }
    toast.success(t("muscleGroupManage.deletedToast", { name: deleteTarget.name }));
    setDeleteTarget(null);
    setDeleteInUseCount(null);
    await refreshEverything();
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col">
        <div className="flex-1 bg-black/40" onClick={onClose} aria-hidden />
        <div className="bg-background rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto safe-area-bottom shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold">{t("muscleGroupManage.title")}</h2>
            <button
              onClick={onClose}
              className="p-2 -mr-2 text-muted-foreground"
              aria-label={t("muscleGroupManage.closeAria")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">{t("muscleGroupManage.desc")}</p>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <DumbbellLoader className="w-6 h-6 text-accent" />
            </div>
          ) : (
            <div className="space-y-1.5 mb-4">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
                >
                  {editingId === g.id ? (
                    <>
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="h-9 flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(g);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <button
                        onClick={() => handleRename(g)}
                        disabled={saving}
                        aria-label={t("common.save")}
                        className="p-2 text-accent"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={saving}
                        aria-label={t("common.cancel")}
                        className="p-2 text-muted-foreground"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium truncate">{g.name}</span>
                      <button
                        onClick={() => startEdit(g)}
                        aria-label={t("muscleGroupManage.editAria")}
                        className="p-2 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openDeleteConfirm(g)}
                        aria-label={t("muscleGroupManage.deleteAria")}
                        className="p-2 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {groups.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-6">
                  {t("muscleGroupManage.empty")}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("muscleGroupManage.namePlaceholder")}
              className="h-11 flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <Button onClick={handleAdd} disabled={saving} className="h-11 gap-1 shrink-0">
              {saving ? <DumbbellLoader className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {t("muscleGroupManage.addBtn")}
            </Button>
          </div>
        </div>
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          onClick={() => { setDeleteTarget(null); setDeleteInUseCount(null); }}
        >
          <div
            className="bg-background glass rounded-2xl p-5 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold mb-2">{t("muscleGroupManage.deleteTitle")}</h3>
            <p className="text-sm text-muted-foreground mb-5">
              {t("muscleGroupManage.deleteDesc", { name: deleteTarget.name })}
              {(deleteInUseCount ?? 0) > 0 && (
                <>
                  <br />
                  {t("muscleGroupManage.deleteWarnInUse", { count: deleteInUseCount })}
                </>
              )}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => { setDeleteTarget(null); setDeleteInUseCount(null); }}
                className="flex-1 h-11"
                disabled={saving}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                className="flex-1 h-11"
                disabled={saving}
              >
                {saving ? <DumbbellLoader className="w-4 h-4" /> : t("common.delete")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default TrainerMuscleGroupManager;
