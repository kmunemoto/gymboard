export type Keypoint = { x: number; y: number; z?: number; score?: number; name?: string };

export type PostureFeedbackSeverity = "good" | "warning" | "bad";

export type PostureFeedback = {
  type: "good" | "warning";
  severity: PostureFeedbackSeverity;
  category: string;
  message: string;
  exercises?: string[];
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
