import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import IconPicker from "@/components/IconPicker";
import RenderIcon from "@/components/RenderIcon";

interface EventRow {
  id: string;
  event_name: string;
  event_description: string | null;
  start_date: string;
  end_date: string;
  event_icon: string | null;
  reward_exp: number;
  reward_coins: number;
  reward_badge_key: string | null;
  badge_name: string | null;
  badge_icon: string | null;
  is_active: boolean;
}

interface TaskRow {
  id: string;
  event_id: string;
  task_name: string;
  task_icon: string | null;
  target_value: number;
  task_type: string;
  task_key: string;
  sort_order: number;
}

const TASK_TYPES = [
  { value: "session_count", label: "来店回数" },
  { value: "total_volume", label: "総挙上量(kg)" },
  { value: "muscle_groups", label: "部位ユニーク数" },
  { value: "personal_bests", label: "自己ベスト更新数" },
  { value: "missions_completed", label: "ミッション達成数" },
];

const TrainerEventManager = () => {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // New event form state
  const [form, setForm] = useState({
    event_name: "", event_description: "", start_date: "", end_date: "",
    event_icon: "PartyPopper", reward_exp: 1500, reward_coins: 150,
    reward_badge_key: "", badge_name: "", badge_icon: "Medal",
  });

  // New task per event
  const [taskForms, setTaskForms] = useState<Record<string, { task_name: string; task_icon: string; target_value: number; task_type: string; task_key: string }>>({});

  const refresh = async () => {
    setLoading(true);
    const [{ data: e }, { data: t }] = await Promise.all([
      supabase.from("season_events").select("*").order("start_date", { ascending: false }),
      supabase.from("season_event_tasks").select("*").order("sort_order"),
    ]);
    setEvents((e as any) || []);
    setTasks((t as any) || []);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const createEvent = async () => {
    if (!form.event_name || !form.start_date || !form.end_date) {
      toast.error("名前・期間は必須です");
      return;
    }
    setCreating(true);
    const { data: created, error } = await supabase.from("season_events").insert({
      event_name: form.event_name,
      event_description: form.event_description || null,
      start_date: form.start_date,
      end_date: form.end_date,
      event_icon: form.event_icon,
      reward_exp: form.reward_exp,
      reward_coins: form.reward_coins,
      reward_badge_key: form.reward_badge_key || null,
      badge_name: form.badge_name || null,
      badge_icon: form.badge_icon || null,
    }).select("id, start_date").single();
    setCreating(false);
    if (error) { toast.error("作成に失敗", { description: error.message }); return; }
    toast.success("イベントを作成しました");
    // If start date is past/today, auto-recalc to credit existing workouts
    if (created && created.start_date && new Date(created.start_date) <= new Date()) {
      const { error: rerr } = await supabase.rpc("recalculate_event_progress" as any, { p_event_id: created.id });
      if (!rerr) toast.success("過去の記録を反映しました");
    }
    setForm({ event_name: "", event_description: "", start_date: "", end_date: "", event_icon: "PartyPopper", reward_exp: 1500, reward_coins: 150, reward_badge_key: "", badge_name: "", badge_icon: "Medal" });
    refresh();
  };

  const recalcEvent = async (id: string) => {
    const { error } = await supabase.rpc("recalculate_event_progress" as any, { p_event_id: id });
    if (error) { toast.error("再集計に失敗", { description: error.message }); return; }
    toast.success("進捗を再集計しました");
    refresh();
  };

  const addTask = async (eventId: string) => {
    const f = taskForms[eventId];
    if (!f?.task_name || !f?.task_type || !f?.target_value) {
      toast.error("タスク名・タイプ・目標値は必須です"); return;
    }
    const sort = (tasks.filter((t) => t.event_id === eventId).length) + 1;
    const { error } = await supabase.from("season_event_tasks").insert({
      event_id: eventId,
      task_key: f.task_key || `task_${Date.now()}`,
      task_name: f.task_name,
      task_icon: f.task_icon || null,
      target_value: f.target_value,
      task_type: f.task_type,
      sort_order: sort,
    });
    if (error) { toast.error("追加に失敗", { description: error.message }); return; }
    setTaskForms((prev) => ({ ...prev, [eventId]: { task_name: "", task_icon: "", target_value: 0, task_type: "session_count", task_key: "" } }));
    refresh();
  };

  const deleteTask = async (id: string) => {
    if (!confirm("削除しますか？")) return;
    await supabase.from("season_event_tasks").delete().eq("id", id);
    refresh();
  };

  const deleteEvent = async (id: string) => {
    if (!confirm("イベントごと削除しますか？参加者の進捗も全て削除されます。")) return;
    await supabase.from("season_events").delete().eq("id", id);
    refresh();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">シーズンイベント管理</h1>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-bold">新規イベント作成</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>イベント名</Label><Input value={form.event_name} onChange={(e) => setForm({ ...form, event_name: e.target.value })} /></div>
            <div><Label>アイコン</Label><IconPicker value={form.event_icon} onChange={(v) => setForm({ ...form, event_icon: v })} className="w-full" /></div>
            <div><Label>開始日</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><Label>終了日</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
            <div><Label>報酬EXP</Label><Input type="number" value={form.reward_exp} onChange={(e) => setForm({ ...form, reward_exp: parseInt(e.target.value) || 0 })} /></div>
            <div><Label>報酬コイン</Label><Input type="number" value={form.reward_coins} onChange={(e) => setForm({ ...form, reward_coins: parseInt(e.target.value) || 0 })} /></div>
            <div><Label>限定バッジキー</Label><Input value={form.reward_badge_key} onChange={(e) => setForm({ ...form, reward_badge_key: e.target.value })} /></div>
            <div><Label>バッジ名</Label><Input value={form.badge_name} onChange={(e) => setForm({ ...form, badge_name: e.target.value })} /></div>
            <div><Label>バッジアイコン</Label><IconPicker value={form.badge_icon} onChange={(v) => setForm({ ...form, badge_icon: v })} className="w-full" /></div>
            <div className="md:col-span-2"><Label>説明</Label><Textarea value={form.event_description} onChange={(e) => setForm({ ...form, event_description: e.target.value })} /></div>
          </div>
          <Button onClick={createEvent} disabled={creating} className="w-full md:w-auto">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" />作成</>}
          </Button>
        </CardContent>
      </Card>

      {events.map((ev) => {
        const evTasks = tasks.filter((t) => t.event_id === ev.id);
        const tf = taskForms[ev.id] || { task_name: "", task_icon: "", target_value: 0, task_type: "session_count", task_key: "" };
        return (
          <Card key={ev.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-lg flex items-center gap-2"><RenderIcon name={ev.event_icon} size={20} />{ev.event_name}</h3>
                  <p className="text-xs text-muted-foreground">{ev.start_date} 〜 {ev.end_date}</p>
                  <p className="text-xs">報酬: {ev.reward_exp} EXP + {ev.reward_coins}コイン{ev.badge_name ? ` + 「${ev.badge_name}」` : ""}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => recalcEvent(ev.id)}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />進捗再集計
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteEvent(ev.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </div>
              </div>

              <div className="space-y-2 pl-2">
                {evTasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm py-1 border-b">
                    <span className="flex items-center gap-1.5"><RenderIcon name={t.task_icon} size={14} />{t.task_name}</span>
                    <span className="text-muted-foreground">({TASK_TYPES.find(x => x.value === t.task_type)?.label || t.task_type} / 目標 {t.target_value.toLocaleString()})</span>
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => deleteTask(t.id)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-2 border-t">
                <Input placeholder="タスク名" value={tf.task_name} onChange={(e) => setTaskForms({ ...taskForms, [ev.id]: { ...tf, task_name: e.target.value } })} />
                <IconPicker value={tf.task_icon || "Target"} onChange={(v) => setTaskForms({ ...taskForms, [ev.id]: { ...tf, task_icon: v } })} className="w-full" />
                <Input placeholder="目標値" type="number" value={tf.target_value || ""} onChange={(e) => setTaskForms({ ...taskForms, [ev.id]: { ...tf, target_value: parseInt(e.target.value) || 0 } })} />
                <Select value={tf.task_type} onValueChange={(v) => setTaskForms({ ...taskForms, [ev.id]: { ...tf, task_type: v } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={() => addTask(ev.id)}><Plus className="w-4 h-4 mr-1" />追加</Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default TrainerEventManager;