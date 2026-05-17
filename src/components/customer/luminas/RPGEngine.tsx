import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import type { Direction, GameMap, MapNPC, MapWarp } from "./maps/rivelVillage";
import { rivelVillage } from "./maps/rivelVillage";
import { rivelField } from "./maps/rivelField";

const MAP_REGISTRY: Record<string, GameMap> = {
  rivel_village: rivelVillage,
  rivel_field: rivelField,
};

// === 画像URL (Supabase Storage) ===
const TILESET_URL = "https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/rpg/tileset.png";
const HERO_URL = "https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/rpg/hero_sprite.png";
const NPC_URL = "https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/rpg/npc_sprites.png";

const MOVE_FRAMES = 8;
const TARGET_VIEW_COLS = 11; // 横に表示したいタイル数
const DPAD_RESERVED_PX = 220; // DPad領域の高さ

const TILE_POS: Record<number, [number, number]> = {
  0: [0, 0], 1: [1, 0], 2: [2, 0], 3: [3, 0],
  4: [0, 1], 5: [1, 1], 6: [2, 1], 7: [3, 1],
  8: [0, 2], 9: [1, 2], 10: [2, 2], 11: [3, 2],
  12: [0, 3], 13: [1, 3], 14: [2, 3], 15: [3, 3],
};

const FALLBACK_TILE_COLOR: Record<number, string> = {
  0: "#4a8f3f", 1: "#c4a55a", 2: "#3a7ecf", 3: "#7a7a7a",
  4: "#8b5e3c", 5: "#d4a76a", 6: "#a0a0a0", 7: "#5aaf4f",
  8: "#2d6b2d", 9: "#5a5a5a", 10: "#c04040", 11: "#6b4226",
  12: "#d4a017", 13: "#8b5e3c", 14: "#8a8a8a", 15: "#e6d29a",
};

const DIR_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };

interface PlayerState {
  x: number; y: number;
  // タイル単位の補間 (-1..+1)
  pxOffsetX: number; pxOffsetY: number;
  direction: Direction;
  isMoving: boolean;
}

interface DialogueState {
  npc: MapNPC;
  index: number;
  displayedText: string;
  charIndex: number;
  fullyDisplayed: boolean;
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed: " + src));
    img.src = src;
  });

interface Props {
  map: GameMap;
  onExit: () => void;
}

