import {
  FaceCropRect,
  LEFT_EYE_EAR_INDICES,
  LandmarkPoint,
  RIGHT_EYE_EAR_INDICES,
  distance2DCoords,
  readTensorX,
  readTensorY,
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

function computeEarFromScalars(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
  p4x: number,
  p4y: number,
  p5x: number,
  p5y: number,
  p6x: number,
  p6y: number
): number {
  'worklet';
  const horizontal = distance2DCoords(p1x, p1y, p4x, p4y);
  if (horizontal <= 1e-6) {
    return 0;
  }
  const verticalA = distance2DCoords(p2x, p2y, p6x, p6y);
  const verticalB = distance2DCoords(p3x, p3y, p5x, p5y);
  return (verticalA + verticalB) / (2.0 * horizontal);
}

function finalizeEarEvaluation(
  leftEar: number,
  rightEar: number,
  baselineEar: number,
  prevBlinkState: BlinkTrackerState,
  timestampMs: number
): EarEvaluation {
  'worklet';
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
      blinkDurationMs = Math.max(
        0,
        timestampMs - prevBlinkState.closedStartedAtMs
      );
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

/**
 * Calcula el Eye Aspect Ratio (EAR) de un ojo usando 6 landmarks.
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

  return computeEarFromScalars(
    p1.x,
    p1.y,
    p2.x,
    p2.y,
    p3.x,
    p3.y,
    p4.x,
    p4.y,
    p5.x,
    p5.y,
    p6.x,
    p6.y
  );
}

function computeSingleEyeEarFromTensor(
  rawTensor: ArrayLike<number>,
  scale: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  indices: readonly [number, number, number, number, number, number]
): number {
  'worklet';
  return computeEarFromScalars(
    readTensorX(rawTensor, indices[0], scale, cropX, cropW),
    readTensorY(rawTensor, indices[0], scale, cropY, cropH),
    readTensorX(rawTensor, indices[1], scale, cropX, cropW),
    readTensorY(rawTensor, indices[1], scale, cropY, cropH),
    readTensorX(rawTensor, indices[2], scale, cropX, cropW),
    readTensorY(rawTensor, indices[2], scale, cropY, cropH),
    readTensorX(rawTensor, indices[3], scale, cropX, cropW),
    readTensorY(rawTensor, indices[3], scale, cropY, cropH),
    readTensorX(rawTensor, indices[4], scale, cropX, cropW),
    readTensorY(rawTensor, indices[4], scale, cropY, cropH),
    readTensorX(rawTensor, indices[5], scale, cropX, cropW),
    readTensorY(rawTensor, indices[5], scale, cropY, cropH)
  );
}

/**
 * Evalúa EAR desde un arreglo de Landmarks (pruebas unitarias y uso general).
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
  return finalizeEarEvaluation(
    leftEar,
    rightEar,
    baselineEar,
    prevBlinkState,
    timestampMs
  );
}

/**
 * Evalúa EAR indexando directamente el Float32Array plano (cero asignaciones GC en worklet).
 */
export function evaluateEarFromTensor(
  rawTensor: ArrayLike<number>,
  scale: number,
  cropRect: FaceCropRect | undefined,
  baselineEar: number,
  prevBlinkState: BlinkTrackerState,
  timestampMs: number
): EarEvaluation {
  'worklet';
  const cropX = cropRect ? cropRect.x : 0;
  const cropY = cropRect ? cropRect.y : 0;
  const cropW = cropRect ? cropRect.width : 1;
  const cropH = cropRect ? cropRect.height : 1;

  const leftEar = computeSingleEyeEarFromTensor(
    rawTensor,
    scale,
    cropX,
    cropY,
    cropW,
    cropH,
    LEFT_EYE_EAR_INDICES
  );
  const rightEar = computeSingleEyeEarFromTensor(
    rawTensor,
    scale,
    cropX,
    cropY,
    cropW,
    cropH,
    RIGHT_EYE_EAR_INDICES
  );
  return finalizeEarEvaluation(
    leftEar,
    rightEar,
    baselineEar,
    prevBlinkState,
    timestampMs
  );
}
