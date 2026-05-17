import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Trophy, Dumbbell, CalendarCheck, Flame, Medal, Crown } from "lucide-react";
import { getRankInfo, type Gender } from "@/lib/avatarSystem";
import { getTitleDef } from "@/lib/titleSystem";
import FeaturedBadgesRow from "./FeaturedBadgesRow";

type RankType = "volume" | "sessions" | "combo";
type GenderTab = "male" | "female";

interface RankRow {
  user_id: string;
  level: number;
  equipped_title: string | null;
  value: number;
  featured_badges?: string[] | null;
  weapon_image?: string | null;
  weapon_rarity?: string | null;
  shield_image?: string | null;
  shield_rarity?: string | null;
  amulet_image?: string | null;
  amulet_rarity?: string | null;
}

const RANK_LABELS: Record<RankType, { label: string; icon: any; unit: (v: number) => string }> = {
  volume: { label: "総挙上量", icon: Dumbbell, unit: (v) => `${v.toLocaleString()}kg` },
  sessions: { label: "来店回数", icon: CalendarCheck, unit: (v) => `${v}回` },
  combo: { label: "最大コンボ", icon: Flame, unit: (v) => `${v}コンボ` },
};

const PODIUM_COLORS = ["#D4AF37", "#C0C0C0", "#CD7F32"];

const CustomerRanking = () => {
  const { user } = useAuth();
  const [type, setType] = useState<RankType>("volume");
  const [gender, setGender] = useState<GenderTab>("male");
  const [myGender, setMyGender] = useState<GenderTab | null>(null);
  const [rows, setRows] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_avatars")
      .select("gender")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const g = (data as any)?.gender;
        if (g === "male" || g === "female") {
          setMyGender(g);
          setGender(g);
        }
      });
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc("get_ranking", { p_type: type, p_gender: gender })
      .then(({ data }) => {
        if (cancelled) return;
        setRows(((data as any[]) || []) as RankRow[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, gender]);

  const myRow = useMemo(
    () => rows.findIndex((r) => r.user_id === user?.id),
    [rows, user],
  );
  const meInTop = myRow >= 0 && myRow < 20;

  const config = RANK_LABELS[type];
  const TypeIcon = config.icon;

  const renderAvatar = (row: RankRow, size: number) => {
    const rank = getRankInfo(row.level || 1, gender as Gender);
    return (
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <img
          src={rank.image}
          alt=""
          className="rounded-full object-cover bg-muted w-full h-full"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      </div>
    );
  };

  const titleName = (key: string | null) => getTitleDef(key)?.name || "称号なし";

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3, 20);
  // Reorder podium as 2 / 1 / 3
  const podiumOrder: (RankRow | undefined)[] = [top3[1], top3[0], top3[2]];
  const podiumHeights = [88, 110, 76];
  const podiumRanks = [2, 1, 3];
  const podiumIcons = [Medal, Crown, Trophy];

  return (
    <div className="space-y-4">
      {/* Type tabs */}
      <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-muted">
        {(Object.keys(RANK_LABELS) as RankType[]).map((t) => {
          const Icon = RANK_LABELS[t].icon;
          const active = type === t;
          return (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition ${
                active ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {RANK_LABELS[t].label}
            </button>
          );
        })}
      </div>

      {/* Gender tabs */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted">
        {(["male", "female"] as GenderTab[]).map((g) => (
          <button
            key={g}
            onClick={() => setGender(g)}
            className={`h-8 rounded-lg text-xs font-semibold transition ${
              gender === g ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
            }`}
          >
            {g === "male" ? "男性" : "女性"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <Trophy className="w-8 h-8 mx-auto mb-2 opacity-50" />
            まだランキングデータがありません
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Podium */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-end justify-center gap-2 pb-2">
                {podiumOrder.map((row, i) => {
                  const PIcon = podiumIcons[i];
                  const color = PODIUM_COLORS[podiumRanks[i] - 1];
                  if (!row) {
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center opacity-30">
                        <div className="w-12 h-12 rounded-full bg-muted mb-1" />
                        <div
                          className="w-full rounded-t-lg bg-muted"
                          style={{ height: podiumHeights[i] }}
                        />
                      </div>
                    );
                  }
                  const isMe = row.user_id === user?.id;
                  const avatarSize = i === 1 ? 64 : 52;
                  return (
                    <div key={row.user_id} className="flex-1 flex flex-col items-center min-w-0">
                      <PIcon
                        className="mb-1"
                        style={{ color, width: i === 1 ? 22 : 18, height: i === 1 ? 22 : 18 }}
                      />
                      {renderAvatar(row, avatarSize)}
                      <p className="text-[10px] font-bold mt-1 truncate max-w-full text-center" style={{ color }}>
                        {isMe ? "あなた" : titleName(row.equipped_title)}
                      </p>
                      <FeaturedBadgesRow badgeKeys={row.featured_badges} size={14} className="justify-center mb-1" />
                      <p className="text-[11px] font-extrabold text-foreground mb-1">
                        {config.unit(row.value)}
                      </p>
                      <div
                        className="w-full rounded-t-lg flex items-start justify-center pt-1 text-xs font-extrabold text-white"
                        style={{ height: podiumHeights[i], background: color }}
                      >
                        {podiumRanks[i]}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Rest list */}
          {rest.length > 0 && (
            <Card>
              <CardContent className="p-2">
                <div className="space-y-1">
                  {rest.map((row, idx) => {
                    const rank = idx + 4;
                    const isMe = row.user_id === user?.id;
                    return (
                      <div
                        key={row.user_id}
                        className="flex items-center gap-2 p-2 rounded-lg"
                        style={
                          isMe
                            ? { background: "hsla(174, 65%, 50%, 0.12)", border: "1px solid hsla(174, 65%, 50%, 0.4)" }
                            : undefined
                        }
                      >
                        <span className="w-6 text-center text-xs font-bold text-muted-foreground">
                          {rank}
                        </span>
                        {renderAvatar(row, 32)}
                        <div className="flex-1 min-w-0">
                          <span className="block text-xs font-semibold truncate">
                            {isMe ? "あなた" : titleName(row.equipped_title)}
                          </span>
                          <FeaturedBadgesRow badgeKeys={row.featured_badges} size={12} className="mt-0.5" />
                        </div>
                        <span className="text-xs font-extrabold">{config.unit(row.value)}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Sticky my rank if not in top 20 */}
          {!meInTop && myRow >= 0 && (
            <Card className="border-2" style={{ borderColor: "hsl(174, 65%, 50%)" }}>
              <CardContent className="p-3 flex items-center gap-2">
                <span className="w-7 text-center text-xs font-extrabold" style={{ color: "hsl(174, 65%, 50%)" }}>
                  {myRow + 1}
                </span>
                {renderAvatar(rows[myRow], 36)}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold" style={{ color: "hsl(174, 65%, 50%)" }}>あなた</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {titleName(rows[myRow].equipped_title)}
                  </p>
                </div>
                <span className="text-sm font-extrabold">{config.unit(rows[myRow].value)}</span>
              </CardContent>
            </Card>
          )}

          {!myGender && (
            <p className="text-[11px] text-center text-muted-foreground">
              性別を設定するとランキングに参加できます
            </p>
          )}
        </>
      )}

      <p className="text-[10px] text-center text-muted-foreground">
        <TypeIcon className="w-3 h-3 inline mr-1" />
        {type === "combo" ? "全期間ベスト" : "今月のランキング・毎月1日リセット"}
      </p>
    </div>
  );
};

export default CustomerRanking;