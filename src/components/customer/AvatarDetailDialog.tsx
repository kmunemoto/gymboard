import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ACHIEVEMENTS, getAvatarImage, getExpProgress, getRankInfo, getRarityColor, getRarityStarCount, handleAvatarImgError } from "@/lib/avatarSystem";
import type { AvatarRow, ExpLogRow } from "@/hooks/useAvatar";
import { useAvatar } from "@/hooks/useAvatar";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { Coins, Trophy, Plus, Star, User as UserIcon, Crown, Heart, X as XIcon, CheckCircle2, Droplet, Shield as ShieldIcon, Cat } from "lucide-react";
import { Sword as SwordIcon, Sparkles, Image as ImageIcon } from "lucide-react";
import BadgeIcon from "./BadgeIcon";
import CoinShopDialog from "./CoinShopDialog";
import CoinShop from "./CoinShop";
import EmoteSection from "./EmoteSection";
import HairColorSection from "./HairColorSection";
import EquipmentOverlay from "./EquipmentOverlay";
import EquipmentDialog from "./EquipmentDialog";
import CompanionDialog from "./CompanionDialog";
import { useEquippedGear } from "@/hooks/useEquippedGear";
import { getMissionDef } from "@/lib/missionSystem";
import { TITLES, getTitleDef } from "@/lib/titleSystem";
import { equipRaidItem, RANK_LABEL_JP, type RaidRewardItem, type UserRaidReward, type RaidParticipationStat } from "@/hooks/useRaidRewards";
import { RAID_DAMAGE_MULT, MISSION_EXP_MULT, GACHA_PROBS, RANK_UP_REWARDS, RANK_LABEL } from "@/lib/rankPerks";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  avatar: AvatarRow;
  logs: ExpLogRow[];
  achievements: string[];
  titles?: string[];
  onEquipTitle?: (titleKey: string | null) => void | Promise<void>;
  rewardItems?: RaidRewardItem[];
  ownedRewards?: UserRaidReward[];
  participation?: RaidParticipationStat[];
  onRewardsChanged?: () => void;
  onAvatarChanged?: () => void;
}

const reasonLabel = (reason: string): string => {
  const parts = reason.split("|");
  const head = parts[0];
  switch (head) {
    case "session": return "セッション完了";
    case "streak_bonus": return "連続来店ボーナス";
    case "pb": return "自己ベスト更新";
    case "new_exercise": return "新種目チャレンジ";
    case "monthly_goal": return "月間目標達成";
    case "combo_bonus": return "コンボボーナス";
    case "raid_reward": return "レイド撃破報酬";
    case "mission": {
      const def = getMissionDef(parts[1]);
      return def ? `ミッション: ${def.name}` : "ミッション達成";
    }
    case "mission_bonus": return "全ミッション達成ボーナス";
    default: return reason;
  }
};

