export type Keypoint = { x: number; y: number; z?: number; score?: number; name?: string };

export type PostureFeedbackSeverity = "good" | "warning" | "bad";

/**
 * 姿勢の指摘カテゴリ。**翻訳されない安定キー。**
 *
 * ⚠️ **表示文字列を照合キーに使わないこと。**
 * 以前は `TrainingRecommendationCard` が日本語のカテゴリ名
 * （"頭部の前傾（ストレートネック）" 等）を連想配列のキーにして推奨種目を引いていた。
 * その状態で文言を i18n 化して業種オーバーレイで差し替えると、
 * **照合が黙って外れ、エラーも出ないまま推奨だけが消える。**
 * （ピラボードの指摘。E を i18n 化する前にこのキーを入れるのが順序）
 */
export type PostureCategoryKey =
  | "forwardHead"
  | "shoulderTilt"
  | "roundedBack"
  | "pelvicTilt"
  | "legAlignment"
  | "weightShift"
  | "overall";

/** 左右を指す語。`posture.analysis.sides.*` に対応 */
export type PostureSideKey = "leftShoulder" | "rightShoulder" | "left" | "right";

/**
 * 姿勢解析エンジンの指摘1件。
 *
 * **エンジンは文言を持たない。** キーだけを返し、翻訳は表示側で行う
 * （`PostureFeedbackCard` / `TrainingRecommendationCard`）。
 * こうするとエンジンが純粋な計算に戻り、文言の差し替えがコードに影響しない。
 *
 * ⚠️ 業種フォークでは「ルーマニアンデッドリフト」「フェイスプル」のように
 * **器具（バーベル・ケーブル）が要る種目**がそのままお客様に出ていた。
 * 語彙オーバーレイはロケールに載っている文言しか差し替えられないので、
 * エンジンに直書きされていると届かない。
 */
export type PostureFeedback = {
  type: "good" | "warning";
  severity: PostureFeedbackSeverity;
  /** 翻訳しない安定キー。推奨種目の照合はこれで行う */
  categoryKey: PostureCategoryKey;
  /** `posture.analysis.messages.*` のキー */
  messageKey: string;
  /** メッセージ中の `{{side}}` に入れる語のキー */
  sideKey?: PostureSideKey;
  /** `posture.analysis.exercises.*` のキー */
  exerciseKeys?: string[];
};

export type SkeletalType = "straight" | "wave" | "natural";

export type SkeletalDiagnosis = {
  type: SkeletalType;
  confidence: number; // 0-100
  scores: {
    straight: number;
    wave: number;
    natural: number;
  };
  metrics: {
    shoulderWidth: number;
    hipWidth: number;
    shoulderHipRatio: number;
    upperBodyRatio: number;
    limbTorsoRatio: number;
  };
};
