import { useEffect, useRef, useState, useCallback } from "react";
import {
  Bug, Worm, Snowflake, Flame, Skull, Bot, Wand2, CloudLightning, Heart, HeartPulse, HeartHandshake,
  Swords, Shield as ShieldIcon, X, Loader2, Sparkles, Sword, Package, Bomb, Zap, Target,
  Leaf, Droplet, TreeDeciduous, Pill, Cat, ChevronRight, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCombatStats } from "@/hooks/useQuestBattle";
import { useEquippedGear } from "@/hooks/useEquippedGear";
import { useAvatar } from "@/hooks/useAvatar";
import { getAvatarImage, handleAvatarImgError, getRankInfo } from "@/lib/avatarSystem";
import EquipmentOverlay from "./EquipmentOverlay";
import {
  fetchPlayerSkills, fetchBattleItems, fetchUserItems, fetchActiveCompanion,
  fetchStageStory, consumeItem, usePlayerMp, persistMp,
  type PlayerSkill, type BattleItem, type UserCompanion, type StoryLine, type MonsterSkill,
} from "@/hooks/useDungeonBattle";
import {
  fetchDungeonMonsters, completeDungeonRun,
  type DungeonMonster, type DungeonStage,
} from "@/hooks/useDungeon";
import { supabase } from "@/integrations/supabase/client";
import DungeonResult, { type DungeonResultData } from "./DungeonResult";
import { toast } from "sonner";

const MONSTER_ICON: Record<string, LucideIcon> = {
  Bug, Worm, Snowflake, Flame, Skull, Bot, Wand2, CloudLightning,
};
const SKILL_ICON: Record<string, LucideIcon> = {
  Flame, Heart, Zap, ShieldIcon, Target, CloudLightning, HeartPulse, Swords, Bomb, HeartHandshake, Sparkles,
};
const ITEM_ICON: Record<string, LucideIcon> = {
  Leaf, Droplet, TreeDeciduous, Pill, Package,
};
const COMPANION_ICON: Record<string, LucideIcon> = { Droplet, Cat, Flame, Sparkles, Bug };
import { AVATAR_CDN_BASE } from "@/lib/avatarSystem";

const ELEMENT_COLOR: Record<string, string> = {
  water: "#60a5fa", fire: "#f97316", earth: "#a16207", wind: "#34d399", neutral: "#cbd5e1",
};

// Color-variant monsters reuse base images via CSS hue-rotate filter
const MONSTER_IMAGE_BASE: Record<string, string> = {
  slime_2: "slime",
  goblin_3: "goblin",
  skeleton_4: "skeleton",
  stone_golem_5: "stone_golem",
};
const MONSTER_FILTER: Record<string, string> = {
  slime_2: "hue-rotate(120deg) saturate(1.5)",
  goblin_3: "hue-rotate(30deg) brightness(1.2)",
  skeleton_4: "hue-rotate(-60deg) saturate(2)",
  stone_golem_5: "hue-rotate(180deg)",
};
const getMonsterImageKey = (key: string): string => MONSTER_IMAGE_BASE[key] || key;
const getMonsterFilter = (key: string): string => MONSTER_FILTER[key] || "none";

const rand = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;

type Phase =
  | "loading" | "intro" | "appear" | "command" | "skill_select" | "item_select"
  | "action" | "boss_intro" | "floor_clear" | "boss_defeat" | "victory" | "defeat" | "revive_prompt" | "target_select";

interface Buff { type: string; multiplier: number; turnsLeft: number; }

interface Props {
  stage: DungeonStage;
  runId: string;
  onClose: () => void;
  onFinish: () => void;
}

