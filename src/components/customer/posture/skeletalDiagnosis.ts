import type { Keypoint, SkeletalDiagnosis, SkeletalType } from "./types";

const MIN_SCORE = 0.2;

// BlazePose 33 keypoint indices
const BP = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

function valid(kp: Keypoint | undefined): kp is Keypoint {
  return !!kp && (kp.score ?? 1) >= MIN_SCORE;
}

function dist(a: Keypoint, b: Keypoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function mid(a: Keypoint, b: Keypoint): Keypoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Diagnose skeletal type (Straight / Wave / Natural) from BlazePose 33 keypoints.
 * Uses shoulder-hip ratio, upper/lower body proportion, and limb-torso ratio.
 */
export function diagnoseSkeletalType(
  keypoints: Keypoint[],
  imgNatHeight: number
): SkeletalDiagnosis | null {
  const ls = keypoints[BP.LEFT_SHOULDER];
  const rs = keypoints[BP.RIGHT_SHOULDER];
  const lh = keypoints[BP.LEFT_HIP];
  const rh = keypoints[BP.RIGHT_HIP];
  const lk = keypoints[BP.LEFT_KNEE];
  const rk = keypoints[BP.RIGHT_KNEE];
  const la = keypoints[BP.LEFT_ANKLE];
  const ra = keypoints[BP.RIGHT_ANKLE];
  const le = keypoints[BP.LEFT_ELBOW];
  const re = keypoints[BP.RIGHT_ELBOW];
  const lw = keypoints[BP.LEFT_WRIST];
  const rw = keypoints[BP.RIGHT_WRIST];

  // Require at least shoulders and hips
  if (!valid(ls) || !valid(rs) || !valid(lh) || !valid(rh)) return null;
  const hasAnkles = valid(la) && valid(ra);
  const hasKnees = valid(lk) && valid(rk);

  const shoulderMid = mid(ls, rs);
  const hipMid = mid(lh, rh);

  const shoulderWidth = dist(ls, rs);
  const hipWidth = dist(lh, rh);
  const shoulderHipRatio = shoulderWidth / hipWidth;

  // Upper body = shoulder midpoint to hip midpoint
  const upperLen = dist(shoulderMid, hipMid);

  // Lower body = hip midpoint to ankle midpoint (or knee if ankles missing)
  let lowerLen = upperLen; // fallback to equal
  if (hasAnkles) {
    const ankleMid = mid(la, ra);
    lowerLen = dist(hipMid, ankleMid);
  } else if (hasKnees) {
    const kneeMid = mid(lk, rk);
    lowerLen = dist(hipMid, kneeMid) * 2; // estimate full leg from thigh
  }
  const totalLen = upperLen + lowerLen;
  const upperBodyRatio = totalLen > 0 ? upperLen / totalLen : 0.5;

  // Limb-to-torso ratio (arm length / torso length)
  let limbTorsoRatio = 1.0;
  if (valid(le) && valid(re) && valid(lw) && valid(rw)) {
    const leftArm = dist(ls, le) + dist(le, lw);
    const rightArm = dist(rs, re) + dist(re, rw);
    const avgArm = (leftArm + rightArm) / 2;
    limbTorsoRatio = upperLen > 0 ? avgArm / upperLen : 1.0;
  }

  // --- Scoring ---
  let straightScore = 0;
  let waveScore = 0;
  let naturalScore = 0;

  // 1) Shoulder-hip ratio
  // Straight: shoulders ≈ hips or slightly wider, compact frame
  // Wave: narrower shoulders relative to hips
  // Natural: wider overall frame
  if (shoulderHipRatio > 1.15) {
    straightScore += 30;
    naturalScore += 20;
  } else if (shoulderHipRatio < 0.95) {
    waveScore += 35;
  } else {
    straightScore += 20;
    naturalScore += 15;
    waveScore += 10;
  }

  // 2) Upper body ratio (center of gravity proxy)
  // Straight: higher CoG → shorter upper body relative to lower
  // Wave: lower CoG → longer upper body / shorter legs
  if (upperBodyRatio < 0.38) {
    // Short torso / long legs → higher CoG
    straightScore += 35;
  } else if (upperBodyRatio > 0.44) {
    // Long torso / shorter legs → lower CoG
    waveScore += 35;
  } else {
    naturalScore += 25;
    straightScore += 10;
    waveScore += 10;
  }

  // 3) Limb-to-torso ratio
  // Natural: longer limbs relative to torso
  // Straight: proportional
  // Wave: shorter limbs
  if (limbTorsoRatio > 1.15) {
    naturalScore += 35;
  } else if (limbTorsoRatio < 0.9) {
    waveScore += 25;
    straightScore += 10;
  } else {
    straightScore += 20;
    naturalScore += 15;
  }

  const total = straightScore + waveScore + naturalScore;
  const scores = {
    straight: total > 0 ? Math.round((straightScore / total) * 100) : 33,
    wave: total > 0 ? Math.round((waveScore / total) * 100) : 33,
    natural: total > 0 ? Math.round((naturalScore / total) * 100) : 34,
  };

  let type: SkeletalType = "straight";
  let confidence = scores.straight;
  if (scores.wave > confidence) {
    type = "wave";
    confidence = scores.wave;
  }
  if (scores.natural > confidence) {
    type = "natural";
    confidence = scores.natural;
  }

  return {
    type,
    confidence,
    scores,
    metrics: {
      shoulderWidth,
      hipWidth,
      shoulderHipRatio: Math.round(shoulderHipRatio * 100) / 100,
      upperBodyRatio: Math.round(upperBodyRatio * 100) / 100,
      limbTorsoRatio: Math.round(limbTorsoRatio * 100) / 100,
    },
  };
}
