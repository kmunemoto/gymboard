// リヴェル村 (30x25)
// タイルID:
// 0=草地, 1=道, 2=水, 3=石壁, 4=木壁, 5=木床, 6=石床, 7=花畑,
// 8=木, 9=岩, 10=屋根, 11=扉, 12=宝箱, 13=看板, 14=石畳, 15=砂地

export type Direction = "up" | "down" | "left" | "right";

export interface MapNPC {
  id: string;
  name: string;
  x: number;
  y: number;
  direction: Direction;
  /** NPCスプライトシート上の列 (0..3) */
  spriteIndex: number;
  /** 画像未ロード時のフォールバック色 */
  color: string;
  dialogues: string[];
  condition?: string;
}

export interface MapWarp {
  x: number; y: number;
  targetMap: string; targetX: number; targetY: number;
}

export interface GameMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tileSize: number;
  layers: {
    ground: number[][];
    objects: number[][];
    collision: number[][];
  };
  encounterRate: number;
  npcs: MapNPC[];
  warps: MapWarp[];
  spawn: { x: number; y: number; direction: Direction };
}

const W = 30;
const H = 25;

const makeGrid = (v: number): number[][] =>
  Array.from({ length: H }, () => Array(W).fill(v));

const ground: number[][] = makeGrid(0);
const objects: number[][] = makeGrid(0);
const collision: number[][] = makeGrid(0);

// 外壁
for (let x = 0; x < W; x++) { collision[0][x] = 1; collision[H - 1][x] = 1; }
for (let y = 0; y < H; y++) { collision[y][0] = 1; collision[y][W - 1] = 1; }
// 南の出口 (3タイル幅)
for (const ex of [14, 15, 16]) {
  collision[H - 1][ex] = 0;
  ground[H - 1][ex] = 14;
}

// 中央の十字石畳道路
for (let y = 1; y < H - 1; y++) { ground[y][14] = 14; ground[y][15] = 14; }
for (let x = 1; x < W - 1; x++) { ground[11][x] = 14; ground[12][x] = 14; }

// 中央広場 (石床)
for (let y = 9; y <= 14; y++) {
  for (let x = 13; x <= 16; x++) ground[y][x] = 6;
}
// 道路を再描画
for (let y = 9; y <= 14; y++) { ground[y][14] = 14; ground[y][15] = 14; }
for (let x = 13; x <= 16; x++) { ground[11][x] = 14; ground[12][x] = 14; }

// 噴水 (広場北東)
for (const [fx, fy] of [[17, 8], [18, 8], [17, 9], [18, 9]] as const) {
  ground[fy][fx] = 2;
  collision[fy][fx] = 1;
}

// 建物配置ヘルパー
const building = (x: number, y: number, w: number, h: number, doorX: number) => {
  for (let i = 0; i < w; i++) ground[y][x + i] = 10;
  for (let j = 1; j < h; j++) {
    for (let i = 0; i < w; i++) ground[y + j][x + i] = 4;
  }
  ground[y + h - 1][x + doorX] = 11;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) collision[y + j][x + i] = 1;
  }
  collision[y + h - 1][x + doorX] = 0;
};

building(3, 3, 4, 3, 1);   // 主人公の家
building(22, 2, 6, 5, 2);  // 村長の家
building(3, 17, 3, 3, 1);  // 武器屋
building(8, 17, 3, 3, 1);  // 道具屋
building(22, 17, 5, 4, 2); // 宿屋

// 木 (衝突あり)
const trees: [number, number][] = [
  [2, 1], [9, 2], [11, 5], [19, 1], [20, 5],
  [1, 8], [10, 8], [19, 8], [27, 9],
  [2, 14], [11, 15], [19, 14], [27, 14],
  [2, 22], [12, 22], [19, 22], [27, 22],
];
for (const [x, y] of trees) { objects[y][x] = 8; collision[y][x] = 1; }

// 花畑 (衝突なし)
const flowers: [number, number][] = [
  [3, 6], [6, 6], [22, 7], [27, 7],
  [4, 16], [9, 16], [22, 16], [26, 16],
  [13, 8], [16, 14], [13, 14],
];
for (const [x, y] of flowers) ground[y][x] = 7;

export const rivelVillage: GameMap = {
  id: "rivel_village",
  name: "リヴェル村",
  width: W,
  height: H,
  tileSize: 32,
  layers: { ground, objects, collision },
  encounterRate: 0,
  spawn: { x: 15, y: 13, direction: "down" },
  npcs: [
    {
      id: "elder",
      name: "村長オルドス",
      x: 24, y: 7,
      direction: "down",
      spriteIndex: 0,
      color: "#e8c840",
      dialogues: [
        "おお、目が覚めたか。",
        "お前の母は…ルミナス王家の末裔だったのだ。",
        "7つの星石を集め、王国を復興させるのがお前の使命じゃ。",
      ],
    },
    {
      id: "girl",
      name: "エリナ",
      x: 16, y: 10,
      direction: "left",
      spriteIndex: 1,
      color: "#ff8090",
      dialogues: [
        "紋章が光ったって本当？すごい！",
        "気をつけてね、応援してる！",
      ],
    },
    {
      id: "hans",
      name: "武器屋のハンス",
      x: 4, y: 20,
      direction: "down",
      spriteIndex: 3,
      color: "#a05030",
      dialogues: [
        "旅に出るのか？これを持っていけ。",
        "鋼の剣だ。お前の役に立つはずだ。",
      ],
    },
    {
      id: "farmer",
      name: "農夫トム",
      x: 8, y: 14,
      direction: "down",
      spriteIndex: 2,
      color: "#8b6f3a",
      dialogues: [
        "最近魔物が増えて困っておる…",
        "畑が荒らされて作物にならんのじゃ。",
      ],
    },
    {
      id: "oldman",
      name: "老人ゼフ",
      x: 15, y: 22,
      direction: "up",
      spriteIndex: 2,
      color: "#a0a0c0",
      dialogues: [
        "南に行くとフィールドに出るぞ。",
        "弱い魔物がおる。修行にちょうどいい。",
      ],
    },
  ],
  warps: [
    { x: 14, y: 24, targetMap: "rivel_field", targetX: 10, targetY: 1 },
    { x: 15, y: 24, targetMap: "rivel_field", targetX: 11, targetY: 1 },
    { x: 16, y: 24, targetMap: "rivel_field", targetX: 12, targetY: 1 },
  ],
};