const DungeonBattle = ({ stage, runId, onClose, onFinish }: Props) => {
  const { user } = useAuth();
  const { stats } = useCombatStats();
  const { avatar } = useAvatar(false);
  const { gear } = useEquippedGear(user?.id);
  const { mp, setMp } = usePlayerMp(user?.id);

  // Master data
  const [monsters, setMonsters] = useState<DungeonMonster[]>([]);
  const [skills, setSkills] = useState<PlayerSkill[]>([]);
  const [itemMaster, setItemMaster] = useState<Record<string, BattleItem>>({});
  const [items, setItems] = useState<Record<string, number>>({});
  const [companion, setCompanion] = useState<UserCompanion | null>(null);
  const [story, setStory] = useState<Record<string, StoryLine[]>>({});
  const [materialNames, setMaterialNames] = useState<Record<string, string>>({});

  // Battle state
  const [phase, setPhase] = useState<Phase>("loading");
  const [floorIdx, setFloorIdx] = useState(0);
  const [playerHp, setPlayerHp] = useState(0);
  const [maxHp, setMaxHp] = useState(0);
  const [compHp, setCompHp] = useState(0);
  const [compMaxHp, setCompMaxHp] = useState(0);
  const [monsterHps, setMonsterHps] = useState<number[]>([]);
  const [pendingAction, setPendingAction] = useState<{ kind: "attack" } | { kind: "skill"; skill: PlayerSkill } | null>(null);
  const [buffs, setBuffs] = useState<Buff[]>([]);
  const [enemyDebuffs, setEnemyDebuffs] = useState<Buff[]>([]);
  const [defending, setDefending] = useState(false);
  const [accExp, setAccExp] = useState(0);
  const [accCoins, setAccCoins] = useState(0);
  const [accMaterials, setAccMaterials] = useState<Record<string, number>>({});
  const [result, setResult] = useState<DungeonResultData | null>(null);

  // Visuals
  const [shake, setShake] = useState(false);
  const [hurtFlash, setHurtFlash] = useState(false);
  const [critFlash, setCritFlash] = useState(false);
  const [bossFlash, setBossFlash] = useState(false);
  const [floats, setFloats] = useState<{ id: number; text: string; color: string; target: "player" | "monster" | "comp" }[]>([]);
  const [spellFx, setSpellFx] = useState<{ id: number; kind: string } | null>(null);
  const [slashFx, setSlashFx] = useState(false);
  const [critSlashFx, setCritSlashFx] = useState(false);
  const [impactFx, setImpactFx] = useState(false);

  // Image load failures (fallback to gradient/icon)
  const [bgImgError, setBgImgError] = useState(false);
  const [monsterImgError, setMonsterImgError] = useState<Record<string, boolean>>({});

  // Message system
  const [msgQueue, setMsgQueue] = useState<string[]>([]);
  const [currentMsg, setCurrentMsg] = useState("");
  const [shown, setShown] = useState("");
  const [waitingTap, setWaitingTap] = useState(false);
  const onMsgDoneRef = useRef<(() => void) | null>(null);

  const finishedRef = useRef(false);
  const compNameRef = useRef("おとも");

  const monster = monsters[floorIdx];
  const monsterCount = monster?.monster_count ?? 1;
  const aliveIndices = monsterHps.map((h, i) => (h > 0 ? i : -1)).filter((i) => i >= 0);
  const monsterLabel = (i: number) => monsterCount > 1 ? `${monster!.monster_name} ${["A","B","C","D"][i] || (i+1)}` : monster!.monster_name;
  const BG_BASE = "https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/dungeon";
  const bgImageUrl = `${BG_BASE}/bg_${stage.stage_key}.png`;
  const monsterImageUrl = monster ? `${BG_BASE}/monsters/${getMonsterImageKey(monster.monster_key)}.png` : "";
  const monsterFilter = monster ? getMonsterFilter(monster.monster_key) : "none";
  const playerName = avatar?.equipped_title ? "あなた" : "あなた";

  // ---- Initial load ----
  useEffect(() => {
    (async () => {
      if (!user) return;
      const lvl = avatar?.level ?? 1;
      const [m, sk, im, it, cp, st] = await Promise.all([
        fetchDungeonMonsters(stage.stage_key),
        fetchPlayerSkills(lvl || 1),
        fetchBattleItems(),
        fetchUserItems(user.id),
        fetchActiveCompanion(user.id),
        fetchStageStory(stage.stage_key),
      ]);
      setMonsters(m);
      setSkills(sk);
      setItemMaster(im);
      setItems(it);
      setCompanion(cp);
      setStory(st);
      if (cp) {
        compNameRef.current = cp.companion_name;
        const cMax = cp.base_hp + cp.level * 5;
        setCompHp(cMax); setCompMaxHp(cMax);
      }
      const { data: mats } = await (supabase as any).from("craft_materials").select("material_key,material_name");
      const mm: Record<string, string> = {};
      (mats || []).forEach((r: any) => { mm[r.material_key] = r.material_name; });
      setMaterialNames(mm);
    })();
  }, [stage.stage_key, user, avatar?.level]);

  // Initialize player HP once stats arrive
  useEffect(() => {
    if (!stats || maxHp > 0) return;
    setMaxHp(stats.total_hp);
    setPlayerHp(stats.total_hp);
  }, [stats, maxHp]);

  // Start intro once everything loaded
  useEffect(() => {
    if (phase !== "loading") return;
    if (!stats || monsters.length === 0 || maxHp === 0) return;
    // Initialize first monster HPs (1 or 2 copies)
    const m0 = monsters[0];
    setMonsterHps(Array.from({ length: m0.monster_count ?? 1 }, () => m0.hp));
    // Push intro story + appear
    const intro = (story.intro || []).map((s) => formatLine(s));
    pushMessages([...intro, `${monsters[0].monster_name}が あらわれた！`], () => setPhase("command"));
    setPhase("intro");
  }, [phase, stats, monsters, maxHp, story]);

  // ---- Message typewriter ----
  useEffect(() => {
    if (msgQueue.length === 0 || currentMsg) return;
    const next = msgQueue[0];
    setMsgQueue((q) => q.slice(1));
    setCurrentMsg(next);
    setShown("");
    setWaitingTap(false);
  }, [msgQueue, currentMsg]);

  useEffect(() => {
    if (!currentMsg) return;
    if (shown.length >= currentMsg.length) {
      setWaitingTap(true);
      return;
    }
    const t = setTimeout(() => setShown(currentMsg.slice(0, shown.length + 1)), 28);
    return () => clearTimeout(t);
  }, [currentMsg, shown]);

  const advanceMessage = () => {
    if (!currentMsg) return;
    if (shown.length < currentMsg.length) { setShown(currentMsg); return; }
    // Move to next message
    setCurrentMsg("");
    setShown("");
    setWaitingTap(false);
    if (msgQueue.length === 0) {
      const cb = onMsgDoneRef.current;
      onMsgDoneRef.current = null;
      if (cb) cb();
    }
  };

  const pushMessages = (msgs: string[], onDone?: () => void) => {
    setMsgQueue((q) => [...q, ...msgs]);
    if (onDone) onMsgDoneRef.current = onDone;
  };

  function formatLine(s: StoryLine): string {
    return s.speaker ? `${s.speaker}「${s.message}」` : s.message;
  }

  // ---- Stat helpers ----
  const getEffectiveAtk = () => {
    let a = stats?.total_atk ?? 1;
    buffs.filter((b) => b.type === "player_atk").forEach((b) => (a *= b.multiplier));
    return Math.floor(a);
  };
  const getEffectiveDef = () => {
    let d = stats?.total_def ?? 0;
    buffs.filter((b) => b.type === "player_def").forEach((b) => (d *= b.multiplier));
    return Math.floor(d);
  };
  const getEnemyDef = (base: number) => {
    let d = base;
    enemyDebuffs.filter((b) => b.type === "enemy_def").forEach((b) => (d *= b.multiplier));
    return Math.floor(d);
  };

  const addFloat = (text: string, color: string, target: "player" | "monster" | "comp") => {
    const id = Date.now() + Math.random();
    setFloats((f) => [...f, { id, text, color, target }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 900);
  };

  const triggerSpellFx = (kind: string) => {
    const id = Date.now();
    setSpellFx({ id, kind });
    setTimeout(() => setSpellFx((s) => (s?.id === id ? null : s)), 700);
  };

  // ---- Combat actions ----
  // Reward rewards based on coin/exp per defeated monster (one per copy)
  const aliveCount = monsterHps.filter((h) => h > 0).length;

  const performAttack = (targetIdx: number) => {
    if (!monster) return;
    setPhase("action");
    const eAtk = getEffectiveAtk();
    const eDef = getEnemyDef(monster.def);
    const isCrit = Math.random() < 0.05;
    const base = Math.max(1, eAtk - eDef + rand(-3, 3));
    const dmg = isCrit ? Math.floor(base * 1.5) : base;

    pushMessages([`あなたの こうげき！`], () => {
      setShake(true); setTimeout(() => setShake(false), 300);
      setSlashFx(true); setTimeout(() => setSlashFx(false), 500);
      if (isCrit) {
        setCritFlash(true); setTimeout(() => setCritFlash(false), 250);
        setCritSlashFx(true); setTimeout(() => setCritSlashFx(false), 600);
      }
      addFloat(isCrit ? `CRITICAL ${dmg}` : `${dmg}`, isCrit ? "#fbbf24" : "#ffffff", "monster");
      const nh = Math.max(0, (monsterHps[targetIdx] ?? 0) - dmg);
      const newHps = monsterHps.map((h, i) => (i === targetIdx ? nh : h));
      setMonsterHps(newHps);
      const msgs = [
        ...(isCrit ? ["会心の一撃！"] : []),
        `${monsterLabel(targetIdx)}に ${dmg}の ダメージ！`,
      ];
      pushMessages(msgs, () => afterPlayerAction(newHps, playerHp));
    });
  };

  const handleAttack = () => {
    if (!monster) return;
    if (aliveCount > 1) {
      setPendingAction({ kind: "attack" });
      setPhase("target_select");
      return;
    }
    const t = monsterHps.findIndex((h) => h > 0);
    if (t < 0) return;
    performAttack(t);
  };

  const performSkill = (sk: PlayerSkill, targetIdx: number) => {
    if (!monster) return;
    if (mp.current < sk.mp_cost) return;
    setPhase("action");
    setMp({ current: mp.current - sk.mp_cost, max: mp.max });

    pushMessages([`あなたは ${sk.skill_name}を 唱えた！`], async () => {
      triggerSpellFx(sk.skill_key);
      if (sk.skill_type === "attack") {
        const eAtk = getEffectiveAtk();
        const eDef = getEnemyDef(monster.def);
        const dmg = Math.max(1, Math.floor((eAtk - eDef) * sk.power) + rand(-2, 2));
        setShake(true); setTimeout(() => setShake(false), 300);
        addFloat(`${dmg}`, "#ffffff", "monster");
        const nh = Math.max(0, (monsterHps[targetIdx] ?? 0) - dmg);
        const newHps = monsterHps.map((h, i) => (i === targetIdx ? nh : h));
        setMonsterHps(newHps);
        pushMessages([`${monsterLabel(targetIdx)}に ${dmg}の ダメージ！`], () => afterPlayerAction(newHps, playerHp));
      } else if (sk.skill_type === "heal") {
        const heal = sk.heal_amount === 9999 ? maxHp : (sk.heal_amount ?? 0);
        const nh = Math.min(maxHp, playerHp + heal);
        const actual = nh - playerHp;
        setPlayerHp(nh);
        addFloat(`+${actual}`, "#34d399", "player");
        pushMessages([`HPが ${actual} 回復した！`], () => afterPlayerAction(monsterHps, nh));
      } else if (sk.skill_type === "buff") {
        setBuffs((b) => [...b, { type: sk.buff_type!, multiplier: Number(sk.buff_multiplier), turnsLeft: sk.buff_turns }]);
        const label = sk.buff_type === "player_atk" ? "攻撃力" : "守備力";
        pushMessages([`あなたの ${label}が 上がった！`], () => afterPlayerAction(monsterHps, playerHp));
      } else if (sk.skill_type === "debuff") {
        setEnemyDebuffs((b) => [...b, { type: sk.buff_type!, multiplier: Number(sk.buff_multiplier), turnsLeft: sk.buff_turns }]);
        pushMessages([`${monsterLabel(targetIdx)}の 守備力が 下がった！`], () => afterPlayerAction(monsterHps, playerHp));
      }
    });
  };

  const handleSkill = (sk: PlayerSkill) => {
    if (!monster) return;
    if (mp.current < sk.mp_cost) return;
    const needsTarget = sk.skill_type === "attack" || sk.skill_type === "debuff";
    if (needsTarget && aliveCount > 1) {
      setPendingAction({ kind: "skill", skill: sk });
      setPhase("target_select");
      return;
    }
    const t = needsTarget ? monsterHps.findIndex((h) => h > 0) : 0;
    performSkill(sk, Math.max(0, t));
  };

  const handleSelectTarget = (idx: number) => {
    if (!pendingAction) return;
    const act = pendingAction;
    setPendingAction(null);
    if (act.kind === "attack") performAttack(idx);
    else performSkill(act.skill, idx);
  };

  const handleDefend = () => {
    setDefending(true);
    setPhase("action");
    pushMessages([`あなたは 身構えた！`], () => afterPlayerAction(monsterHps, playerHp));
  };

  const handleItem = async (key: string) => {
    const it = itemMaster[key];
    if (!it || !user) return;
    if ((items[key] ?? 0) <= 0) return;
    setPhase("action");
    await consumeItem(user.id, key);
    setItems((s) => ({ ...s, [key]: Math.max(0, (s[key] ?? 0) - 1) }));
    pushMessages([`あなたは ${it.item_name}を 使った！`], () => {
      if (it.effect_type === "heal_hp") {
        const nh = Math.min(maxHp, playerHp + it.effect_amount);
        const a = nh - playerHp;
        setPlayerHp(nh);
        addFloat(`+${a}`, "#34d399", "player");
        pushMessages([`HPが ${a} 回復した！`], () => afterPlayerAction(monsterHps, nh));
      } else if (it.effect_type === "heal_mp") {
        const nm = Math.min(mp.max, mp.current + it.effect_amount);
        const a = nm - mp.current;
        setMp({ current: nm, max: mp.max });
        pushMessages([`MPが ${a} 回復した！`], () => afterPlayerAction(monsterHps, playerHp));
      } else {
        afterPlayerAction(monsterHps, playerHp);
      }
    });
  };

  const handleRetreat = () => {
    if (finishedRef.current) return;
    setPhase("action");
    if (Math.random() < 0.5) {
      pushMessages([`あなたは 戦場から撤退した！`], () => finishRun("retreat", floorIdx));
    } else {
      pushMessages([`しかし 回り込まれてしまった！`], () => enemyTurn(monsterHps, playerHp));
    }
  };

  // ---- After player action: companion → enemy → next turn ----
  const afterPlayerAction = (curHps: number[], currentPlayerHp: number) => {
    if (curHps.every((h) => h <= 0)) { onFloorClear(); return; }
    // Companion attacks
    if (companion && compHp > 0) {
      // Pick alive target (prefer one player isn't attacking - use last alive index)
      const aliveT = curHps.map((h, i) => (h > 0 ? i : -1)).filter((i) => i >= 0);
      const compTarget = aliveT[aliveT.length - 1];
      const cAtk = companion.base_atk + companion.level + (companion.level >= 10 && Math.random() < 0.2 ? Math.floor((companion.base_atk + companion.level) * 0.3) : 0);
      const eDef = getEnemyDef(monster!.def);
      const dmg = Math.max(1, cAtk - eDef + rand(-2, 2));
      pushMessages([`${companion.companion_name}の こうげき！`], () => {
        setShake(true); setTimeout(() => setShake(false), 250);
        setSlashFx(true); setTimeout(() => setSlashFx(false), 500);
        addFloat(`${dmg}`, "#a3e635", "monster");
        const nh = Math.max(0, curHps[compTarget] - dmg);
        const newHps = curHps.map((h, i) => (i === compTarget ? nh : h));
        setMonsterHps(newHps);
        pushMessages([`${monsterLabel(compTarget)}に ${dmg}の ダメージ！`], () => {
          if (newHps.every((h) => h <= 0)) { onFloorClear(); return; }
          enemyTurn(newHps, currentPlayerHp);
        });
      });
    } else {
      enemyTurn(curHps, currentPlayerHp);
    }
  };

  const enemyTurn = (curHps: number[], currentPlayerHp: number) => {
    if (curHps.every((h) => h <= 0)) { onFloorClear(); return; }
    const m = monster!;
    const aliveList = curHps.map((h, i) => (h > 0 ? i : -1)).filter((i) => i >= 0);
    // Each alive monster acts in sequence
    const runOne = (queue: number[], hps: number[], curPHp: number) => {
      if (queue.length === 0) {
        if (curPHp <= 0) { onPlayerDown(); return; }
        tickAndContinue();
        return;
      }
      const idx = queue[0];
      const rest = queue.slice(1);
      if (hps[idx] <= 0) { runOne(rest, hps, curPHp); return; }

    const skillList: MonsterSkill[] = (m as any).monster_skills && Array.isArray((m as any).monster_skills) && (m as any).monster_skills.length > 0
      ? (m as any).monster_skills
      : [{ action: "attack", weight: 100, message: "の こうげき！" }];
    const total = skillList.reduce((a, s) => a + s.weight, 0);
    let roll = Math.random() * total;
    let chosen: MonsterSkill = skillList[0];
    for (const s of skillList) { roll -= s.weight; if (roll <= 0) { chosen = s; break; } }

      pushMessages([`${monsterLabel(idx)}${chosen.message}`], () => {
        if (chosen.action === "defend") { runOne(rest, hps, curPHp); return; }
      if (chosen.dispel) {
        setBuffs([]);
          pushMessages([`強化が 消し去られた！`], () => runOne(rest, hps, curPHp));
        return;
      }
      if (chosen.heal && chosen.heal > 0) {
          const nh = Math.min(m.hp, hps[idx] + (chosen.heal ?? 0));
          const newHps = hps.map((h, i) => (i === idx ? nh : h));
          setMonsterHps(newHps);
        addFloat(`+${chosen.heal}`, "#34d399", "monster");
          pushMessages([`${monsterLabel(idx)}は ${chosen.heal} 回復した！`], () => runOne(rest, newHps, curPHp));
        return;
      }
      const power = chosen.power ?? 1;
      const hits = chosen.hits ?? 1;
      const eDef = getEffectiveDef();
      let totalDmg = 0;
      for (let i = 0; i < hits; i++) {
        let d = Math.max(1, Math.floor((m.atk * power) - eDef) + rand(-2, 2));
        if (defending) d = Math.floor(d / 2);
        totalDmg += d;
      }
      setHurtFlash(true); setTimeout(() => setHurtFlash(false), 250);
      setImpactFx(true); setTimeout(() => setImpactFx(false), 400);
      addFloat(`${totalDmg}`, "#ef4444", "player");
        const nh = Math.max(0, curPHp - totalDmg);
        setPlayerHp(nh);
      const msgs: string[] = [];
      if (defending) msgs.push(`しかし あなたは 身構えていた！ ダメージが軽減された！`);
      msgs.push(`あなたは ${totalDmg}の ダメージを 受けた！`);
      pushMessages(msgs, () => {
        if (nh <= 0) { onPlayerDown(); return; }
          runOne(rest, hps, nh);
      });
    });
    };
    runOne(aliveList, curHps, currentPlayerHp);
  };

  const tickAndContinue = () => {
    setDefending(false);
    setBuffs((bs) => bs.map((b) => ({ ...b, turnsLeft: b.turnsLeft - 1 })).filter((b) => b.turnsLeft > 0));
    setEnemyDebuffs((bs) => bs.map((b) => ({ ...b, turnsLeft: b.turnsLeft - 1 })).filter((b) => b.turnsLeft > 0));
    setPhase("command");
  };

  // ---- Floor clear ----
  const onFloorClear = () => {
    const m = monster!;
    const drops: { key: string; qty: number }[] = [];
    if (m.drop_material_key && Math.random() < Number(m.drop_material_rate)) {
      drops.push({ key: m.drop_material_key, qty: 1 });
    }
    const newExp = accExp + m.exp_reward;
    const newCoins = accCoins + m.coin_reward;
    const newMats = { ...accMaterials };
    drops.forEach((d) => { newMats[d.key] = (newMats[d.key] || 0) + d.qty; });
    setAccExp(newExp); setAccCoins(newCoins); setAccMaterials(newMats);

    const msgs: string[] = [
      `${m.monster_name}を 倒した！`,
      `経験値 ${m.exp_reward}ポイント 獲得！`,
      `${m.coin_reward}コインを 手に入れた！`,
    ];
    drops.forEach((d) => msgs.push(`${materialNames[d.key] || d.key}を 手に入れた！`));

    const isLast = floorIdx + 1 >= monsters.length;
    if (m.is_boss) {
      const bd = (story.boss_defeat || []).map(formatLine);
      msgs.push(...bd);
    }

    pushMessages(msgs, () => {
      if (isLast) {
        finishRun("victory", monsters.length);
      } else {
        const nextIdx = floorIdx + 1;
        setFloorIdx(nextIdx);
        const next = monsters[nextIdx];
        setMonsterHps(Array.from({ length: next.monster_count ?? 1 }, () => next.hp));
        setBuffs([]); setEnemyDebuffs([]); setDefending(false);
        if (next.is_boss) {
          setBossFlash(true); setTimeout(() => setBossFlash(false), 600);
          const bi = (story.boss_intro || []).map(formatLine);
          pushMessages([...bi, `${next.monster_name}が あらわれた！`], () => setPhase("command"));
        } else {
          pushMessages([`${next.monster_name}が あらわれた！`], () => setPhase("command"));
        }
      }
    });
  };

  const onPlayerDown = () => {
    const hasRevive = (items["revival_leaf"] ?? 0) > 0;
    if (hasRevive) {
      setPhase("revive_prompt");
    } else {
      pushMessages([`あなたは 力尽きた...`], () => finishRun("defeat", floorIdx));
    }
  };

  const useRevive = async () => {
    if (!user) return;
    await consumeItem(user.id, "revival_leaf");
    setItems((s) => ({ ...s, revival_leaf: Math.max(0, (s.revival_leaf ?? 0) - 1) }));
    const nh = Math.floor(maxHp / 2);
    setPlayerHp(nh);
    pushMessages([`蘇りの葉の力で あなたは 蘇った！`], () => setPhase("command"));
  };

  const declineRevive = () => {
    pushMessages([`あなたは 力尽きた...`], () => finishRun("defeat", floorIdx));
  };

  const finishRun = async (res: "victory" | "defeat" | "retreat", floors: number) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const matsArr = Object.entries(accMaterials).map(([key, qty]) => ({ key, qty }));
    try {
      await completeDungeonRun(runId, floors, accExp, accCoins, res, matsArr);
      if (user) await persistMp(user.id, mp.current, mp.max);
      window.dispatchEvent(new Event("avatar-updated"));
      window.dispatchEvent(new Event("stamina-updated"));
    } catch (e: any) {
      toast.error("結果の保存に失敗", { description: e?.message });
    }
    // Grant 30% of dungeon EXP to active companion
    if (user && accExp > 0) {
      const compExp = Math.floor(accExp * 0.3);
      if (compExp > 0) {
        try {
          const { data: cr } = await (supabase as any).rpc("grant_companion_exp", {
            p_user_id: user.id,
            p_exp: compExp,
          });
          if (cr && cr.exp_gained > 0) {
            const cname = cr.companion_name || compNameRef.current;
            toast.success(`おとも（${cname}）も経験値をもらった！`, { description: `+${cr.exp_gained} EXP${cr.evolved ? " ・進化した！" : ""}` });
          }
        } catch (e) {
          // non-fatal
        }
      }
    }
    setResult({
      result: res, floorsCleared: floors, totalFloors: monsters.length,
      totalExp: accExp, totalCoins: accCoins,
      materials: matsArr.map((m) => ({ ...m, name: materialNames[m.key] || m.key })),
    });
  };

  // ---- Render ----
  if (result) {
    return <DungeonResult data={result} onRetry={onFinish} onBack={onClose} />;
  }

  if (phase === "loading" || !stats || !monster || !avatar) {
    return (
      <div className="fixed inset-0 z-[200] bg-black flex items-center justify-center text-white">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const rank = getRankInfo(avatar.level ?? 1, (avatar.gender as any) ?? "male", avatar.hair_color as any);
  const MIcon = MONSTER_ICON[monster.icon_name] || Bug;
  const hpPct = (playerHp / Math.max(1, maxHp)) * 100;
  const mpPct = (mp.current / Math.max(1, mp.max)) * 100;
  const compPct = (compHp / Math.max(1, compMaxHp)) * 100;
  const playerLv = avatar.level ?? 1;
  const lvColor = monster.monster_level > playerLv ? "#fca5a5" : monster.monster_level < playerLv ? "#86efac" : "#ffffff";
  const isTargetSelect = phase === "target_select";

  const showCommand = phase === "command";
  const showSkillMenu = phase === "skill_select";
  const showItemMenu = phase === "item_select";

  const messageContent = currentMsg
    ? shown
    : (msgQueue.length === 0 && showCommand ? "コマンドを 選んでください"
      : msgQueue.length === 0 && isTargetSelect ? "攻撃する相手を 選んでください"
      : "");

  const tappable = !!currentMsg;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col text-white select-none"
      style={{
        background: stage.background_css || "linear-gradient(135deg,#1a1a2e,#16213e)",
        fontFamily: "'Hiragino Sans', 'Yu Gothic', sans-serif",
      }}
      onClick={tappable ? advanceMessage : undefined}
    >
      {/* Background image (with dark overlay for readability) */}
      {!bgImgError && (
        <img
          src={bgImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          onError={() => setBgImgError(true)}
        />
      )}
      <div className="absolute inset-0 pointer-events-none bg-black/50" />

      {hurtFlash && <div className="absolute inset-0 pointer-events-none z-10" style={{ boxShadow: "inset 0 0 100px 20px rgba(239,68,68,0.7)" }} />}
      {critFlash && <div className="absolute inset-0 pointer-events-none z-10 bg-white/40" />}
      {bossFlash && <div className="absolute inset-0 pointer-events-none z-20 bg-red-600/40 animate-pulse" />}

      {/* Header */}
      <div className="relative flex items-center justify-between px-3 py-2 bg-black/40">
        <div>
          <p className="text-[10px] font-bold tracking-wider opacity-70">{stage.stage_name}</p>
          <p className="text-xs font-bold">フロア {floorIdx + 1} / {monsters.length}</p>
        </div>
        <div className="text-[10px] opacity-70">ターン制バトル</div>
      </div>

      {/* Battle field */}
      <div className="relative flex-1 flex flex-col items-center justify-between px-3 py-2 overflow-hidden">
        {/* Monster */}
        <div className={`flex flex-row items-start justify-center gap-3 mt-2 relative ${shake ? "animate-[battle-shake_0.3s]" : ""}`}>
          {monsterHps.map((hp, i) => {
            const pct = (hp / monster.hp) * 100;
            const dead = hp <= 0;
            const size = monsterCount > 1 ? "w-24 h-24" : "w-32 h-32";
            const iconSize = monsterCount > 1 ? "w-16 h-16" : "w-20 h-20";
            const barW = monsterCount > 1 ? "w-28" : "w-48";
            const selectable = isTargetSelect && !dead;
            return (
              <button
                key={i}
                type="button"
                disabled={!selectable}
                onClick={(e) => { if (selectable) { e.stopPropagation(); handleSelectTarget(i); } }}
                className="flex flex-col items-center disabled:cursor-default"
                style={{ opacity: dead ? 0.3 : 1 }}
              >
                <div className="relative">
                  <div
                    className={`${size} rounded-3xl flex items-center justify-center bg-white/10 border-2 overflow-hidden ${selectable ? "border-white animate-pulse" : "border-white/20"}`}
                    style={{ filter: monster.is_boss ? "drop-shadow(0 0 16px rgba(239,68,68,0.7))" : undefined }}
                  >
                    {!monsterImgError[monster.monster_key] ? (
                      <img
                        src={monsterImageUrl}
                        alt={monster.monster_name}
                        className="w-full h-full object-contain"
                        style={{
                          imageRendering: "pixelated",
                          filter: monsterFilter,
                          animation: dead ? "none" : monster.is_boss ? "boss-idle 2s ease-in-out infinite" : "monster-idle 2.5s ease-in-out infinite",
                          animationDelay: `${i * 0.3}s`,
                        }}
                        onError={() => setMonsterImgError((s) => ({ ...s, [monster.monster_key]: true }))}
                      />
                    ) : (
                      <MIcon className={iconSize} style={{ color: monster.is_boss ? "#fbbf24" : "#fff" }} />
                    )}
                  </div>
                  {i === 0 && floats.filter((f) => f.target === "monster").map((f) => (
                    <span key={f.id} className="absolute left-1/2 top-0 -translate-x-1/2 text-xl font-extrabold pointer-events-none"
                      style={{ color: f.color, animation: "battle-float 0.9s ease-out forwards", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
                      {f.text}
                    </span>
                  ))}
                  {i === 0 && spellFx && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="w-32 h-32 rounded-full"
                        style={{
                          background: `radial-gradient(circle, ${spellColor(spellFx.kind)} 0%, transparent 70%)`,
                          animation: "spell-burst 0.7s ease-out forwards",
                        }} />
                    </div>
                  )}
                  {i === 0 && slashFx && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="slash-effect" />
                    </div>
                  )}
                  {i === 0 && critSlashFx && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="crit-slash-1" />
                      <div className="crit-slash-2" />
                    </div>
                  )}
                </div>
                <p className="text-xs font-bold mt-1.5 flex items-center gap-1">
                  <span>{monsterLabel(i)}{monster.is_boss && "（ボス）"}</span>
                  <span style={{ color: lvColor }} className="text-[10px] font-extrabold">Lv.{monster.monster_level}</span>
                </p>
                <div className={`${barW} mt-1`}>
                  <div className="h-2 rounded-full bg-black/50 overflow-hidden border border-white/20">
                    <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: "#ef4444" }} />
                  </div>
                  <p className="text-[10px] text-center opacity-80 mt-0.5">{hp} / {monster.hp}</p>
                </div>
              </button>
            );
          })}
        </div>
        {isTargetSelect && (
          <p className="absolute top-12 left-1/2 -translate-x-1/2 text-xs text-white bg-black/70 px-3 py-1 rounded-full font-bold">
            どちらを攻撃？
          </p>
        )}

        {/* Player + Companion */}
        <div className="flex items-end justify-center gap-4 py-2">
          <div className="relative" style={{ width: 72, height: 72 }}>
            <img src={rank.image} className="w-full h-full object-contain pixel-avatar" onError={handleAvatarImgError} alt="" style={{ animation: "player-idle 3s ease-in-out infinite" }} />
            <EquipmentOverlay gear={gear} zBase={10} />
            {impactFx && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="impact-burst" />
              </div>
            )}
            {floats.filter((f) => f.target === "player").map((f) => (
              <span key={f.id} className="absolute left-1/2 top-0 -translate-x-1/2 text-lg font-extrabold pointer-events-none"
                style={{ color: f.color, animation: "battle-float 0.9s ease-out forwards", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
                {f.text}
              </span>
            ))}
            <p className="text-center text-[9px] text-white/80 mt-0.5">Lv.{avatar.level ?? 1}</p>
          </div>
          {companion && (
            <div className="relative" style={{ width: 56 }}>
              {(() => {
                const CIcon = COMPANION_ICON[companion.icon_name] || Cat;
                const imgSrc = companion.image_path
                  ? `${AVATAR_CDN_BASE}/${companion.image_path}`
                  : `${AVATAR_CDN_BASE}/companions/${companion.companion_key}.png`;
                return (
                  <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
                    <img
                      src={imgSrc}
                      alt={companion.companion_name}
                      className="w-12 h-12 object-contain"
                      style={{ imageRendering: "pixelated" }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                );
              })()}
              <p className="text-center text-[9px] text-white/80 mt-0.5 truncate">{companion.companion_name}</p>
              <div className="w-full h-1 bg-white/20 rounded mt-0.5 overflow-hidden">
                <div className="h-full bg-emerald-400" style={{ width: `${compPct}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Message window */}
      <div className="relative px-3 pt-2">
        <div
          className="relative rounded-lg px-4 py-3 min-h-[72px] text-sm leading-relaxed"
          style={{
            background: "linear-gradient(180deg,#0a0a3a 0%,#050520 100%)",
            border: "3px solid #c0c0e0",
            outline: "2px solid #4040a0",
            fontFamily: "monospace",
          }}
        >
          <p className="whitespace-pre-wrap break-all">{messageContent}</p>
          {waitingTap && currentMsg && (
            <ChevronRight className="absolute bottom-2 right-2 w-4 h-4 text-white animate-pulse" />
          )}
        </div>
      </div>

      {/* Command area */}
      <div className="relative px-3 py-2">
        {showCommand && !currentMsg && (
          <div className="grid grid-cols-2 gap-2">
            <CmdBtn icon={Sword} label="たたかう" onClick={handleAttack} />
            <CmdBtn icon={Sparkles} label="星詠み" onClick={() => setPhase("skill_select")} />
            <CmdBtn icon={ShieldIcon} label="防御する" onClick={handleDefend} />
            <CmdBtn icon={Package} label="道具" onClick={() => setPhase("item_select")} />
          </div>
        )}
        {showSkillMenu && (
          <SubMenu onBack={() => setPhase("command")}>
            {skills.length === 0 && <p className="text-xs text-white/60 px-2 py-3">習得した呪文がありません</p>}
            {skills.map((sk) => {
              const SI = SKILL_ICON[sk.icon_name] || Sparkles;
              const disabled = mp.current < sk.mp_cost;
              return (
                <button key={sk.skill_key} disabled={disabled} onClick={() => handleSkill(sk)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-white border-b border-white/10 last:border-0 disabled:opacity-40 hover:bg-white/10">
                  <span className="flex items-center gap-2"><SI className="w-4 h-4" />{sk.skill_name}</span>
                  <span className="text-[11px] opacity-80">MP{sk.mp_cost}</span>
                </button>
              );
            })}
          </SubMenu>
        )}
        {showItemMenu && (
          <SubMenu onBack={() => setPhase("command")}>
            {Object.entries(items).filter(([, q]) => q > 0).length === 0 && (
              <p className="text-xs text-white/60 px-2 py-3">所持アイテムがありません</p>
            )}
            {Object.entries(items).filter(([, q]) => q > 0).map(([key, qty]) => {
              const it = itemMaster[key];
              if (!it) return null;
              const II = ITEM_ICON[it.icon_name] || Package;
              return (
                <button key={key} onClick={() => handleItem(key)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-white border-b border-white/10 last:border-0 hover:bg-white/10">
                  <span className="flex items-center gap-2"><II className="w-4 h-4" />{it.item_name}</span>
                  <span className="text-[11px] opacity-80">×{qty}</span>
                </button>
              );
            })}
          </SubMenu>
        )}
        {phase === "revive_prompt" && (
          <div className="rounded-lg p-3" style={{ background: "linear-gradient(180deg,#0a0a3a,#050520)", border: "3px solid #c0c0e0" }}>
            <p className="text-sm mb-2">蘇りの葉を 使いますか？</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={useRevive} className="py-2 rounded bg-emerald-600 text-white text-sm font-bold">はい</button>
              <button onClick={declineRevive} className="py-2 rounded bg-white/10 text-white text-sm font-bold">いいえ</button>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="relative flex items-center justify-between px-3 py-2 bg-black/80 border-t border-white/20">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-[9px] text-white/60">HP</p>
            <div className="w-20 h-2 bg-white/20 rounded overflow-hidden">
              <div className="h-full transition-all" style={{ width: `${hpPct}%`, background: hpPct > 50 ? "#4ade80" : hpPct > 25 ? "#facc15" : "#ef4444" }} />
            </div>
            <p className="text-[9px] text-white">{playerHp}/{maxHp}</p>
          </div>
          <div>
            <p className="text-[9px] text-white/60">MP</p>
            <div className="w-16 h-2 bg-white/20 rounded overflow-hidden">
              <div className="h-full bg-blue-400 transition-all" style={{ width: `${mpPct}%` }} />
            </div>
            <p className="text-[9px] text-white">{mp.current}/{mp.max}</p>
          </div>
        </div>
        <button onClick={handleRetreat}
          disabled={phase !== "command"}
          className="text-[10px] text-white/60 hover:text-white disabled:opacity-30 flex items-center gap-1">
          撤退 <X className="w-3 h-3" />
        </button>
      </div>

      <style>{`
        @keyframes battle-shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-8px); } 40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); } 80% { transform: translateX(6px); }
        }
        @keyframes battle-float {
          0% { opacity: 0; transform: translate(-50%,0) scale(0.8); }
          20% { opacity: 1; transform: translate(-50%,-10px) scale(1.1); }
          100% { opacity: 0; transform: translate(-50%,-50px) scale(1); }
        }
        @keyframes spell-burst {
          0% { opacity: 0; transform: scale(0.3); }
          40% { opacity: 1; transform: scale(1.2); }
          100% { opacity: 0; transform: scale(1.6); }
        }
        @keyframes slash-cut {
          0% { opacity: 0; transform: rotate(-45deg) scaleX(0) translateY(20px); }
          30% { opacity: 1; transform: rotate(-45deg) scaleX(1.2) translateY(0); }
          60% { opacity: 0.8; transform: rotate(-45deg) scaleX(1) translateY(-5px); }
          100% { opacity: 0; transform: rotate(-45deg) scaleX(0.8) translateY(-10px); }
        }
        .slash-effect {
          width: 120px;
          height: 6px;
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.9) 30%, rgba(200,220,255,1) 50%, rgba(255,255,255,0.9) 70%, transparent 100%);
          border-radius: 3px;
          animation: slash-cut 0.4s ease-out forwards;
          box-shadow: 0 0 20px 4px rgba(200,220,255,0.6), 0 0 40px 8px rgba(100,150,255,0.3);
        }
        @keyframes crit-slash-1 {
          0% { opacity: 0; transform: rotate(-45deg) scaleX(0); }
          40% { opacity: 1; transform: rotate(-45deg) scaleX(1.3); }
          100% { opacity: 0; transform: rotate(-45deg) scaleX(0.8); }
        }
        @keyframes crit-slash-2 {
          0% { opacity: 0; transform: rotate(45deg) scaleX(0); }
          40% { opacity: 1; transform: rotate(45deg) scaleX(1.3); }
          100% { opacity: 0; transform: rotate(45deg) scaleX(0.8); }
        }
        .crit-slash-1 {
          position: absolute;
          width: 140px;
          height: 6px;
          background: linear-gradient(90deg, transparent 0%, rgba(255,220,100,0.9) 30%, rgba(255,200,50,1) 50%, rgba(255,220,100,0.9) 70%, transparent 100%);
          border-radius: 3px;
          animation: crit-slash-1 0.45s ease-out forwards;
          box-shadow: 0 0 24px 6px rgba(255,200,50,0.7);
        }
        .crit-slash-2 {
          position: absolute;
          width: 140px;
          height: 6px;
          background: linear-gradient(90deg, transparent 0%, rgba(255,220,100,0.9) 30%, rgba(255,200,50,1) 50%, rgba(255,220,100,0.9) 70%, transparent 100%);
          border-radius: 3px;
          animation: crit-slash-2 0.45s 0.1s ease-out forwards;
          box-shadow: 0 0 24px 6px rgba(255,200,50,0.7);
        }
        @keyframes impact-burst {
          0% { opacity: 0; transform: scale(0.2); }
          30% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.5); }
        }
        .impact-burst {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,100,100,0.8) 0%, rgba(255,50,50,0.4) 40%, transparent 70%);
          animation: impact-burst 0.35s ease-out forwards;
        }
        @keyframes monster-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes boss-idle {
          0%, 100% { transform: translateY(0) scale(1); }
          30% { transform: translateY(-8px) scale(1.03); }
          70% { transform: translateY(-4px) scale(0.98); }
        }
        @keyframes player-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
};