const AvatarDetailDialog = ({ open, onClose, avatar, logs, achievements, titles = [], onEquipTitle, rewardItems = [], ownedRewards = [], participation = [], onRewardsChanged, onAvatarChanged }: Props) => {
  const { user } = useAuth();
  const { updateGender, setFeaturedBadges } = useAvatar(false);
  const { gear } = useEquippedGear(user?.id);
  const gender = (avatar.gender as "male" | "female") ?? "female";
  const hairColor = (avatar.hair_color as any) ?? "orange";
  const p = getExpProgress(avatar.total_exp, gender, hairColor);
  const acquired = new Set(achievements);
  const acquiredTitles = new Set(titles);
  const equipped = avatar.equipped_title || null;
  const [shopOpen, setShopOpen] = useState(false);
  const [equipOpen, setEquipOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [badgeSheet, setBadgeSheet] = useState<string | null>(null);
  const [replacePicker, setReplacePicker] = useState<string | null>(null);
  const featured = (avatar.featured_badges as string[] | undefined) || [];
  const featuredSet = new Set(featured);

  const MILESTONES = [
    { count: 10, label: "称号「コレクター」+50コイン" },
    { count: 20, label: "称号「バッジマスター」+100コイン" },
    { count: 30, label: "+200コイン" },
    { count: ACHIEVEMENTS.length, label: "称号「レジェンドコレクター」+500コイン+虹フレーム" },
  ];
  const acquiredCount = acquired.size;
  const totalCount = ACHIEVEMENTS.length;
  const nextMilestone = MILESTONES.find((m) => acquiredCount < m.count);

  const toggleFeatured = async (key: string) => {
    if (featuredSet.has(key)) {
      await setFeaturedBadges(featured.filter((k) => k !== key));
      setBadgeSheet(null);
      onAvatarChanged?.();
      toast.success("お気に入りから外しました");
      return;
    }
    if (featured.length >= 3) {
      setReplacePicker(key);
      return;
    }
    await setFeaturedBadges([...featured, key]);
    setBadgeSheet(null);
    onAvatarChanged?.();
    toast.success("お気に入りに追加しました");
  };

  const handleReplace = async (removeKey: string) => {
    if (!replacePicker) return;
    const next = featured.filter((k) => k !== removeKey).concat(replacePicker);
    await setFeaturedBadges(next);
    setReplacePicker(null);
    setBadgeSheet(null);
    onAvatarChanged?.();
    toast.success("お気に入りを入れ替えました");
  };

  const ownedKeys = new Set(ownedRewards.map((o) => o.item_key));
  const ownedWeapons = rewardItems.filter((it) => it.category === "weapon" && ownedKeys.has(it.item_key));
  const ownedBackgrounds = rewardItems.filter((it) => it.category === "background" && ownedKeys.has(it.item_key));
  const equippedWeapon = avatar.equipped_weapon || null;
  const equippedBg = avatar.equipped_background || null;

  const handleEquip = async (cat: "weapon" | "background", key: string | null) => {
    if (!user) return;
    try {
      await equipRaidItem(user.id, cat, key);
      toast.success(key ? "装備しました" : "装備を解除しました");
      onAvatarChanged?.();
    } catch {
      toast.error("装備変更に失敗しました");
    }
  };

  const bossNameByRaid = new Map(participation.map((p) => [p.raid_id, p.boss_name]));

  const handleGenderChange = async (g: "male" | "female") => {
    if (gender === g) return;
    await updateGender(g);
    window.dispatchEvent(new CustomEvent("avatar-gender-updated"));
    onAvatarChanged?.();
    toast.success(g === "female" ? "女性アバターに変更しました" : "男性アバターに変更しました");
  };

  const rankKeys: Array<"rookie" | "regular" | "athlete" | "elite" | "legend"> = ["rookie", "regular", "athlete", "elite", "legend"];

  return (
    <>
    <Dialog open={open && !equipOpen && !companionOpen} onOpenChange={(o) => !o && !equipOpen && !companionOpen && onClose()}>
      <DialogContent className="max-w-md w-full max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogTitle className="sr-only">アバター詳細</DialogTitle>
        <div className="flex flex-col items-center pt-2">
          <div
            className="relative rounded-3xl flex items-center justify-center overflow-visible mx-auto"
            style={{
              width: "min(250px, 70vw)",
              height: "min(250px, 70vw)",
              backgroundColor: `${p.rank.color}15`,
              borderRadius: "1.5rem",
            }}
          >
            <div
              className="absolute inset-0 rounded-3xl overflow-hidden"
              style={{ zIndex: 1 }}
            >
              <img
                src={p.rank.image}
                alt={p.rank.name}
                className="w-full h-full object-cover pixel-avatar"
                onError={handleAvatarImgError}
              />
            </div>
            <EquipmentOverlay gear={gear} zBase={20} />
          </div>
          <div className="mt-3 text-center">
            <p className="text-2xl font-extrabold">Lv.{p.level}</p>
            <p className="text-sm font-bold" style={{ color: p.rank.color }}>{p.rank.name}</p>
            <p className="text-xs text-muted-foreground mt-1">累計 {p.totalExp.toLocaleString()} EXP</p>
          </div>
          <div className="w-full mt-3">
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${p.percent}%`, backgroundColor: "hsl(174, 65%, 50%)" }} />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
              <span>{p.currentLevelExp} / {p.requiredExp} EXP</span>
              <span>次のレベルまで {p.remainingExp}</span>
            </div>
          </div>
          <button
            onClick={() => setShopOpen(true)}
            className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-amber-600 px-3 py-1.5 rounded-full bg-amber-50 hover:bg-amber-100 transition-colors"
          >
            <Coins className="w-4 h-4" />
            {avatar.coins} コイン
            <Plus className="w-3.5 h-3.5 ml-1" />
          </button>
          {(() => {
            const lv = avatar.level ?? 1;
            const items = [gear.weapon, gear.shield, gear.amulet, gear.top, gear.bottom];
            const atkBonus = items.reduce((s, it) => s + (it?.atk_bonus ?? 0), 0);
            const defBonus = items.reduce((s, it) => s + (it?.def_bonus ?? 0), 0);
            const hpBonus = items.reduce((s, it) => s + (it?.hp_bonus ?? 0), 0);
            const hp = 100 + lv * 10 + hpBonus;
            const mp = 20 + lv * 5;
            const atk = 10 + lv * 2 + atkBonus;
            const def = 8 + Math.floor(lv * 1.5) + defBonus;
            const StatCard = ({
              label, value, bonus, color, bg, Icon,
            }: { label: string; value: number; bonus?: number; color: string; bg: string; Icon: any }) => (
              <div className={`${bg} rounded-xl p-2 text-center`}>
                <p className={`text-[10px] ${color} font-bold flex items-center justify-center gap-1`}>
                  <Icon className="w-3 h-3" /> {label}
                </p>
                <p className={`text-lg font-extrabold ${color} leading-tight`}>
                  {value}
                  {bonus && bonus > 0 ? (
                    <span className="text-[10px] font-bold ml-0.5 align-top">+{bonus}</span>
                  ) : null}
                </p>
              </div>
            );
            return (
              <div className="grid grid-cols-4 gap-2 w-full mt-3">
                <StatCard label="HP" value={hp} bonus={hpBonus} color="text-red-500" bg="bg-red-500/10" Icon={Heart} />
                <StatCard label="MP" value={mp} color="text-blue-500" bg="bg-blue-500/10" Icon={Droplet} />
                <StatCard label="ATK" value={atk} bonus={atkBonus} color="text-orange-500" bg="bg-orange-500/10" Icon={SwordIcon} />
                <StatCard label="DEF" value={def} bonus={defBonus} color="text-green-600" bg="bg-green-500/10" Icon={ShieldIcon} />
              </div>
            );
          })()}
          <button
            onClick={() => setEquipOpen(true)}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-muted hover:bg-muted/70 border border-border transition"
          >
            <SwordIcon className="w-4 h-4" />
            <span className="text-sm font-bold">装備変更</span>
          </button>
          <button
            onClick={() => setCompanionOpen(true)}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-muted hover:bg-muted/70 border border-border transition"
          >
            <Cat className="w-4 h-4" />
            <span className="text-sm font-bold">おとも</span>
          </button>
        </div>

        {/* 性別 */}
        <section className="mt-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <UserIcon className="w-3.5 h-3.5" /> 性別
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {(["female", "male"] as const).map((g) => {
              const selected = gender === g;
              const rank = getRankInfo(avatar.level ?? 1, g, hairColor);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => handleGenderChange(g)}
                  className={`relative rounded-2xl border-2 p-3 flex flex-col items-center transition ${selected ? "border-accent bg-accent/10" : "border-border bg-card hover:bg-muted/40"}`}
                >
                  <div
                    className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center"
                    style={{ backgroundColor: `${rank.color}15` }}
                  >
                    <img
                      src={getAvatarImage(rank.key, g, hairColor)}
                      alt={g}
                      className="w-full h-full object-contain pixel-avatar"
                      onError={handleAvatarImgError}
                    />
                  </div>
                  <span className="mt-2 text-sm font-bold">{g === "female" ? "女性" : "男性"}</span>
                  {selected && <span className="text-[10px] font-bold text-accent">選択中</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* エモーション（一時非表示: ドット絵版のエモートが用意でき次第復活） */}
        {false && (
          <section className="mt-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> エモーション
            </h3>
            <EmoteSection />
          </section>
        )}

        {/* 髪色 */}
        <section className="mt-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> 髪色
          </h3>
          <HairColorSection />
        </section>

        <section className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">EXP獲得履歴</h3>
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">まだ記録がありません</p>
          ) : (
            <div className="space-y-1">
              {logs.slice(0, 10).map((l) => (
                <div key={l.id} className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-muted/50">
                  <span className="truncate">
                    {l.reference_date ? format(parseISO(l.reference_date), "M/d", { locale: ja }) : ""} {reasonLabel(l.reason)}
                  </span>
                  <span className="font-bold text-accent">+{l.exp_amount}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5" /> 実績バッジ
          </h3>

          {/* Collection progress */}
          <div className="mb-3 p-3 rounded-xl bg-muted/40">
            <div className="flex items-end justify-between mb-1.5">
              <span className="text-xs font-bold">
                {acquiredCount}<span className="text-muted-foreground">/{totalCount}</span> バッジ取得
              </span>
              {nextMilestone && (
                <span className="text-[10px] text-muted-foreground">
                  次まで あと{nextMilestone.count - acquiredCount}個
                </span>
              )}
            </div>
            <div className="relative h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(acquiredCount / totalCount) * 100}%`,
                  background: "linear-gradient(90deg, hsl(174,65%,50%), #D4AF37)",
                }}
              />
              {MILESTONES.map((m) => (
                <span
                  key={m.count}
                  className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-background"
                  style={{
                    left: `calc(${(m.count / totalCount) * 100}% - 4px)`,
                    background: acquiredCount >= m.count ? "#D4AF37" : "#D1D5DB",
                  }}
                />
              ))}
            </div>
            <div className="mt-2 space-y-0.5">
              {MILESTONES.map((m) => {
                const done = acquiredCount >= m.count;
                return (
                  <div key={m.count} className="flex items-center gap-1.5 text-[10px]">
                    {done ? (
                      <CheckCircle2 className="w-3 h-3 text-amber-500 flex-shrink-0" />
                    ) : (
                      <span className="w-3 h-3 rounded-full border border-muted-foreground/40 flex-shrink-0" />
                    )}
                    <span className={done ? "text-amber-700 font-semibold" : "text-muted-foreground"}>
                      {m.count}個：{m.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {ACHIEVEMENTS.map((a) => {
              const got = acquired.has(a.key);
              const starColor = getRarityColor(a.rarity);
              const stars = getRarityStarCount(a.rarity);
              const isFeat = featuredSet.has(a.key);
              return (
                <button
                  key={a.key}
                  type="button"
                  disabled={!got}
                  onClick={() => setBadgeSheet(a.key)}
                  className={`p-2.5 rounded-xl border text-center relative flex flex-col items-center ${got ? "bg-accent/10 border-accent/30" : "bg-muted/30 border-border"}`}
                >
                  <div className="absolute top-1 right-1 flex gap-0.5">
                    {Array.from({ length: stars }).map((_, i) => (
                      <Star key={i} className="w-2.5 h-2.5" style={{ color: starColor, fill: starColor }} />
                    ))}
                  </div>
                  {isFeat && (
                    <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center shadow">
                      <Heart className="w-3 h-3 text-white fill-white" />
                    </div>
                  )}
                  <BadgeIcon type="achievement" iconKey={a.key} rarity={a.rarity} acquired={got} size={48} />
                  <p className="text-xs font-bold mt-1.5">{a.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 break-all">{a.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5" /> 称号
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {TITLES.map((t) => {
              const got = acquiredTitles.has(t.key);
              const isEq = equipped === t.key;
              return (
                <button
                  key={t.key}
                  disabled={!got || !onEquipTitle}
                  onClick={() => onEquipTitle?.(isEq ? null : t.key)}
                  className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center ${
                    isEq
                      ? "border-2"
                      : got
                      ? "bg-accent/10 border-accent/30 hover:bg-accent/20 cursor-pointer"
                      : "bg-muted/30 border-border cursor-default"
                  }`}
                  style={isEq ? { borderColor: "hsl(174, 65%, 50%)", backgroundColor: "hsla(174, 65%, 50%, 0.1)" } : {}}
                >
                  <BadgeIcon type="title" iconKey={t.key} acquired={got} equipped={isEq} size={48} />
                  <p className="text-xs font-bold mt-1.5">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 break-all">{t.condition}</p>
                  {isEq && <p className="text-[10px] font-bold mt-1" style={{ color: "hsl(174, 65%, 50%)" }}>装備中</p>}
                </button>
              );
            })}
          </div>
        </section>

        {(ownedWeapons.length > 0 || ownedBackgrounds.length > 0) && (
          <section className="mt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <SwordIcon className="w-3.5 h-3.5" /> レイド装備
            </h3>
            {ownedWeapons.length > 0 && (
              <div className="mb-3">
                <p className="text-[11px] font-bold mb-1.5">武器</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleEquip("weapon", null)}
                    className={`p-2 rounded-xl border text-center text-[11px] font-bold ${equippedWeapon === null ? "border-2" : "bg-muted/30"}`}
                    style={equippedWeapon === null ? { borderColor: "hsl(174,65%,50%)", backgroundColor: "hsla(174,65%,50%,0.1)" } : {}}
                  >
                    <div className="w-12 h-12 mx-auto rounded-lg bg-muted flex items-center justify-center text-muted-foreground">なし</div>
                    <p className="mt-1">装備しない</p>
                  </button>
                  {ownedWeapons.map((it) => {
                    const eq = equippedWeapon === it.item_key;
                    return (
                      <button
                        key={it.item_key}
                        onClick={() => handleEquip("weapon", eq ? null : it.item_key)}
                        className={`p-2 rounded-xl border text-center text-[11px] font-bold ${eq ? "border-2" : "bg-accent/5"}`}
                        style={eq ? { borderColor: it.theme_color || "hsl(174,65%,50%)", backgroundColor: `${it.theme_color || "#0ABAB5"}1A` } : {}}
                      >
                        <div className="w-12 h-12 mx-auto rounded-lg overflow-hidden flex items-center justify-center bg-white/40">
                          {it.image_url ? (
                            <img src={it.image_url} alt={it.name} className="w-full h-full object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <SwordIcon className="w-6 h-6" style={{ color: it.theme_color || undefined }} />
                          )}
                        </div>
                        <p className="mt-1 truncate">{it.name}</p>
                        {eq && <p className="text-[10px]" style={{ color: it.theme_color || undefined }}>装備中</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {ownedBackgrounds.length > 0 && (
              <div>
                <p className="text-[11px] font-bold mb-1.5">背景エフェクト</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleEquip("background", null)}
                    className={`p-2 rounded-xl border text-center text-[11px] font-bold ${equippedBg === null ? "border-2" : "bg-muted/30"}`}
                    style={equippedBg === null ? { borderColor: "hsl(174,65%,50%)", backgroundColor: "hsla(174,65%,50%,0.1)" } : {}}
                  >
                    <div className="w-12 h-12 mx-auto rounded-lg bg-muted flex items-center justify-center text-muted-foreground">なし</div>
                    <p className="mt-1">装備しない</p>
                  </button>
                  {ownedBackgrounds.map((it) => {
                    const eq = equippedBg === it.item_key;
                    return (
                      <button
                        key={it.item_key}
                        onClick={() => handleEquip("background", eq ? null : it.item_key)}
                        className={`p-2 rounded-xl border text-center text-[11px] font-bold ${eq ? "border-2" : "bg-accent/5"}`}
                        style={eq ? { borderColor: it.theme_color || "hsl(174,65%,50%)", backgroundColor: `${it.theme_color || "#0ABAB5"}1A` } : {}}
                      >
                        <div className="w-12 h-12 mx-auto rounded-lg overflow-hidden flex items-center justify-center bg-white/40">
                          {it.image_url ? (
                            <img src={it.image_url} alt={it.name} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <ImageIcon className="w-6 h-6" style={{ color: it.theme_color || undefined }} />
                          )}
                        </div>
                        <p className="mt-1 truncate">{it.name}</p>
                        {eq && <p className="text-[10px]" style={{ color: it.theme_color || undefined }}>装備中</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {participation.length > 0 && (
          <section className="mt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> レイド戦績
            </h3>
            <div className="space-y-2">
              {participation.map((r) => {
                const joined = r.my_rank !== "none";
                const myItems = rewardItems.filter((it) => r.earned_items.includes(it.item_key));
                return (
                  <div
                    key={r.raid_id}
                    className={`p-2.5 rounded-xl border ${joined ? "" : "opacity-50"}`}
                    style={joined ? { borderColor: r.theme_color || undefined } : {}}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
                        {r.boss_image_url ? (
                          <img src={r.boss_image_url} alt={r.boss_name} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <SwordIcon className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{r.boss_name}</p>
                        <p className="text-[10px] text-muted-foreground">{r.start_date} 〜 {r.end_date}</p>
                        {joined ? (
                          <p className="text-[11px] font-bold mt-0.5" style={{ color: r.theme_color || undefined }}>
                            {RANK_LABEL_JP[r.my_rank]} ／ {r.my_damage.toLocaleString()} kg
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground mt-0.5">未参加</p>
                        )}
                      </div>
                    </div>
                    {myItems.length > 0 && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {myItems.map((it) => (
                          <span key={it.item_key} className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${it.theme_color || "#0ABAB5"}1A`, color: it.theme_color || undefined }}>
                            {it.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ランク特典一覧 */}
        <section className="mt-5 mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Crown className="w-3.5 h-3.5" /> ランク特典一覧
          </h3>
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left font-bold py-1.5 px-2">ランク</th>
                  <th className="text-center font-bold py-1.5 px-1">レイド倍率</th>
                  <th className="text-center font-bold py-1.5 px-1">ミッション倍率</th>
                  <th className="text-center font-bold py-1.5 px-1">昇格報酬</th>
                </tr>
              </thead>
              <tbody>
                {rankKeys.map((rk) => {
                  const isCurrent = p.rank.key === rk;
                  const rew = rk === "rookie" ? null : RANK_UP_REWARDS[rk];
                  return (
                    <tr key={rk} className={`border-t ${isCurrent ? "bg-accent/10 font-bold" : ""}`}>
                      <td className="py-1.5 px-2">{RANK_LABEL[rk]}{isCurrent && <span className="ml-1 text-[9px] text-accent">現在</span>}</td>
                      <td className="text-center py-1.5 px-1">×{RAID_DAMAGE_MULT[rk]}</td>
                      <td className="text-center py-1.5 px-1">×{MISSION_EXP_MULT[rk]}</td>
                      <td className="text-center py-1.5 px-1">
                        {rew ? (
                          <span className="whitespace-nowrap">{rew.coins}コイン<br />ガチャ×{rew.tickets}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">レベルが上がると、ランクに応じた特典が自動で適用されます</p>
        </section>

      </DialogContent>
    </Dialog>
    <CoinShop open={shopOpen} onClose={() => setShopOpen(false)} coins={avatar.coins ?? 0} onPurchased={onAvatarChanged} />
    {badgeSheet && (() => {
        const a = ACHIEVEMENTS.find((x) => x.key === badgeSheet);
        if (!a) return null;
        const got = acquired.has(a.key);
        const isFeat = featuredSet.has(a.key);
        return (
          <div
            className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50"
            onClick={() => { setBadgeSheet(null); setReplacePicker(null); }}
          >
            <div
              className="w-full max-w-md rounded-t-3xl bg-background p-5 pb-8 animate-in slide-in-from-bottom"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto w-10 h-1 rounded-full bg-muted mb-4" />
              {!replacePicker ? (
                <>
                  <div className="flex flex-col items-center text-center">
                    <BadgeIcon type="achievement" iconKey={a.key} rarity={a.rarity} acquired={got} size={64} />
                    <p className="mt-2 font-extrabold">{a.name}</p>
                    <p className="text-xs text-muted-foreground mt-1 break-all">{a.description}</p>
                  </div>
                  {got ? (
                    <button
                      onClick={() => toggleFeatured(a.key)}
                      className="mt-5 w-full h-12 rounded-xl font-bold text-white flex items-center justify-center gap-2"
                      style={{ background: isFeat ? "#9CA3AF" : "linear-gradient(135deg, #F472B6, #EC4899)" }}
                    >
                      <Heart className={`w-4 h-4 ${isFeat ? "" : "fill-white"}`} />
                      {isFeat ? "お気に入りから外す" : "お気に入りに追加"}
                    </button>
                  ) : (
                    <p className="mt-4 text-center text-xs text-muted-foreground">未獲得のバッジです</p>
                  )}
                  <button
                    onClick={() => setBadgeSheet(null)}
                    className="mt-2 w-full h-10 rounded-xl font-semibold text-muted-foreground"
                  >
                    閉じる
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-center">どのバッジと入れ替えますか？</p>
                  <p className="text-[11px] text-muted-foreground text-center mt-1">お気に入りは最大3つまでです</p>
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    {featured.map((k) => {
                      const def = ACHIEVEMENTS.find((x) => x.key === k);
                      return (
                        <button
                          key={k}
                          onClick={() => handleReplace(k)}
                          className="p-2 rounded-xl border bg-card hover:bg-muted/40 flex flex-col items-center"
                        >
                          <BadgeIcon type="achievement" iconKey={k} rarity={def?.rarity || "normal"} acquired size={40} />
                          <p className="text-[10px] font-bold mt-1 truncate w-full text-center">{def?.name}</p>
                          <span className="text-[9px] text-rose-500 mt-0.5 flex items-center gap-0.5">
                            <XIcon className="w-2.5 h-2.5" />外す
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setReplacePicker(null)}
                    className="mt-4 w-full h-10 rounded-xl font-semibold text-muted-foreground"
                  >
                    キャンセル
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}
    <EquipmentDialog open={equipOpen} onClose={() => setEquipOpen(false)} />
    <CompanionDialog open={companionOpen} onClose={() => setCompanionOpen(false)} />
    </>
  );
};

export default AvatarDetailDialog;