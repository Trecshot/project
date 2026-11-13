import {
  LEFT_EYE_EAR_INDICES,
  RIGHT_EYE_EAR_INDICES,
  LandmarkPoint,
  distance2D,
} from '../vision/landmarkIndices';

export const DEFAULT_BASELINE_EAR = 0.28;
export const EAR_CLOSED_RATIO = 0.75;
export const LONG_BLINK_THRESHOLD_MS = 400;

export interface BlinkTrackerState {
  isCurrentlyClosed: boolean;
  closedStartedAtMs: number | null;
}

export interface EarEvaluation {
  leftEar: number;
  rightEar: number;
  avgEar: number;
  isEyeClosed: boolean;
  blinkCompleted: boolean;
  blinkDurationMs: number;
  nextBlinkState: BlinkTrackerState;
}

/**
 * Calcula el Eye Aspect Ratio (EAR) de un ojo usando 6 landmarks:
 * EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
 */
export function computeSingleEyeEar(
  landmarks: readonly LandmarkPoint[],
  indices: readonly [number, number, number, number, number, number]
): number {
  'worklet';
  const p1 = landmarks[indices[0]];
  const p2 = landmarks[indices[1]];
  const p3 = landmarks[indices[2]];
  const p4 = landmarks[indices[3]];
  const p5 = landmarks[indices[4]];
  const p6 = landmarks[indices[5]];

  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) {
    return 0;
  }

  const horizontal = distance2D(p1, p4);
  if (horizontal <= 1e-6) {
    return 0;
  }

  const verticalA = distance2D(p2, p6);
  const verticalB = distance2D(p3, p5);
  return (verticalA + verticalB) / (2.0 * horizontal);
}

/**
 * Evalúa la apertura ocular promedio y detecta frames OJO_CERRADO y duración de parpadeos.
 */
export function evaluateEar(
  landmarks: readonly LandmarkPoint[],
  baselineEar: number,
  prevBlinkState: BlinkTrackerState,
  timestampMs: number
): EarEvaluation {
  'worklet';
  const leftEar = computeSingleEyeEar(landmarks, LEFT_EYE_EAR_INDICES);
  const rightEar = computeSingleEyeEar(landmarks, RIGHT_EYE_EAR_INDICES);
  const avgEar = (leftEar + rightEar) * 0.5;

  const safeBaseline = baselineEar > 0.05 ? baselineEar : DEFAULT_BASELINE_EAR;
  const closedThreshold = safeBaseline * EAR_CLOSED_RATIO;
  const isEyeClosed = avgEar > 0 && avgEar < closedThreshold;

  let blinkCompleted = false;
  let blinkDurationMs = 0;
  let nextBlinkState: BlinkTrackerState;

  if (isEyeClosed) {
    nextBlinkState = {
      isCurrentlyClosed: true,
      closedStartedAtMs: prevBlinkState.isCurrentlyClosed
        ? prevBlinkState.closedStartedAtMs
        : timestampMs,
    };
  } else {
    if (
      prevBlinkState.isCurrentlyClosed &&
      prevBlinkState.closedStartedAtMs !== null
    ) {
      blinkDurationMs = Math.max(0, timestampMs - prevBlinkState.closedStartedAtMs);
      // Ignora micro-ruido de < 40 ms para evitar falsos parpadeos por jitter
      blinkCompleted = blinkDurationMs >= 40;
    }
    nextBlinkState = {
      isCurrentlyClosed: false,
      closedStartedAtMs: null,
    };
  }

  return {
    leftEar,
    rightEar,
    avgEar,
    isEyeClosed,
    blinkCompleted,
    blinkDurationMs,
    nextBlinkState,
  };
}
