import type { Keypoint, PostureFeedback } from "./types";

const MIN_SCORE = 0.2;

const KP = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

function isValid(kp: Keypoint | undefined): kp is Keypoint {
  return !!kp && (kp.score ?? 1) >= MIN_SCORE;
}

function relDiff(a: Keypoint, b: Keypoint, imgH: number) {
  return (a.y - b.y) / imgH;
}

function angle(a: Keypoint, b: Keypoint, c: Keypoint): number {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const cross = ab.x * cb.y - ab.y * cb.x;
  return Math.atan2(cross, dot) * (180 / Math.PI);
}

export function analyzePosture(
  keypoints: Keypoint[],
  imgH: number
): { feedbacks: PostureFeedback[]; score: number } {
  const feedbacks: PostureFeedback[] = [];
  const THRESHOLD = 0.03;
  let deductions = 0;

  const ls = keypoints[KP.LEFT_SHOULDER];
  const rs = keypoints[KP.RIGHT_SHOULDER];
  const lh = keypoints[KP.LEFT_HIP];
  const rh = keypoints[KP.RIGHT_HIP];
  const le = keypoints[KP.LEFT_EAR];
  const re = keypoints[KP.RIGHT_EAR];
  const nose = keypoints[KP.NOSE];
  const lk = keypoints[KP.LEFT_KNEE];
  const rk = keypoints[KP.RIGHT_KNEE];
  const la = keypoints[KP.LEFT_ANKLE];
  const ra = keypoints[KP.RIGHT_ANKLE];

  // --- 1. Forward head (straight neck) ---
  if (isValid(le) && isValid(re) && isValid(ls) && isValid(rs)) {
    const earMidX = (le.x + re.x) / 2;
    const shoulderMidX = (ls.x + rs.x) / 2;
    const earMidY = (le.y + re.y) / 2;
    const shoulderMidY = (ls.y + rs.y) / 2;
    const forwardShift = (earMidX - shoulderMidX) / imgH;
    const vertDist = (shoulderMidY - earMidY) / imgH;

    if (vertDist < 0.06) {
      feedbacks.push({
        type: "warning",
        severity: "bad",
        categoryKey: "forwardHead",
        messageKey: "forwardHeadBad",
        exerciseKeys: ["chinTuck", "neckStretch", "scmRelease"],
      });
      deductions += 15;
    } else if (Math.abs(forwardShift) > 0.02) {
      feedbacks.push({
        type: "warning",
        severity: "warning",
        categoryKey: "forwardHead",
        messageKey: "forwardHeadWarning",
        exerciseKeys: ["chinTuck"],
      });
      deductions += 8;
    } else {
      feedbacks.push({
        type: "good",
        severity: "good",
        categoryKey: "forwardHead",
        messageKey: "forwardHeadGood",
      });
    }
  }

  // --- 2. Shoulder level ---
  if (isValid(ls) && isValid(rs)) {
    const diff = relDiff(ls, rs, imgH);
    if (Math.abs(diff) > THRESHOLD * 2) {
      const sideKey = diff > 0 ? "leftShoulder" : "rightShoulder";
      feedbacks.push({
        type: "warning",
        severity: "bad",
        categoryKey: "shoulderTilt",
        messageKey: "shoulderTiltBad", sideKey,
        exerciseKeys: ["shrugWeakSide", "sidePlank"],
      });
      deductions += 15;
    } else if (Math.abs(diff) > THRESHOLD) {
      const sideKey = diff > 0 ? "leftShoulder" : "rightShoulder";
      feedbacks.push({
        type: "warning",
        severity: "warning",
        categoryKey: "shoulderTilt",
        messageKey: "shoulderTiltWarning", sideKey,
      });
      deductions += 8;
    } else {
      feedbacks.push({
        type: "good",
        severity: "good",
        categoryKey: "shoulderTilt",
        messageKey: "shoulderTiltGood",
      });
    }
  }

  // --- 3. Rounded back (kyphosis) ---
  if (isValid(ls) && isValid(rs) && isValid(lh) && isValid(rh)) {
    const shoulderMidX = (ls.x + rs.x) / 2;
    const hipMidX = (lh.x + rh.x) / 2;
    const shoulderMidY = (ls.y + rs.y) / 2;
    const hipMidY = (lh.y + rh.y) / 2;
    const torsoLen = Math.abs(hipMidY - shoulderMidY);
    const torsoShift = (shoulderMidX - hipMidX) / (torsoLen || 1);

    if (Math.abs(torsoShift) > 0.15) {
      feedbacks.push({
        type: "warning",
        severity: "bad",
        categoryKey: "roundedBack",
        messageKey: "roundedBackBad",
        exerciseKeys: ["thoracicMobility", "facePull", "thoracicExtension"],
      });
      deductions += 15;
    } else if (Math.abs(torsoShift) > 0.08) {
      feedbacks.push({
        type: "warning",
        severity: "warning",
        categoryKey: "roundedBack",
        messageKey: "roundedBackWarning",
        exerciseKeys: ["thoracicMobility"],
      });
      deductions += 8;
    } else {
      feedbacks.push({
        type: "good",
        severity: "good",
        categoryKey: "roundedBack",
        messageKey: "roundedBackGood",
      });
    }
  }

  // --- 4. Pelvic tilt ---
  if (isValid(lh) && isValid(rh) && isValid(lk) && isValid(rk) && isValid(la) && isValid(ra)) {
    const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 } as Keypoint;
    const kneeMid = { x: (lk.x + rk.x) / 2, y: (lk.y + rk.y) / 2 } as Keypoint;
    const ankleMid = { x: (la.x + ra.x) / 2, y: (la.y + ra.y) / 2 } as Keypoint;
    const legAngle = angle(hipMid, kneeMid, ankleMid);

    // Also check hip-shoulder alignment for anterior tilt
    if (isValid(ls) && isValid(rs)) {
      const shoulderMidX = (ls.x + rs.x) / 2;
      const hipMidX = (lh.x + rh.x) / 2;
      const hipForward = (hipMidX - shoulderMidX) / imgH;

      if (hipForward > 0.02) {
        feedbacks.push({
          type: "warning",
          severity: "bad",
          categoryKey: "pelvicTilt",
          messageKey: "pelvicTiltAnterior",
          exerciseKeys: ["hipFlexorStretch", "deadBug", "gluteBridge"],
        });
        deductions += 12;
      } else if (hipForward < -0.02) {
        feedbacks.push({
          type: "warning",
          severity: "warning",
          categoryKey: "pelvicTilt",
          messageKey: "pelvicTiltPosterior",
          exerciseKeys: ["hamstringStretch", "romanianDeadlift"],
        });
        deductions += 8;
      } else {
        feedbacks.push({
          type: "good",
          severity: "good",
          categoryKey: "pelvicTilt",
          messageKey: "pelvicTiltGood",
        });
      }
    }
  }

  // --- 5. O-legs / X-legs (frontal view) ---
  if (isValid(lk) && isValid(rk) && isValid(la) && isValid(ra) && isValid(lh) && isValid(rh)) {
    const hipWidth = Math.abs(lh.x - rh.x);
    const kneeWidth = Math.abs(lk.x - rk.x);
    const ankleWidth = Math.abs(la.x - ra.x);

    if (hipWidth > 0) {
      const kneeAnkleRatio = kneeWidth / ankleWidth;
      const kneeHipRatio = kneeWidth / hipWidth;

      if (kneeAnkleRatio < 0.8 && kneeHipRatio < 0.6) {
        feedbacks.push({
          type: "warning",
          severity: "warning",
          categoryKey: "legAlignment",
          messageKey: "legAlignmentKnock",
          exerciseKeys: ["clamshell", "miniBandWalk"],
        });
        deductions += 8;
      } else if (kneeAnkleRatio > 1.4) {
        feedbacks.push({
          type: "warning",
          severity: "warning",
          categoryKey: "legAlignment",
          messageKey: "legAlignmentBow",
          exerciseKeys: ["wideSquat", "adductorStretch"],
        });
        deductions += 8;
      } else {
        feedbacks.push({
          type: "good",
          severity: "good",
          categoryKey: "legAlignment",
          messageKey: "legAlignmentGood",
        });
      }
    }
  }

  // --- 6. Weight distribution (center of gravity) ---
  const allValid = keypoints.filter((kp) => (kp.score ?? 1) >= MIN_SCORE);
  if (allValid.length >= 10) {
    const avgX = allValid.reduce((sum, kp) => sum + kp.x, 0) / allValid.length;
    // Compare to shoulder midpoint as body center
    if (isValid(ls) && isValid(rs)) {
      const centerX = (ls.x + rs.x) / 2;
      const deviation = (avgX - centerX) / imgH;
      if (Math.abs(deviation) > 0.03) {
        const sideKey = deviation > 0 ? "right" : "left";
        feedbacks.push({
          type: "warning",
          severity: "warning",
          categoryKey: "weightShift",
          messageKey: "weightShiftWarning", sideKey,
        });
        deductions += 5;
      } else {
        feedbacks.push({
          type: "good",
          severity: "good",
          categoryKey: "weightShift",
          messageKey: "weightShiftGood",
        });
      }
    }
  }

  if (feedbacks.length === 0) {
    feedbacks.push({
      type: "good",
      severity: "good",
      categoryKey: "overall",
      messageKey: "overallGood",
    });
  }

  const score = Math.max(0, Math.min(100, 100 - deductions));
  return { feedbacks, score };
}