const RPGEngine = ({ map, onExit }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [currentMap, setCurrentMap] = useState<GameMap>(map);
  const [fadeState, setFadeState] = useState<"none" | "fadeOut" | "fadeIn">("none");
  const [fadeOpacity, setFadeOpacity] = useState(0);
  const warpingRef = useRef(false);

  const playerRef = useRef<PlayerState>({
    x: map.spawn.x,
    y: map.spawn.y,
    pxOffsetX: 0,
    pxOffsetY: 0,
    direction: map.spawn.direction,
    isMoving: false,
  });
  const moveStepRef = useRef(0);
  const heldDirRef = useRef<Direction | null>(null);
  const walkPhaseRef = useRef(0);

  const tilesetRef = useRef<HTMLImageElement | null>(null);
  const heroRef = useRef<HTMLImageElement | null>(null);
  const npcRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [, force] = useState(0);
  const tickForce = () => force((v) => v + 1);

  const [dialogue, setDialogue] = useState<DialogueState | null>(null);
  const [arrowBlink, setArrowBlink] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  // === 画面サイズ追従 ===
  const [screenSize, setScreenSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setScreenSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  const canvasWidth = screenSize.w;
  const canvasHeight = Math.max(160, screenSize.h - DPAD_RESERVED_PX);
  const SCALE = Math.max(16, Math.floor(canvasWidth / TARGET_VIEW_COLS));
  const viewCols = Math.max(1, Math.floor(canvasWidth / SCALE));
  const viewRows = Math.max(1, Math.floor(canvasHeight / SCALE));

  // === 画像プリロード ===
  useEffect(() => {
    let alive = true;
    Promise.all([loadImage(TILESET_URL), loadImage(HERO_URL), loadImage(NPC_URL)])
      .then(([t, h, n]) => {
        if (!alive) return;
        tilesetRef.current = t;
        heroRef.current = h;
        npcRef.current = n;
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setLoaded(true);
      });
    return () => { alive = false; };
  }, []);

  // === 衝突判定 ===
  const isBlocked = useCallback((tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= currentMap.width || ty >= currentMap.height) return true;
    if (currentMap.layers.collision[ty][tx] === 1) return true;
    if (currentMap.npcs.some((n) => n.x === tx && n.y === ty)) return true;
    return false;
  }, [currentMap]);

  const facingTile = useCallback((p: PlayerState): [number, number] => {
    let nx = p.x, ny = p.y;
    if (p.direction === "up") ny -= 1;
    else if (p.direction === "down") ny += 1;
    else if (p.direction === "left") nx -= 1;
    else if (p.direction === "right") nx += 1;
    return [nx, ny];
  }, []);

  const tryMove = useCallback((dir: Direction) => {
    const p = playerRef.current;
    if (p.isMoving || dialogue || menuOpen || warpingRef.current) return;
    p.direction = dir;
    let nx = p.x, ny = p.y;
    if (dir === "up") ny -= 1;
    else if (dir === "down") ny += 1;
    else if (dir === "left") nx -= 1;
    else if (dir === "right") nx += 1;
    if (isBlocked(nx, ny)) {
      tickForce();
      return;
    }
    p.isMoving = true;
    moveStepRef.current = 0;
  }, [isBlocked, dialogue, menuOpen]);

  // === Aボタン ===
  const handleAction = useCallback(() => {
    if (menuOpen) return;
    if (dialogue) {
      // 1. まだ表示中ならテキスト全表示
      if (!dialogue.fullyDisplayed) {
        const msg = dialogue.npc.dialogues[dialogue.index];
        setDialogue({ ...dialogue, displayedText: msg, charIndex: msg.length, fullyDisplayed: true });
        return;
      }
      // 2. 全表示済みなら次へ
      const next = dialogue.index + 1;
      if (next >= dialogue.npc.dialogues.length) {
        setDialogue(null);
      } else {
        setDialogue({
          npc: dialogue.npc,
          index: next,
          displayedText: "",
          charIndex: 0,
          fullyDisplayed: false,
        });
      }
      return;
    }
    const p = playerRef.current;
    const [fx, fy] = facingTile(p);
    const npc = currentMap.npcs.find((n) => n.x === fx && n.y === fy);
    if (npc) {
      setDialogue({
        npc,
        index: 0,
        displayedText: "",
        charIndex: 0,
        fullyDisplayed: false,
      });
    }
  }, [dialogue, menuOpen, facingTile, currentMap.npcs]);

  // === ワープ処理 ===
  const doWarp = useCallback(async (warp: MapWarp) => {
    if (warpingRef.current) return;
    warpingRef.current = true;
    heldDirRef.current = null;
    setFadeState("fadeOut");
    setFadeOpacity(0);
    // 次フレームでopacityを1に上げてトランジション開始
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    setFadeOpacity(1);
    await new Promise((r) => setTimeout(r, 350));
    const nextMap = MAP_REGISTRY[warp.targetMap];
    if (!nextMap) {
      warpingRef.current = false;
      setFadeState("none");
      setFadeOpacity(0);
      return;
    }
    setCurrentMap(nextMap);
    playerRef.current.x = warp.targetX;
    playerRef.current.y = warp.targetY;
    playerRef.current.pxOffsetX = 0;
    playerRef.current.pxOffsetY = 0;
    playerRef.current.isMoving = false;
    moveStepRef.current = 0;
    setFadeState("fadeIn");
    setFadeOpacity(0);
    await new Promise((r) => setTimeout(r, 350));
    setFadeState("none");
    warpingRef.current = false;
  }, []);

  const checkWarp = useCallback((x: number, y: number) => {
    const w = currentMap.warps.find((wp) => wp.x === x && wp.y === y);
    if (w) doWarp(w);
  }, [currentMap, doWarp]);

  // === タイプライター ===
  useEffect(() => {
    if (!dialogue || dialogue.fullyDisplayed) return;
    const msg = dialogue.npc.dialogues[dialogue.index];
    if (dialogue.charIndex >= msg.length) {
      setDialogue((prev) => (prev ? { ...prev, fullyDisplayed: true } : null));
      return;
    }
    const timer = setTimeout(() => {
      setDialogue((prev) => {
        if (!prev) return null;
        const next = prev.charIndex + 1;
        return { ...prev, displayedText: msg.slice(0, next), charIndex: next };
      });
    }, 30);
    return () => clearTimeout(timer);
  }, [dialogue]);

  // === ▶ 点滅 ===
  useEffect(() => {
    if (!dialogue?.fullyDisplayed) return;
    const t = setInterval(() => setArrowBlink((v) => !v), 500);
    return () => clearInterval(t);
  }, [dialogue?.fullyDisplayed]);

  // === 描画ループ ===
  useEffect(() => {
    if (!loaded) return;
    let raf = 0;
    const loop = () => {
      const canvas = canvasRef.current;
      if (!canvas) { raf = requestAnimationFrame(loop); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { raf = requestAnimationFrame(loop); return; }

      const p = playerRef.current;

      if (p.isMoving) {
        moveStepRef.current += 1;
        const t = moveStepRef.current / MOVE_FRAMES;
        const dx = p.direction === "left" ? -1 : p.direction === "right" ? 1 : 0;
        const dy = p.direction === "up" ? -1 : p.direction === "down" ? 1 : 0;
        p.pxOffsetX = dx * t;
        p.pxOffsetY = dy * t;
        if (moveStepRef.current >= MOVE_FRAMES) {
          p.x += dx; p.y += dy;
          p.pxOffsetX = 0; p.pxOffsetY = 0;
          p.isMoving = false;
          walkPhaseRef.current = (walkPhaseRef.current + 1) % 2;
          checkWarp(p.x, p.y);
          const held = heldDirRef.current;
          if (held && !dialogue && !menuOpen && !warpingRef.current) {
            p.direction = held;
            let nx = p.x, ny = p.y;
            if (held === "up") ny -= 1;
            else if (held === "down") ny += 1;
            else if (held === "left") nx -= 1;
            else if (held === "right") nx += 1;
            if (!isBlocked(nx, ny)) {
              p.isMoving = true;
              moveStepRef.current = 0;
            }
          }
        }
      }

      // カメラ (タイル単位)
      const cssW = canvasWidth;
      const cssH = canvasHeight;
      const playerWorldPxX = (p.x + p.pxOffsetX) * SCALE + SCALE / 2;
      const playerWorldPxY = (p.y + p.pxOffsetY) * SCALE + SCALE / 2;
      const mapPxW = currentMap.width * SCALE;
      const mapPxH = currentMap.height * SCALE;
      let camX: number;
      let camY: number;
      if (mapPxW <= cssW) {
        camX = -(cssW - mapPxW) / 2;
      } else {
        camX = Math.max(0, Math.min(playerWorldPxX - cssW / 2, mapPxW - cssW));
      }
      if (mapPxH <= cssH) {
        camY = -(cssH - mapPxH) / 2;
      } else {
        camY = Math.max(0, Math.min(playerWorldPxY - cssH / 2, mapPxH - cssH));
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cssW, cssH);

      const startTx = Math.max(0, Math.floor(camX / SCALE));
      const startTy = Math.max(0, Math.floor(camY / SCALE));
      const endTx = Math.min(currentMap.width, startTx + viewCols + 2);
      const endTy = Math.min(currentMap.height, startTy + viewRows + 2);

      const tileImg = tilesetRef.current;
      const srcTile = tileImg ? Math.floor(tileImg.width / 4) : 32;
      const drawTile = (id: number, sx: number, sy: number) => {
        const pos = TILE_POS[id];
        if (tileImg && pos) {
          ctx.drawImage(tileImg, pos[0] * srcTile, pos[1] * srcTile, srcTile, srcTile, sx, sy, SCALE, SCALE);
        } else {
          const c = FALLBACK_TILE_COLOR[id];
          if (c) {
            ctx.fillStyle = c;
            ctx.fillRect(sx, sy, SCALE, SCALE);
          }
        }
      };

      for (let ty = startTy; ty < endTy; ty++) {
        for (let tx = startTx; tx < endTx; tx++) {
          const sx = tx * SCALE - camX;
          const sy = ty * SCALE - camY;
          drawTile(currentMap.layers.ground[ty][tx], sx, sy);
          const o = currentMap.layers.objects[ty][tx];
          if (o) drawTile(o, sx, sy);
        }
      }

      const npcImg = npcRef.current;
      const npcSrcW = npcImg ? Math.floor(npcImg.width / 4) : 32;
      const npcSrcH = npcImg ? npcImg.height : 32;
      for (const npc of currentMap.npcs) {
        if (npc.x < startTx - 1 || npc.x > endTx || npc.y < startTy - 1 || npc.y > endTy) continue;
        const sx = npc.x * SCALE - camX;
        const sy = npc.y * SCALE - camY;
        if (npcImg) {
          ctx.drawImage(npcImg, npc.spriteIndex * npcSrcW, 0, npcSrcW, npcSrcH, sx, sy, SCALE, SCALE);
        } else {
          ctx.fillStyle = npc.color;
          ctx.fillRect(sx + SCALE * 0.25, sy + SCALE * 0.12, SCALE * 0.5, SCALE * 0.75);
        }
      }

      const px = (p.x + p.pxOffsetX) * SCALE - camX;
      const py = (p.y + p.pxOffsetY) * SCALE - camY;
      const heroImg = heroRef.current;
      if (heroImg) {
        const heroSrcW = Math.floor(heroImg.width / 3);
        const heroSrcH = Math.floor(heroImg.height / 4);
        let frameCol = 0;
        if (p.isMoving) {
          const half = MOVE_FRAMES / 2;
          frameCol = moveStepRef.current < half ? 1 : 2;
          if (walkPhaseRef.current === 1) frameCol = frameCol === 1 ? 2 : 1;
        }
        const row = DIR_ROW[p.direction];
        ctx.drawImage(heroImg, frameCol * heroSrcW, row * heroSrcH, heroSrcW, heroSrcH, px, py, SCALE, SCALE);
      } else {
        ctx.fillStyle = "#1e3a8a";
        ctx.fillRect(px + SCALE * 0.25, py + SCALE * 0.45, SCALE * 0.5, SCALE * 0.45);
        ctx.fillStyle = "#f4c894";
        ctx.fillRect(px + SCALE * 0.3, py + SCALE * 0.12, SCALE * 0.4, SCALE * 0.4);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [loaded, currentMap, SCALE, viewCols, viewRows, canvasWidth, canvasHeight, isBlocked, dialogue, menuOpen, checkWarp]);

  // Canvas DPR
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }
  }, [canvasWidth, canvasHeight]);

  // キーボード
  useEffect(() => {
    const keyToDir = (k: string): Direction | null => {
      if (k === "ArrowUp" || k === "w") return "up";
      if (k === "ArrowDown" || k === "s") return "down";
      if (k === "ArrowLeft" || k === "a") return "left";
      if (k === "ArrowRight" || k === "d") return "right";
      return null;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "z") {
        e.preventDefault();
        handleAction();
        return;
      }
      if (e.key === "Escape") {
        if (dialogue) setDialogue(null);
        else setMenuOpen((v) => !v);
        return;
      }
      const d = keyToDir(e.key);
      if (!d) return;
      e.preventDefault();
      heldDirRef.current = d;
      tryMove(d);
    };
    const onUp = (e: KeyboardEvent) => {
      const d = keyToDir(e.key);
      if (d && heldDirRef.current === d) heldDirRef.current = null;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [tryMove, handleAction, dialogue]);

  const pressDir = (d: Direction) => { heldDirRef.current = d; tryMove(d); };
  const releaseDir = (d: Direction) => { if (heldDirRef.current === d) heldDirRef.current = null; };

  const dirBtn = "w-14 h-14 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center active:bg-white/40 touch-none select-none";
  const dirHandlers = (d: Direction) => ({
    onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); pressDir(d); },
    onTouchEnd: (e: React.TouchEvent) => { e.preventDefault(); releaseDir(d); },
    onMouseDown: () => pressDir(d),
    onMouseUp: () => releaseDir(d),
    onMouseLeave: () => releaseDir(d),
  });

  return (
    <div className="fixed inset-0 z-[100] bg-black overflow-hidden select-none" style={{ touchAction: "none" }}>
      {/* Canvas (画面いっぱい・上端に配置) */}
      <div className="absolute top-0 left-0 right-0" style={{ width: canvasWidth, height: canvasHeight }}>
        {!loaded ? (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-white/70 text-sm">Loading...</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            style={{
              width: canvasWidth,
              height: canvasHeight,
              imageRendering: "pixelated",
              display: "block",
            }}
          />
        )}
      </div>

      {/* 上部バー (Canvas の上に重ねる) */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
        <p className="text-xs text-white/90 font-bold break-all drop-shadow">{currentMap.name}</p>
        <button
          onClick={() => setMenuOpen(true)}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur flex items-center justify-center active:bg-white/40"
          aria-label="メニュー"
        >
          <Menu className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* ダイアログ */}
      {dialogue && (
        <div
          className="absolute left-2 right-2 z-20 bg-black/85 border-2 border-white/40 rounded-lg p-3 cursor-pointer"
          style={{ bottom: DPAD_RESERVED_PX - 16 }}
          onClick={handleAction}
        >
          <p className="text-[11px] text-yellow-300 font-bold mb-1 break-all">{dialogue.npc.name}</p>
          <p className="text-sm text-white leading-relaxed break-all min-h-[3.5rem]">
            {dialogue.displayedText}
          </p>
          <p className="text-[11px] text-white/70 mt-1 text-right h-4">
            {dialogue.fullyDisplayed && (arrowBlink ? "▶" : " ")}
          </p>
        </div>
      )}

      {/* フェードオーバーレイ */}
      {fadeState !== "none" && (
        <div
          className="absolute inset-0 bg-black z-40 pointer-events-none transition-opacity duration-300"
          style={{ opacity: fadeOpacity }}
        />
      )}

      {/* DPad + Aボタン */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10" style={{ touchAction: "none" }}>
        <div className="relative" style={{ width: 168, height: 168 }}>
          <button {...dirHandlers("up")} className={`absolute top-0 left-1/2 -translate-x-1/2 ${dirBtn}`} aria-label="上">
            <ChevronUp className="w-7 h-7 text-white" />
          </button>
          <button {...dirHandlers("down")} className={`absolute bottom-0 left-1/2 -translate-x-1/2 ${dirBtn}`} aria-label="下">
            <ChevronDown className="w-7 h-7 text-white" />
          </button>
          <button {...dirHandlers("left")} className={`absolute left-0 top-1/2 -translate-y-1/2 ${dirBtn}`} aria-label="左">
            <ChevronLeft className="w-7 h-7 text-white" />
          </button>
          <button {...dirHandlers("right")} className={`absolute right-0 top-1/2 -translate-y-1/2 ${dirBtn}`} aria-label="右">
            <ChevronRight className="w-7 h-7 text-white" />
          </button>
          <button
            onTouchStart={(e) => { e.preventDefault(); handleAction(); }}
            onMouseDown={() => handleAction()}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-amber-500/70 backdrop-blur flex items-center justify-center text-white font-bold text-lg active:bg-amber-500 touch-none select-none"
            aria-label="決定"
          >
            A
          </button>
        </div>
      </div>

      {/* メニュー */}
      {menuOpen && (
        <div className="absolute inset-0 z-30 bg-black/80 flex items-center justify-center px-6">
          <div className="w-full max-w-xs bg-zinc-900 border-2 border-white/30 rounded-xl p-4 space-y-1">
            <div className="flex items-center justify-between mb-2">
              <p className="text-white font-bold text-sm">メニュー</p>
              <button
                onClick={() => setMenuOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center"
                aria-label="閉じる"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
            <button disabled className="w-full text-left px-3 py-2 text-sm text-white/40 rounded-lg">つよさ (準備中)</button>
            <button disabled className="w-full text-left px-3 py-2 text-sm text-white/40 rounded-lg">もちもの (準備中)</button>
            <button disabled className="w-full text-left px-3 py-2 text-sm text-white/40 rounded-lg">そうび (準備中)</button>
            <button disabled className="w-full text-left px-3 py-2 text-sm text-white/40 rounded-lg">セーブ (準備中)</button>
            <div className="h-px bg-white/20 my-2" />
            <button
              onClick={onExit}
              className="w-full text-left px-3 py-2 text-sm text-white bg-red-600/80 rounded-lg active:bg-red-600"
            >
              アプリに戻る
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RPGEngine;
