import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Loader2, Coins, Ticket, Flame, Star, Trophy, Target, Swords, Sparkles, CheckCircle2, Circle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { getExpProgress, ACHIEVEMENTS, getRarityColor, getRarityStarCount } from "@/lib/avatarSystem";
import { TITLES, getTitleDef } from "@/lib/titleSystem";
import { MISSIONS, getMissionDef, MISSION_BONUS_EXP } from "@/lib/missionSystem";
import BadgeIcon from "@/components/customer/BadgeIcon";
import FeaturedBadgesRow from "@/components/customer/FeaturedBadgesRow";
import { getJSTToday } from "@/lib/timezone";
import { evaluateAndAwardMissions, ensureDailyMissions } from "@/lib/missionRewards";
import { pickDailyMissions } from "@/lib/missionSystem";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { getEmoteVideoSrc } from "@/lib/emotes";

interface Props {
  clientId: string;
}

interface AvatarRow {
  level: number; total_exp: number; coins: number; combo_count: number;
  equipped_title: string | null; max_combo_reached: number; last_session_date: string | null;
  equipped_emote?: string | null;
  featured_badges?: string[] | null;
}
interface DailyMissionRow {
  mission_keys: string[]; completed_keys: string[]; all_completed: boolean; exp_earned: number;
}
interface RaidDamageRow {
  raid_id: string; damage: number; workout_date: string;
  raid?: { boss_name: string; defeated: boolean; start_date: string; end_date: string } | null;
}
interface GachaResultRow {
  id: string; result_date: string; reward_type: string; reward_amount: number | null; rarity: string;
}

const RARITY_COLOR: Record<string, string> = {
  common: "#9CA3AF", rare: "#0ABAB5", epic: "#6366F1", legendary: "#F59E0B",
};
const RARITY_LABEL: Record<string, string> = {
  common: "ノーマル", rare: "レア", epic: "エピック", legendary: "レジェンド",
};