const CmdBtn = ({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) => (
  <button onClick={onClick}
    className="flex items-center justify-center gap-2 py-3 rounded-lg text-white text-sm font-bold active:scale-95 transition-transform"
    style={{ background: "linear-gradient(180deg,#0a0a3a,#050520)", border: "2px solid #c0c0e0", outline: "1px solid #4040a0" }}>
    <Icon className="w-4 h-4" />
    {label}
  </button>
);

const SubMenu = ({ children, onBack }: { children: React.ReactNode; onBack: () => void }) => (
  <div className="rounded-lg overflow-hidden" style={{ background: "linear-gradient(180deg,#0a0a3a,#050520)", border: "3px solid #c0c0e0", outline: "2px solid #4040a0" }}>
    <div className="max-h-48 overflow-y-auto">{children}</div>
    <button onClick={onBack} className="w-full py-2 text-xs text-white/80 bg-black/40 border-t border-white/20">もどる</button>
  </div>
);

const spellColor = (key: string): string => {
  if (key.includes("heal")) return "rgba(52,211,153,0.7)";
  if (key === "iron_guard") return "rgba(96,165,250,0.7)";
  if (key === "power_charge") return "rgba(248,113,113,0.7)";
  if (key === "weak_point") return "rgba(168,85,247,0.7)";
  if (key === "thunder_ray") return "rgba(250,204,21,0.8)";
  if (key === "luminas_ray") return "rgba(253,224,71,0.9)";
  if (key === "nova_burst") return "rgba(255,255,255,0.9)";
  if (key === "light_blade") return "rgba(255,255,255,0.85)";
  return "rgba(251,146,60,0.8)";
};

export default DungeonBattle;