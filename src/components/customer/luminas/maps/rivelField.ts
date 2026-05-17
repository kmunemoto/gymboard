// はじまりの丘 (25x20) — リヴェル村南のフィールドマップ
import type { GameMap } from "./rivelVillage";

const W = 25;
const H = 20;

const makeGrid = (v: number): number[][] =>
  Array.from({ length: H }, () => Array(W).fill(v));

const ground: number[][] = makeGrid(0);
const objects: number[][] = makeGrid(0);
const collision: number[][] = makeGrid(0);

// 外周は基本通行不可 (上辺3タイル開口、下辺中央3タイル開口)
for (let x = 0; x < W; x++) { collision[0][x] = 1; collision[H - 1][x] = 1; }
for (let y = 0; y < H; y++) { collision[y][0] = 1; collision[y][W - 1] = 1; }

// 北側出入口 (リヴェル村方向)
for (const ex of [10, 11, 12]) {
  collision[0][ex] = 0;
  ground[0][ex] = 14;
  ground[1][ex] = 14;
  ground[2][ex] = 14;
}

// 左右の森壁 (木を密集) — 内側にも木を並べる
for (let y = 1; y < H - 1; y++) {
  for (const fx of [1, 2]) {
    objects[y][fx] = 8;
    collision[y][fx] = 1;
  }
  for (const fx of [W - 2, W - 3]) {
    objects[y][fx] = 8;
    collision[y][fx] = 1;
  }
}

// 散在する木
const trees: [number, number][] = [
  [5, 4], [8, 6], [16, 5], [19, 7],
  [4, 11], [17, 12], [20, 14],
  [6, 16], [14, 17],
];
for (const [x, y] of trees) { objects[y][x] = 8; collision[y][x] = 1; }

// 花畑
const flowers: [number, number][] = [
  [7, 4], [13, 5], [9, 8], [15, 9], [11, 11], [6, 13], [18, 13], [10, 15], [13, 16],
];
for (const [x, y] of flowers) ground[y][x] = 7;

// 岩
const rocks: [number, number][] = [
  [4, 7], [18, 4], [7, 12], [16, 15], [21, 11],
];
for (const [x, y] of rocks) { objects[y][x] = 9; collision[y][x] = 1; }

// 下端: 丘の頂上 (砂地) と道
for (let x = 9; x <= 13; x++) ground[H - 2][x] = 15;
ground[H - 2][11] = 14;

export const rivelField: GameMap = {
  id: "rivel_field",
  name: "はじまりの丘",
  width: W,
  height: H,
  tileSize: 32,
  layers: { ground, objects, collision },
  encounterRate: 0.08,
  spawn: { x: 11, y: 1, direction: "down" },
  npcs: [
    {
      id: "signpost",
      name: "看板",
      x: 13, y: 2,
      direction: "down",
      spriteIndex: 3,
      color: "#8b5e3c",
      dialogues: ["北: リヴェル村  南: はじまりの丘"],
    },
  ],
  warps: [
    { x: 10, y: 0, targetMap: "rivel_village", targetX: 14, targetY: 23 },
    { x: 11, y: 0, targetMap: "rivel_village", targetX: 15, targetY: 23 },
    { x: 12, y: 0, targetMap: "rivel_village", targetX: 16, targetY: 23 },
  ],
};