import { useCallback, useEffect, useState } from "react";
import { Megaphone, Plus, Pencil, Trash2, Users, User as UserIcon, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAllCustomerProfiles } from "@/hooks/useProfile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import IconPicker from "@/components/IconPicker";
import RenderIcon from "@/components/RenderIcon";

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  icon: string;
  target: string;
  published_at: string;
  created_at: string;
}

const TrainerAnnouncementManager = () => {
  const { user } = useAuth();
  const { profiles } = useAllCustomerProfiles();
  const [items, setItems] = useState<AnnouncementRow[]>([]);
  const [readCounts, setReadCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AnnouncementRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [icon, setIcon] = useState("Bell");
  const [targetMode, setTargetMode] = useState<"all" | "user">("all");
  const [targetUserId, setTargetUserId] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [publishedAt, setPublishedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data: anns } = await supabase
      .from("announcements")
      .select("*")
      .order("published_at", { ascending: false });
    const list = (anns as AnnouncementRow[] | null) ?? [];
    setItems(list);
    if (list.length > 0) {
      const ids = list.map((a) => a.id);
      const { data: reads } = await supabase
        .from("announcement_reads")
        .select("announcement_id")
        .in("announcement_id", ids);
      const counts: Record<string, number> = {};
      ((reads as { announcement_id: string }[] | null) ?? []).forEach((r) => {
        counts[r.announcement_id] = (counts[r.announcement_id] || 0) + 1;
      });
      setReadCounts(counts);
    } else {
      setReadCounts({});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const resetForm = () => {
    setTitle(""); setBody(""); setIcon("Bell");
    setTargetMode("all"); setTargetUserId("");
    setScheduleMode("now"); setPublishedAt("");
    setEditing(null);
  };

  const openCreate = () => { resetForm(); setShowForm(true); };

  const openEdit = (a: AnnouncementRow) => {
    setEditing(a);
    setTitle(a.title);
    setBody(a.body);
    setIcon(a.icon || "Bell");
    if (a.target === "all") {
      setTargetMode("all"); setTargetUserId("");
    } else {
      setTargetMode("user"); setTargetUserId(a.target);
    }
    const future = new Date(a.published_at).getTime() > Date.now();
    if (future) {
      setScheduleMode("later");
      // Format to local datetime-local value (YYYY-MM-DDTHH:mm)
      const d = new Date(a.published_at);
      const pad = (n: number) => String(n).padStart(2, "0");
      setPublishedAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      setScheduleMode("now"); setPublishedAt("");
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!title.trim() || !body.trim()) { toast.error("タイトルと本文を入力してください"); return; }
    if (targetMode === "user" && !targetUserId) { toast.error("配信対象の顧客を選択してください"); return; }
    if (scheduleMode === "later" && !publishedAt) { toast.error("配信日時を指定してください"); return; }

    setSubmitting(true);
    const payload = {
      title: title.trim(),
      body: body.trim(),
      icon,
      target: targetMode === "all" ? "all" : targetUserId,
      published_at: scheduleMode === "later" ? new Date(publishedAt).toISOString() : new Date().toISOString(),
    };

    const { error } = editing
      ? await supabase.from("announcements").update(payload).eq("id", editing.id)
      : await supabase.from("announcements").insert({ ...payload, created_by: user.id });

    setSubmitting(false);
    if (error) { toast.error("保存に失敗しました: " + error.message); return; }
    toast.success(editing ? "お知らせを更新しました" : "お知らせを配信しました");
    setShowForm(false);
    resetForm();
    fetchAll();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await supabase.from("announcements").delete().eq("id", deleteId);
    setDeleting(false);
    if (error) { toast.error("削除に失敗しました"); return; }
    toast.success("削除しました");
    setDeleteId(null);
    fetchAll();
  };

  const targetLabel = (target: string) => {
    if (target === "all") return "全員";
    const p = profiles.find((p) => p.user_id === target);
    return p?.display_name || "個別";
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
  }

  return (
    <div className="pb-24 md:pb-0">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-accent" />
          お知らせ管理
        </h1>
        <Button size="sm" onClick={openCreate} className="gap-1">
          <Plus className="w-4 h-4" /> 新規作成
        </Button>
      </div>

      {items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">お知らせはまだありません</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {items.map((a) => {
            const scheduled = new Date(a.published_at).getTime() > Date.now();
            const reads = readCounts[a.id] || 0;
            return (
              <Card key={a.id}>
                <CardContent className="p-3 flex gap-3 items-start">
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                    <RenderIcon name={a.icon} size={18} className="text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm break-all">{a.title}</p>
                      {scheduled ? (
                        <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                          <Clock className="w-3 h-3" />配信予約中
                        </span>
                      ) : (
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                          <CheckCircle2 className="w-3 h-3" />配信済み
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(a.published_at), "yyyy/M/d HH:mm", { locale: ja })}
                      <span className="mx-1.5">·</span>
                      {a.target === "all" ? <Users className="inline w-3 h-3 mr-0.5" /> : <UserIcon className="inline w-3 h-3 mr-0.5" />}
                      {targetLabel(a.target)}
                      <span className="mx-1.5">·</span>
                      既読 {reads}人
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap break-all">{a.body}</p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)} aria-label="編集">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteId(a.id)} aria-label="削除">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div
            className="bg-background rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">{editing ? "お知らせ編集" : "新規お知らせ"}</h2>

            <div className="space-y-1.5">
              <Label>タイトル</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="お知らせのタイトル" />
            </div>

            <div className="space-y-1.5">
              <Label>本文</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="本文（改行はそのまま反映されます）" />
            </div>

            <div className="space-y-1.5">
              <Label>アイコン</Label>
              <IconPicker value={icon} onChange={setIcon} />
            </div>

            <div className="space-y-1.5">
              <Label>配信対象</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={targetMode === "all" ? "default" : "outline"} onClick={() => setTargetMode("all")}>全員</Button>
                <Button type="button" size="sm" variant={targetMode === "user" ? "default" : "outline"} onClick={() => setTargetMode("user")}>個別</Button>
              </div>
              {targetMode === "user" && (
                <select
                  className="w-full mt-2 h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                >
                  <option value="">顧客を選択…</option>
                  {profiles.map((p) => (
                    <option key={p.user_id} value={p.user_id}>{p.display_name || p.user_id}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>配信日時</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={scheduleMode === "now" ? "default" : "outline"} onClick={() => setScheduleMode("now")}>今すぐ</Button>
                <Button type="button" size="sm" variant={scheduleMode === "later" ? "default" : "outline"} onClick={() => setScheduleMode("later")}>日時指定</Button>
              </div>
              {scheduleMode === "later" && (
                <Input
                  type="datetime-local"
                  className="mt-2"
                  value={publishedAt}
                  onChange={(e) => setPublishedAt(e.target.value)}
                />
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={submitting}>キャンセル</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "更新" : "配信"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>お知らせを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>この操作は取り消せません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrainerAnnouncementManager;