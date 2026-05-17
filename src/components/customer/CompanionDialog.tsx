import { useState } from "react";
import { X as XIcon, Droplet, Flame, Wind, Mountain, Sun, Moon, Coins, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useCompanions, findEvolutionTarget, type UserCompanionRow } from "@/hooks/useCompanions";
import { useAvatar } from "@/hooks/useAvatar";
import { AVATAR_CDN_BASE } from "@/lib/avatarSystem";

const ELEMENT_CONFIG: Record<string, { color: string; label: string; Icon: any }> = {
  water: { color: "#3a7ecf", label: "水", Icon: Droplet },
  fire:  { color: "#ef4444", label: "火", Icon: Flame },
  wind:  { color: "#22c55e", label: "風", Icon: Wind },
  earth: { color: "#a16207", label: "地", Icon: Mountain },
  light: { color: "#eab308", label: "光", Icon: Sun },
  dark:  { color: "#7c3aed", label: "闇", Icon: Moon },
};

const imgUrl = (path: string | null | undefined, key?: string) =>
  `${AVATAR_CDN_BASE}/${path || `companions/${key || "baby_slime"}.png`}`;

interface Props { open: boolean; onClose: () => void; }

const CompanionDialog = ({ open, onClose }: Props) => {
  const { defs, companions, loading, feed, setActive } = useCompanions();
  const { avatar } = useAvatar(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [feeding, setFeeding] = useState(false);
  const [flash, setFlash] = useState(false);

  if (!open) return null;

  const active = companions.find((c) => c.is_active) || companions[0];
  const current: UserCompanionRow | undefined =
    companions.find((c) => c.companion_key === selectedKey) || active;

  const elem = current ? ELEMENT_CONFIG[current.element] : null;
  const evoTarget = current ? findEvolutionTarget(defs, current.companion_key) : undefined;
  const def = current ? defs.find((d) => d.companion_key === current.companion_key) : undefined;
  const requiredExp = current ? current.level * 100 : 100;
  const expPct = current ? Math.min(100, Math.round((current.exp / requiredExp) * 100)) : 0;

  const handleFeed = async (premium: boolean) => {
    if (!current || feeding) return;
    setFeeding(true);
    const r = await feed(current.companion_key, premium);
    setFeeding(false);
    if (r.error) { toast.error(r.error); return; }
    if (r.evolved) {
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
      toast.success(`おめでとう！ ${current.companion_name} は進化した！`);
      setSelectedKey(null);
    } else {
      toast.success(`+${r.exp_gain} EXP（Lv.${r.new_level}）`);
    }
  };

  const handleSwitch = async (key: string) => {
    if (key === current?.companion_key && current?.is_active) return;
    await setActive(key);
    setSelectedKey(key);
    toast.success("おともを切り替えました");
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-end sm:items-center justify-center p-2"
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-card shadow-2xl border border-border">
        {flash && <div className="absolute inset-0 bg-white z-10 pointer-events-none animate-pulse" />}
        <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-card border-b border-border">
          <h2 className="text-lg font-extrabold">おとも</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {loading || !current ? (
          <p className="p-6 text-center text-sm text-muted-foreground">読み込み中...</p>
        ) : (
          <div className="p-4 space-y-4">
            <div className="rounded-2xl p-4 text-center"
                 style={{ background: elem ? `${elem.color}10` : undefined, border: `1px solid ${elem?.color || "#ccc"}30` }}>
              <img
                src={imgUrl(current.image_path, current.companion_key)}
                alt={current.companion_name}
                className="w-32 h-32 object-contain mx-auto"
                style={{ imageRendering: "pixelated" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
              <p className="mt-2 text-lg font-extrabold">{current.companion_name}</p>
              <div className="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-full text-xs font-bold"
                   style={{ background: `${elem?.color}20`, color: elem?.color }}>
                {elem && <elem.Icon className="w-3 h-3" />} Lv.{current.level} ・ {elem?.label}属性
              </div>
              <div className="mt-2">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full" style={{ width: `${expPct}%`, background: elem?.color || "#888" }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{current.exp} / {requiredExp} EXP</p>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <div className="bg-red-500/10 rounded-lg py-1"><b className="text-red-500">ATK</b><br/><span className="font-bold">{current.base_atk + current.level}</span></div>
                <div className="bg-blue-500/10 rounded-lg py-1"><b className="text-blue-500">DEF</b><br/><span className="font-bold">{current.base_def + Math.floor(current.level / 2)}</span></div>
                <div className="bg-emerald-500/10 rounded-lg py-1"><b className="text-emerald-600">HP</b><br/><span className="font-bold">{current.base_hp + current.level * 5}</span></div>
              </div>
            </div>

            {def && (
              <div className="rounded-xl bg-muted/40 p-3">
                <p className="text-xs font-bold text-muted-foreground">固有スキル</p>
                <p className="text-sm font-bold flex items-center gap-1.5 mt-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />{def.skill_name}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{def.skill_description}</p>
              </div>
            )}

            {evoTarget && (
              <div className="rounded-xl border border-dashed border-border p-3 text-center">
                <p className="text-[11px] text-muted-foreground">次の進化</p>
                <p className="text-sm font-bold">Lv.{evoTarget.evolve_level} で {evoTarget.companion_name}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => handleFeed(false)} disabled={feeding || current.fed_today}
                      className="px-3 py-3 rounded-xl text-sm font-bold border border-border bg-card hover:bg-muted disabled:opacity-50">
                {current.fed_today ? "今日はあげた" : "エサをあげる(無料)"}
              </button>
              <button onClick={() => handleFeed(true)} disabled={feeding || (avatar?.coins ?? 0) < 50}
                      className="px-3 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg,#D4AF37,#B8860B)" }}>
                <Coins className="inline w-3.5 h-3.5 mr-1" />プレミアム(50)
              </button>
            </div>
            {current.feed_streak >= 3 && (
              <p className="text-[11px] text-center text-amber-600 font-bold">連続{current.feed_streak}日 ボーナス +50%</p>
            )}

            <div>
              <p className="text-xs font-bold text-muted-foreground mb-2">所持おとも（タップで切替）</p>
              <div className="grid grid-cols-3 gap-2">
                {companions.map((c) => {
                  const cElem = ELEMENT_CONFIG[c.element];
                  const isCur = c.companion_key === current.companion_key;
                  return (
                    <button key={c.id} onClick={() => handleSwitch(c.companion_key)}
                            className={`relative rounded-xl p-2 border-2 ${isCur ? "border-accent bg-accent/10" : "border-border bg-muted/30"}`}>
                      <img src={imgUrl(c.image_path, c.companion_key)} alt={c.companion_name}
                           className="w-12 h-12 object-contain mx-auto" style={{ imageRendering: "pixelated" }}
                           onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                      <p className="text-[10px] font-bold mt-1 truncate">{c.companion_name}</p>
                      <p className="text-[9px]" style={{ color: cElem?.color }}>Lv.{c.level}</p>
                      {c.is_active && <span className="absolute top-0.5 right-0.5 text-[8px] font-bold text-accent">使用中</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CompanionDialog;