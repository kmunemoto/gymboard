import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Sword, Trash2, Plus, Gift } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface RaidRow {
  id: string;
  boss_name: string;
  boss_hp: number;
  current_damage: number;
  start_date: string;
  end_date: string;
  defeated: boolean;
  reward_exp: number;
  reward_coins: number;
}

interface ContribRow {
  user_id: string;
  damage: number;
  display_name?: string;
  gender?: string | null;
}

const TrainerRaidManager = () => {
  const [raids, setRaids] = useState<RaidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ boss_name: "", boss_hp: 200000, start_date: "", end_date: "", reward_exp: 300, reward_coins: 30 });
  const [contribs, setContribs] = useState<Record<string, ContribRow[]>>({});
  const [distributed, setDistributed] = useState<Record<string, number>>({});
  const [distributing, setDistributing] = useState<string | null>(null);
  const [tabByRaid, setTabByRaid] = useState<Record<string, string>>({});

  const refresh = async () => {
    const { data } = await supabase
      .from("raid_bosses")
      .select("*")
      .order("start_date", { ascending: false });
    setRaids((data || []) as any);
    setLoading(false);

    const { data: dmg } = await supabase.from("raid_damage_logs").select("raid_id, user_id, damage");
    if (!dmg) return;
    const grouped: Record<string, Record<string, number>> = {};
    (dmg as any[]).forEach((r) => {
      grouped[r.raid_id] = grouped[r.raid_id] || {};
      grouped[r.raid_id][r.user_id] = (grouped[r.raid_id][r.user_id] || 0) + r.damage;
    });
    const userIds = [...new Set((dmg as any[]).map((r) => r.user_id))];
    const { data: profs } = await supabase.from("profiles").select("user_id, display_name").in("user_id", userIds);
    const { data: avs } = await (supabase as any).from("user_avatars").select("user_id, gender").in("user_id", userIds);
    const nameMap = new Map((profs || []).map((p: any) => [p.user_id, p.display_name]));
    const genderMap = new Map(((avs as any[]) || []).map((a) => [a.user_id, a.gender]));
    const final: Record<string, ContribRow[]> = {};
    Object.entries(grouped).forEach(([raidId, byUser]) => {
      final[raidId] = Object.entries(byUser)
        .map(([user_id, damage]) => ({ user_id, damage, display_name: nameMap.get(user_id) || "—", gender: genderMap.get(user_id) ?? null }))
        .sort((a, b) => b.damage - a.damage);
    });
    setContribs(final);

    const { data: rewards } = await (supabase as any)
      .from("user_raid_rewards")
      .select("raid_boss_id");
    const counts: Record<string, number> = {};
    ((rewards as any[]) || []).forEach((r) => {
      if (r.raid_boss_id) counts[r.raid_boss_id] = (counts[r.raid_boss_id] || 0) + 1;
    });
    setDistributed(counts);
  };

  useEffect(() => { refresh(); }, []);

  const handleCreate = async () => {
    if (!form.boss_name || !form.start_date || !form.end_date || !form.boss_hp) {
      toast.error("全項目を入力してください");
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("raid_bosses").insert({
      boss_name: form.boss_name,
      boss_hp: Number(form.boss_hp),
      start_date: form.start_date,
      end_date: form.end_date,
      reward_exp: Number(form.reward_exp),
      reward_coins: Number(form.reward_coins),
    });
    setCreating(false);
    if (error) { toast.error("作成に失敗しました"); return; }
    toast.success("レイドボスを作成しました");
    setForm({ boss_name: "", boss_hp: 200000, start_date: "", end_date: "", reward_exp: 300, reward_coins: 30 });
    refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("このレイドを削除しますか？")) return;
    await supabase.from("raid_bosses").delete().eq("id", id);
    toast.success("削除しました");
    refresh();
  };

  const handleDistribute = async (id: string) => {
    if (!confirm("このボスの限定報酬を全参加者に配布しますか？")) return;
    setDistributing(id);
    const { data, error } = await (supabase as any).rpc("distribute_raid_rewards", { p_raid_boss_id: id });
    setDistributing(null);
    if (error) {
      toast.error(error.message || "配布に失敗しました");
      return;
    }
    const r = data || {};
    const fmt = (arr: any[]) => (arr && arr.length > 0)
      ? arr.map((m) => `${m.display_name || "—"} (${(m.damage ?? 0).toLocaleString()}kg)`).join(", ")
      : "なし";
    toast.success(
      `配布完了\n参加者${r.participants ?? 0}人 (男${r.male_participants ?? 0}/女${r.female_participants ?? 0})\n貢献者${r.contributors ?? 0}人 / MVP${r.mvps ?? 0}人\n男性MVP: ${fmt(r.male_mvps || [])}\n女性MVP: ${fmt(r.female_mvps || [])}\nアイテム配布: ${r.items_granted ?? 0}個`,
      { duration: 10000 }
    );
    refresh();
  };

  if (loading) return <Loader2 className="w-6 h-6 animate-spin text-accent mx-auto mt-10" />;

  const renderRanking = (raidId: string, list: ContribRow[]) => {
    const males = list.filter((c) => c.gender === "male").sort((a, b) => b.damage - a.damage);
    const females = list.filter((c) => c.gender === "female").sort((a, b) => b.damage - a.damage);
    const maleMax = males[0]?.damage;
    const femaleMax = females[0]?.damage;
    const cutoff = Math.ceil(list.length / 2);

    const rowsFor = (rows: ContribRow[], variant: "all" | "male" | "female") => (
      <div className="space-y-1 max-h-56 overflow-y-auto">
        {rows.map((c, i) => {
          let badge: { label: string; cls: string } | null = null;
          if (variant === "male" && maleMax != null && c.damage === maleMax) {
            badge = { label: "MVP", cls: "bg-amber-100 text-amber-800" };
          } else if (variant === "female" && femaleMax != null && c.damage === femaleMax) {
            badge = { label: "MVP", cls: "bg-pink-100 text-pink-800" };
          } else {
            // Determine global contributor cutoff for "all" tab
            const globalIdx = list.findIndex((x) => x.user_id === c.user_id);
            const isMaleMvp = c.gender === "male" && maleMax != null && c.damage === maleMax;
            const isFemaleMvp = c.gender === "female" && femaleMax != null && c.damage === femaleMax;
            if (variant === "all" && (isMaleMvp || isFemaleMvp)) {
              badge = { label: "MVP", cls: isMaleMvp ? "bg-amber-100 text-amber-800" : "bg-pink-100 text-pink-800" };
            } else if (globalIdx < cutoff) {
              badge = { label: "貢献者", cls: "bg-emerald-100 text-emerald-800" };
            } else {
              badge = { label: "参加者", cls: "bg-slate-100 text-slate-700" };
            }
          }
          return (
            <div key={c.user_id} className="flex items-center justify-between text-xs gap-2">
              <span className="truncate flex-1">{i + 1}. {c.display_name}</span>
              {badge && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
              )}
              <span className="font-bold tabular-nums">{c.damage.toLocaleString()} kg</span>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-xs text-muted-foreground">該当者なし</p>}
      </div>
    );

    const tab = tabByRaid[raidId] || "all";
    return (
      <div className="border-t pt-2 mt-2">
        <p className="text-xs font-bold mb-2">貢献ランキング ({list.length}人 / 男{males.length}・女{females.length})</p>
        <Tabs value={tab} onValueChange={(v) => setTabByRaid((s) => ({ ...s, [raidId]: v }))}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs h-6">全体</TabsTrigger>
            <TabsTrigger value="male" className="text-xs h-6">男性</TabsTrigger>
            <TabsTrigger value="female" className="text-xs h-6">女性</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-2">{rowsFor(list, "all")}</TabsContent>
          <TabsContent value="male" className="mt-2">{rowsFor(males, "male")}</TabsContent>
          <TabsContent value="female" className="mt-2">{rowsFor(females, "female")}</TabsContent>
        </Tabs>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-extrabold flex items-center gap-2"><Sword className="w-6 h-6 text-red-600" /> レイド管理</h1>
        <p className="text-sm text-muted-foreground mt-1">週間レイドボスの作成・管理を行います</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="text-sm font-bold flex items-center gap-1.5"><Plus className="w-4 h-4" /> 新規レイド作成</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">ボス名</Label>
              <Input value={form.boss_name} onChange={(e) => setForm({ ...form, boss_name: e.target.value })} placeholder="ゴブリンキング" />
            </div>
            <div>
              <Label className="text-xs">HP (kg)</Label>
              <Input type="number" value={form.boss_hp} onChange={(e) => setForm({ ...form, boss_hp: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">開始日</Label>
              <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">終了日</Label>
              <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">報酬 EXP</Label>
              <Input type="number" value={form.reward_exp} onChange={(e) => setForm({ ...form, reward_exp: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">報酬 コイン</Label>
              <Input type="number" value={form.reward_coins} onChange={(e) => setForm({ ...form, reward_coins: Number(e.target.value) })} />
            </div>
          </div>
          <Button onClick={handleCreate} disabled={creating} className="w-full">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "作成"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-bold">レイド一覧</h2>
        {raids.map((r) => {
          const pct = Math.min(100, Math.round((r.current_damage / r.boss_hp) * 100));
          const list = contribs[r.id] || [];
          return (
            <Card key={r.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold">{r.boss_name} {r.defeated && <span className="text-amber-600 text-xs ml-2">撃破済み</span>}</p>
                    <p className="text-xs text-muted-foreground">{r.start_date} 〜 {r.end_date}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(r.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #DC2626, #F97316)" }} />
                </div>
                <p className="text-xs">{r.current_damage.toLocaleString()} / {r.boss_hp.toLocaleString()} kg ({pct}%) ／ 報酬 +{r.reward_exp}EXP +{r.reward_coins}コイン</p>
                {r.defeated && (
                  distributed[r.id] > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      <Gift className="w-3 h-3" /> 配布済み（{distributed[r.id]}個）
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => handleDistribute(r.id)} disabled={distributing === r.id} className="gap-1">
                      {distributing === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gift className="w-3 h-3" />}
                      限定報酬を配布
                    </Button>
                  )
                )}
                {list.length > 0 && (
                  renderRanking(r.id, list)
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default TrainerRaidManager;