const TrainerClientAvatarTab = ({ clientId }: Props) => {
  const [loading, setLoading] = useState(true);
  const [reEvaluating, setReEvaluating] = useState(false);
  const [avatar, setAvatar] = useState<AvatarRow | null>(null);
  const [achievements, setAchievements] = useState<{ achievement_key: string; unlocked_at: string }[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [todayMission, setTodayMission] = useState<DailyMissionRow | null>(null);
  const [hasContextToday, setHasContextToday] = useState(false);
  const [tickets, setTickets] = useState(0);
  const [raidLogs, setRaidLogs] = useState<RaidDamageRow[]>([]);
  const [gachaHistory, setGachaHistory] = useState<GachaResultRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const today = getJSTToday();
      const startOfDay = `${today}T00:00:00+09:00`;
      const endOfDay = `${today}T23:59:59+09:00`;
      const [
        avatarRes, achRes, titleRes, missionRes, ticketRes, raidLogRes, raidBossRes, gachaRes,
        bookingRes, workoutRes,
      ] = await Promise.all([
       supabase.from("user_avatars").select("level,total_exp,coins,combo_count,equipped_title,max_combo_reached,last_session_date,gender,hair_color,equipped_emote,featured_badges").eq("user_id", clientId).maybeSingle(),
        supabase.from("avatar_achievements").select("achievement_key,unlocked_at").eq("user_id", clientId).order("unlocked_at", { ascending: false }),
        supabase.from("user_titles").select("title_key").eq("user_id", clientId),
        supabase.from("daily_missions").select("mission_keys,completed_keys,all_completed,exp_earned").eq("user_id", clientId).eq("mission_date", today).maybeSingle(),
        supabase.from("user_gacha_tickets").select("id", { count: "exact", head: true }).eq("user_id", clientId).eq("used", false),
        supabase.from("raid_damage_logs").select("raid_id,damage,workout_date").eq("user_id", clientId).order("workout_date", { ascending: false }),
        supabase.from("raid_bosses").select("id,boss_name,defeated,start_date,end_date"),
        supabase.from("gacha_results").select("id,result_date,reward_type,reward_amount,rarity").eq("user_id", clientId).order("created_at", { ascending: false }).limit(20),
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("user_id", clientId).neq("status", "キャンセル済み").gte("booking_date", startOfDay).lte("booking_date", endOfDay),
        supabase.from("workouts").select("id", { count: "exact", head: true }).eq("user_id", clientId).eq("workout_date", today),
      ]);
      if (cancelled) return;
      setAvatar((avatarRes.data as any) ?? null);
      setAchievements((achRes.data as any) ?? []);
      setTitles(((titleRes.data as any) ?? []).map((r: any) => r.title_key));
      setTodayMission((missionRes.data as any) ?? null);
      setHasContextToday(((bookingRes.count ?? 0) + (workoutRes.count ?? 0)) > 0);
      setTickets(ticketRes.count ?? 0);
      const raidMap = new Map<string, any>();
      ((raidBossRes.data as any) ?? []).forEach((r: any) => raidMap.set(r.id, r));
      // Aggregate damage per raid
      const agg = new Map<string, RaidDamageRow>();
      ((raidLogRes.data as any) ?? []).forEach((r: any) => {
        const cur = agg.get(r.raid_id);
        if (cur) cur.damage += r.damage;
        else agg.set(r.raid_id, { raid_id: r.raid_id, damage: r.damage, workout_date: r.workout_date, raid: raidMap.get(r.raid_id) });
      });
      setRaidLogs([...agg.values()].sort((a, b) => (b.workout_date > a.workout_date ? 1 : -1)));
      setGachaHistory((gachaRes.data as any) ?? []);
      setLoading(false);

      // If customer has training today, auto-ensure + evaluate today's missions.
      if ((workoutRes.count ?? 0) > 0) {
        try {
          if (!missionRes.data) {
            await ensureDailyMissions(clientId, today, pickDailyMissions());
          }
          await evaluateAndAwardMissions(clientId, today);
          const { data: refreshed } = await supabase
            .from("daily_missions")
            .select("mission_keys,completed_keys,all_completed,exp_earned")
            .eq("user_id", clientId).eq("mission_date", today).maybeSingle();
          if (!cancelled) setTodayMission((refreshed as any) ?? null);
        } catch { /* non-fatal */ }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [clientId]);

  const handleReEvaluate = async () => {
    setReEvaluating(true);
    try {
      const today = getJSTToday();
      const { data: existing } = await supabase
        .from("daily_missions")
        .select("id").eq("user_id", clientId).eq("mission_date", today).maybeSingle();
      if (!existing) {
        await ensureDailyMissions(clientId, today, pickDailyMissions());
      }
      const result = await evaluateAndAwardMissions(clientId, today);
      const { data: refreshed } = await supabase
        .from("daily_missions")
        .select("mission_keys,completed_keys,all_completed,exp_earned")
        .eq("user_id", clientId).eq("mission_date", today).maybeSingle();
      setTodayMission((refreshed as any) ?? null);
      if (result.newlyCompleted.length > 0) {
        toast.success(`${result.newlyCompleted.length}件のミッションを達成しました`);
      } else {
        toast.info("更新しました");
      }
    } catch (e) {
      toast.error("再判定に失敗しました");
    } finally {
      setReEvaluating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!avatar) {
    return (
      <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">アバター情報がまだありません</CardContent></Card>
    );
  }

  const gender = ((avatar as any).gender as "male" | "female") ?? "female";
  const hairColor = ((avatar as any).hair_color as any) ?? "orange";
  const p = getExpProgress(avatar.total_exp, gender, hairColor);
  const equippedTitle = getTitleDef(avatar.equipped_title);
  const acquiredAch = new Set(achievements.map((a) => a.achievement_key));
  const acquiredTitles = new Set(titles);
  const achPct = Math.round((acquiredAch.size / ACHIEVEMENTS.length) * 100);

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0"
              style={{ backgroundColor: `${p.rank.color}15` }}
            >
              {(() => {
                const eSrc = getEmoteVideoSrc(avatar.equipped_emote);
                return eSrc ? (
                  <video src={eSrc} autoPlay loop muted playsInline preload="metadata" className="w-full h-full object-cover" />
                ) : (
                  <img
                    src={p.rank.image}
                    alt={p.rank.name}
                    className="w-full h-full object-cover pixel-avatar"
                    
                  />
                );
              })()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-extrabold leading-tight">Lv.{p.level} <span className="text-sm font-bold" style={{ color: p.rank.color }}>{p.rank.name}</span></p>
              {equippedTitle && (
                <p className="text-xs font-semibold mt-0.5 flex items-center gap-1" style={{ color: "hsl(174, 65%, 45%)" }}>
                  <Star className="w-3 h-3 fill-current" />{equippedTitle.name}
                </p>
              )}
              {avatar.featured_badges && avatar.featured_badges.length > 0 && (
                <FeaturedBadgesRow badgeKeys={avatar.featured_badges} size={18} className="mt-1" />
              )}
              <div className="mt-2">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${p.percent}%`, backgroundColor: "hsl(174, 65%, 50%)" }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{p.currentLevelExp} / {p.requiredExp} EXP（次まで{p.remainingExp}）</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="rounded-lg p-2 text-center" style={{ backgroundColor: "rgba(245, 158, 11, 0.08)" }}>
              <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5"><Coins className="w-3 h-3" />コイン</p>
              <p className="text-sm font-extrabold mt-0.5">{avatar.coins.toLocaleString()}</p>
            </div>
            <div className="rounded-lg p-2 text-center" style={{ backgroundColor: "rgba(239, 68, 68, 0.08)" }}>
              <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5"><Flame className="w-3 h-3" />コンボ</p>
              <p className="text-sm font-extrabold mt-0.5">{avatar.combo_count}</p>
            </div>
            <div className="rounded-lg p-2 text-center" style={{ backgroundColor: "rgba(10, 186, 181, 0.08)" }}>
              <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5"><Ticket className="w-3 h-3" />チケット</p>
              <p className="text-sm font-extrabold mt-0.5">{tickets}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Accordion type="multiple" defaultValue={["mission"]} className="space-y-2">
        {/* Daily missions */}
        <AccordionItem value="mission" className="border rounded-xl bg-card px-3">
          <AccordionTrigger className="text-sm font-bold hover:no-underline">
            <span className="flex items-center gap-2"><Target className="w-4 h-4" />本日のデイリーミッション</span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex justify-end pb-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleReEvaluate(); }}
                disabled={reEvaluating}
                className="text-[11px] font-semibold text-accent flex items-center gap-1 disabled:opacity-50"
              >
                {reEvaluating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                ミッション再判定
              </button>
            </div>
            {!todayMission ? (
              <p className="text-xs text-muted-foreground py-2">
                {hasContextToday ? "本日のミッションはまだ生成されていません" : "本日は予約・トレーニング記録がないためミッション未生成"}
              </p>
            ) : (
              <div className="space-y-1.5 pb-1">
                {todayMission.mission_keys.map((k) => {
                  const def = getMissionDef(k);
                  const done = todayMission.completed_keys.includes(k);
                  return (
                    <div key={k} className={`flex items-center gap-2 p-2 rounded-lg ${done ? "bg-accent/10" : "bg-muted/40"}`}>
                      {done ? <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold">{def?.name ?? k}</p>
                        <p className="text-[10px] text-muted-foreground break-all">{def?.description}</p>
                      </div>
                      <span className="text-[10px] font-bold text-accent">+{def?.exp ?? 0}</span>
                    </div>
                  );
                })}
                <div className={`flex items-center gap-2 p-2 rounded-lg ${todayMission.all_completed ? "bg-amber-50" : "bg-muted/30"}`}>
                  {todayMission.all_completed ? <Sparkles className="w-4 h-4 text-amber-500" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
                  <p className="text-xs font-bold flex-1">全達成ボーナス</p>
                  <span className="text-[10px] font-bold text-amber-600">+{MISSION_BONUS_EXP}</span>
                </div>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Achievements */}
        <AccordionItem value="ach" className="border rounded-xl bg-card px-3">
          <AccordionTrigger className="text-sm font-bold hover:no-underline">
            <span className="flex items-center gap-2">
              <Trophy className="w-4 h-4" />実績バッジ
              <span className="text-[10px] font-normal text-muted-foreground">({acquiredAch.size}/{ACHIEVEMENTS.length}・{achPct}%)</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-2 gap-2 pb-1">
              {ACHIEVEMENTS.map((a) => {
                const got = acquiredAch.has(a.key);
                const stars = getRarityStarCount(a.rarity);
                const starColor = getRarityColor(a.rarity);
                return (
                  <div key={a.key} className={`p-2 rounded-xl border text-center relative flex flex-col items-center ${got ? "bg-accent/10 border-accent/30" : "bg-muted/30 border-border"}`}>
                    <div className="absolute top-1 right-1 flex gap-0.5">
                      {Array.from({ length: stars }).map((_, i) => (
                        <Star key={i} className="w-2 h-2" style={{ color: starColor, fill: starColor }} />
                      ))}
                    </div>
                    <BadgeIcon type="achievement" iconKey={a.key} rarity={a.rarity} acquired={got} size={40} />
                    <p className="text-[11px] font-bold mt-1">{a.name}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5 break-all">{a.description}</p>
                    {got && (
                      <p className="text-[9px] text-accent mt-0.5">
                        {format(parseISO(achievements.find((x) => x.achievement_key === a.key)!.unlocked_at), "yyyy/M/d", { locale: ja })}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Titles */}
        <AccordionItem value="title" className="border rounded-xl bg-card px-3">
          <AccordionTrigger className="text-sm font-bold hover:no-underline">
            <span className="flex items-center gap-2">
              <Star className="w-4 h-4" />称号
              <span className="text-[10px] font-normal text-muted-foreground">({acquiredTitles.size}/{TITLES.length})</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-2 gap-2 pb-1">
              {TITLES.map((t) => {
                const got = acquiredTitles.has(t.key);
                const isEq = avatar.equipped_title === t.key;
                return (
                  <div key={t.key} className={`p-2 rounded-xl border text-center flex flex-col items-center ${isEq ? "border-2" : got ? "bg-accent/10 border-accent/30" : "bg-muted/30 border-border"}`} style={isEq ? { borderColor: "hsl(174, 65%, 50%)", backgroundColor: "hsla(174, 65%, 50%, 0.1)" } : {}}>
                    <BadgeIcon type="title" iconKey={t.key} acquired={got} equipped={isEq} size={40} />
                    <p className="text-[11px] font-bold mt-1">{t.name}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5 break-all">{t.condition}</p>
                    {isEq && <p className="text-[9px] font-bold mt-0.5" style={{ color: "hsl(174, 65%, 50%)" }}>装備中</p>}
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Raid */}
        <AccordionItem value="raid" className="border rounded-xl bg-card px-3">
          <AccordionTrigger className="text-sm font-bold hover:no-underline">
            <span className="flex items-center gap-2"><Swords className="w-4 h-4" />レイド参加履歴</span>
          </AccordionTrigger>
          <AccordionContent>
            {raidLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">参加履歴はまだありません</p>
            ) : (
              <div className="space-y-1.5 pb-1">
                {raidLogs.map((r) => (
                  <div key={r.raid_id} className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold flex items-center gap-1">{r.raid?.boss_name ?? "ボス"}{r.raid?.defeated && <Trophy className="w-3 h-3 text-amber-500" />}</p>
                      <p className="text-[10px] text-muted-foreground">{r.raid?.start_date}〜{r.raid?.end_date}</p>
                    </div>
                    <span className="text-xs font-extrabold text-red-600">{r.damage.toLocaleString()} kg</span>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Gacha */}
        <AccordionItem value="gacha" className="border rounded-xl bg-card px-3">
          <AccordionTrigger className="text-sm font-bold hover:no-underline">
            <span className="flex items-center gap-2"><Sparkles className="w-4 h-4" />ガチャ履歴</span>
          </AccordionTrigger>
          <AccordionContent>
            {gachaHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">ガチャ履歴はまだありません</p>
            ) : (
              <div className="space-y-1 pb-1">
                {gachaHistory.map((g) => (
                  <div key={g.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white flex-shrink-0" style={{ backgroundColor: RARITY_COLOR[g.rarity] || "#999" }}>
                        {RARITY_LABEL[g.rarity] || g.rarity}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{format(parseISO(g.result_date), "M/d", { locale: ja })}</span>
                    </div>
                    <span className="text-xs font-bold inline-flex items-center gap-1">
                      {g.reward_type === "coins" ? <Coins className="w-3 h-3 text-amber-500" /> : <Sparkles className="w-3 h-3 text-accent" />}+{g.reward_amount}
                      <span className="text-[10px] text-muted-foreground ml-1">{g.reward_type === "coins" ? "コイン" : "EXP"}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default TrainerClientAvatarTab;