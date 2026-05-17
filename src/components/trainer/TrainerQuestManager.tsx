import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Castle, RefreshCw, Swords } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UserProgress {
  user_id: string;
  display_name: string | null;
  current_stage: number;
  completed_count: number;
  boss_hp: number | null;
  boss_max: number | null;
  total_turns: number;
}

const TrainerQuestManager = () => {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [users, setUsers] = useState<UserProgress[]>([]);

  const fetchData = async () => {
    setLoading(true);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name");
    const { data: progress } = await supabase
      .from("user_quest_progress")
      .select("user_id, current_stage");
    const { data: completions } = await supabase
      .from("user_quest_stage_completions")
      .select("user_id, stage_id");
    const { data: bossProg } = await (supabase as any)
      .from("user_quest_boss_progress")
      .select("user_id, stage_id, boss_current_hp, total_turns, defeated");
    const { data: bosses } = await (supabase as any)
      .from("quest_bosses")
      .select("stage_id, boss_hp");

    const progMap = new Map((progress || []).map((p: any) => [p.user_id, p.current_stage]));
    const bossMaxMap = new Map<number, number>((bosses || []).map((b: any) => [b.stage_id as number, b.boss_hp as number]));
    const compMap = new Map<string, number>();
    (completions || []).forEach((c: any) => {
      compMap.set(c.user_id, (compMap.get(c.user_id) || 0) + 1);
    });

    const list: UserProgress[] = (profiles || [])
      .map((p: any) => {
        const cur = progMap.get(p.user_id) || 1;
        // Find stage_id for current stage_number isn't trivial without stages master; use bossProg lookup by user
        const userBp = (bossProg || []).find((b: any) => b.user_id === p.user_id && !b.defeated);
        return {
          user_id: p.user_id,
          display_name: p.display_name,
          current_stage: cur,
          completed_count: compMap.get(p.user_id) || 0,
          boss_hp: userBp?.boss_current_hp ?? null,
          boss_max: userBp ? (bossMaxMap.get(userBp.stage_id) ?? null) : null,
          total_turns: userBp?.total_turns ?? 0,
        };
      })
      .sort((a, b) => b.completed_count - a.completed_count);
    setUsers(list);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleInitialize = async () => {
    if (!confirm("全会員に初期装備（木の剣・革の盾・石の護符）を配布し、現在ステージのボス進捗を初期化します。よろしいですか？")) return;
    setRunning(true);
    const { data, error } = await supabase.rpc("initialize_quest_boss_progress");
    setRunning(false);
    if (error) {
      toast.error("初期化に失敗しました", { description: error.message });
      return;
    }
    const result = data as { users?: number } | null;
    toast.success(`初期化完了: ${result?.users ?? 0}名`);
    fetchData();
  };

  const handleDistributeStarter = async () => {
    if (!confirm("初期装備を持っていない全会員に、木の剣・革の盾・石の護符を配布します。")) return;
    setDistributing(true);
    const { data, error } = await supabase.rpc("initialize_starter_equipment");
    setDistributing(false);
    if (error) {
      toast.error("配布に失敗しました", { description: error.message });
      return;
    }
    const n = (data as any)?.users_initialized ?? 0;
    toast.success(`${n}名に初期装備を配布しました`);
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Castle className="w-6 h-6 text-accent" />
        <h1 className="text-xl font-extrabold">クエスト管理</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        会員のクエスト「眠れる王国を取り戻せ」の進行状況を管理します。
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">初期化（初期装備配布＋ボス進捗作成）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            未配布の会員に初期装備3種を付与し、現在ステージのボス進捗レコードを作成します。何度実行しても安全（重複登録なし）。
          </p>
          <Button onClick={handleInitialize} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            進行状況を再計算
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">初期装備を全員に配布</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            まだ装備を持っていない会員に、木の剣・革の盾・石の護符（装備済み）を一括で配布します。
          </p>
          <Button onClick={handleDistributeStarter} disabled={distributing} variant="outline">
            {distributing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Swords className="w-4 h-4 mr-2" />}
            全員に初期装備を配布
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">会員の進行状況 ({users.length}名)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
            </div>
          ) : (
            <div className="space-y-2">
              {users.map((u) => {
                const hpPct = u.boss_hp != null && u.boss_max ? (u.boss_hp / u.boss_max) * 100 : 0;
                return (
                  <div key={u.user_id} className="p-3 rounded-lg border border-border bg-card/50 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold truncate">
                        {u.display_name || "(名前未設定)"}
                      </span>
                      <div className="flex items-center gap-2 text-xs shrink-0">
                        <span className="text-muted-foreground">クリア {u.completed_count}/8</span>
                        <span className="px-2 py-0.5 rounded-md bg-accent/10 text-accent font-bold">
                          Stage {Math.min(u.current_stage, 8)}
                        </span>
                      </div>
                    </div>
                    {u.boss_max != null && (
                      <div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                          <span>ボスHP</span>
                          <span>{(u.boss_hp ?? 0).toLocaleString()}/{u.boss_max.toLocaleString()} · {u.total_turns}ターン</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full bg-red-500 transition-all" style={{ width: `${hpPct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {users.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">会員がいません</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TrainerQuestManager;