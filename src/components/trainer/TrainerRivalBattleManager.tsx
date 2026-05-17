import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Swords, RefreshCw, CheckCircle2, Users } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { getJstMondayString } from "@/hooks/useRivalBattle";

interface BattleRow {
  id: string;
  week_start: string;
  week_end: string;
  player1_id: string;
  player2_id: string;
  player1_volume: number;
  player2_volume: number;
  winner_id: string | null;
  status: "active" | "completed";
}

const TrainerRivalBattleManager = () => {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [thisWeekBattles, setThisWeekBattles] = useState<BattleRow[]>([]);
  const [pastBattles, setPastBattles] = useState<BattleRow[]>([]);
  const [thisWeekEntries, setThisWeekEntries] = useState<{ user_id: string; matched: boolean }[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const weekStart = getJstMondayString();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: thisWeek }, { data: past }, { data: entries }] = await Promise.all([
      supabase.from("rival_battles" as any).select("*").eq("week_start", weekStart).order("created_at", { ascending: false }),
      supabase.from("rival_battles" as any).select("*").neq("week_start", weekStart).order("week_start", { ascending: false }).limit(50),
      supabase.from("rival_battle_entries" as any).select("user_id, matched").eq("week_start", weekStart),
    ]);
    const tw = (thisWeek as any as BattleRow[]) || [];
    const pw = (past as any as BattleRow[]) || [];
    const en = (entries as any as { user_id: string; matched: boolean }[]) || [];
    setThisWeekBattles(tw);
    setPastBattles(pw);
    setThisWeekEntries(en);

    const ids = new Set<string>();
    [...tw, ...pw].forEach((b) => { ids.add(b.player1_id); ids.add(b.player2_id); });
    en.forEach((e) => ids.add(e.user_id));
    if (ids.size > 0) {
      const { data: profs } = await supabase.from("profiles").select("user_id, display_name").in("user_id", [...ids]);
      const m = new Map<string, string>();
      (profs || []).forEach((p: any) => m.set(p.user_id, p.display_name || "—"));
      setNames(m);
    }
    setLoading(false);
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  const runRpc = async (key: string, fn: string, args: Record<string, any>, msg: string) => {
    setBusy(key);
    try {
      const { data, error } = await supabase.rpc(fn as any, args);
      if (error) throw error;
      toast.success(`${msg}：${JSON.stringify(data)}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "失敗しました");
    } finally {
      setBusy(null);
    }
  };

  const nm = (id: string) => names.get(id) || id.slice(0, 8);
  const unmatched = thisWeekEntries.filter((e) => !e.matched);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold flex items-center gap-2">
          <Swords className="w-6 h-6" style={{ color: "#0ABAB5" }} />
          バトル管理
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          今週開始日：{format(parseISO(weekStart), "yyyy年M月d日（E）", { locale: ja })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Button onClick={() => runRpc("match", "run_rival_matching", { p_week_start: weekStart }, "マッチング実行")} disabled={!!busy}>
          {busy === "match" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4 mr-1.5" />}
          マッチング実行
        </Button>
        <Button onClick={() => runRpc("update", "update_rival_battle_volumes", { p_week_start: weekStart }, "挙上量更新")} disabled={!!busy} variant="outline">
          {busy === "update" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
          挙上量更新
        </Button>
        <Button onClick={() => runRpc("complete", "complete_rival_battles", { p_week_start: weekStart }, "結果確定")} disabled={!!busy} variant="outline">
          {busy === "complete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
          結果確定
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <>
          <section>
            <h2 className="text-sm font-bold mb-2">今週のエントリー（{thisWeekEntries.length}名 / 未マッチ {unmatched.length}名）</h2>
            {unmatched.length === 0 ? (
              <p className="text-xs text-muted-foreground">未マッチなし</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {unmatched.map((e) => (
                  <span key={e.user_id} className="text-[11px] px-2 py-1 rounded bg-muted">{nm(e.user_id)}</span>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-bold mb-2">今週のバトル（{thisWeekBattles.length}試合）</h2>
            <div className="space-y-2">
              {thisWeekBattles.length === 0 && <p className="text-xs text-muted-foreground">バトルなし</p>}
              {thisWeekBattles.map((b) => (
                <Card key={b.id}>
                  <CardContent className="p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold truncate">{nm(b.player1_id)}</p>
                        <p className="text-muted-foreground">{Math.round(Number(b.player1_volume)).toLocaleString()} kg</p>
                      </div>
                      <span className="px-2 font-extrabold" style={{ color: "#0ABAB5" }}>VS</span>
                      <div className="flex-1 min-w-0 text-right">
                        <p className="font-bold truncate">{nm(b.player2_id)}</p>
                        <p className="text-muted-foreground">{Math.round(Number(b.player2_volume)).toLocaleString()} kg</p>
                      </div>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">状態：{b.status}{b.winner_id ? `（勝者：${nm(b.winner_id)}）` : b.status === "completed" ? "（引き分け）" : ""}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold mb-2">過去のバトル（{pastBattles.length}件）</h2>
            <div className="space-y-1.5">
              {pastBattles.map((b) => (
                <div key={b.id} className="text-xs p-2 rounded bg-muted flex items-center justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">{format(parseISO(b.week_start), "M/d", { locale: ja })}</span>
                  <span className="flex-1 truncate">{nm(b.player1_id)} vs {nm(b.player2_id)}</span>
                  <span className="shrink-0">{Math.round(Number(b.player1_volume)).toLocaleString()} - {Math.round(Number(b.player2_volume)).toLocaleString()}</span>
                  <span className="shrink-0 font-bold" style={{ color: b.winner_id ? "#0ABAB5" : "#888" }}>
                    {b.winner_id ? nm(b.winner_id).slice(0, 4) + "勝" : "分"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default TrainerRivalBattleManager;