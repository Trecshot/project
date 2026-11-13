import {
  LEFT_IRIS_INDICES,
  RIGHT_IRIS_INDICES,
  LandmarkPoint,
} from '../vision/landmarkIndices';

export interface GazeCalibrationBounds {
  minGazeX: number;
  maxGazeX: number;
  minGazeY: number;
  maxGazeY: number;
}

export const DEFAULT_GAZE_BOUNDS: GazeCalibrationBounds = {
  minGazeX: 0.35,
  maxGazeX: 0.65,
  minGazeY: 0.35,
  maxGazeY: 0.65,
};

/**
 * Umbrales normalizados para distinguir micro-jitter, sacadas de lectura y giros bruscos.
 */
export const SACCADE_MIN_DELTA_X = 0.0025;
export const SACCADE_MAX_DELTA_X = 0.085;
export const GAZE_BOUNDS_MARGIN = 0.025;
/** Alpha = 2 / (N + 1) para una media móvil exponencial (EMA) de N = 3 frames */
export const GAZE_EMA_ALPHA = 0.5;

export interface IrisCentroid {
  gazeX: number;
  gazeY: number;
}

export interface SaccadeEvaluation {
  gazeX: number;
  gazeY: number;
  deltaX: number;
  absDeltaX: number;
  isSaccade: boolean;
  isFixated: boolean;
  isWithinBounds: boolean;
}

function getEyeIrisCenter(
  landmarks: readonly LandmarkPoint[],
  centerIdx: number,
  ringIndices: readonly [number, number, number, number]
): IrisCentroid | null {
  'worklet';
  const center = landmarks[centerIdx];
  if (center) {
    return { gazeX: center.x, gazeY: center.y };
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let i = 0; i < ringIndices.length; i++) {
    const pt = landmarks[ringIndices[i]];
    if (pt) {
      sumX += pt.x;
      sumY += pt.y;
      count++;
    }
  }
  if (count === 0) {
    return null;
  }
  return { gazeX: sumX / count, gazeY: sumY / count };
}

/**
 * Extrae el centroide binocular del iris en coordenadas normalizadas [0, 1].
 */
export function extractIrisCentroid(
  landmarks: readonly LandmarkPoint[]
): IrisCentroid {
  'worklet';
  const left = getEyeIrisCenter(
    landmarks,
    LEFT_IRIS_INDICES.center,
    LEFT_IRIS_INDICES.ring
  );
  const right = getEyeIrisCenter(
    landmarks,
    RIGHT_IRIS_INDICES.center,
    RIGHT_IRIS_INDICES.ring
  );

  if (left && right) {
    return {
      gazeX: (left.gazeX + right.gazeX) * 0.5,
      gazeY: (left.gazeY + right.gazeY) * 0.5,
    };
  }
  if (left) return left;
  if (right) return right;

  return { gazeX: 0.5, gazeY: 0.5 };
}

/**
 * Filtro de media móvil exponencial (EMA) para suavizar coordenadas del iris
 * y reducir ruido de cuantización entre frames consecutivos.
 */
export function smoothGazeEma(
  raw: IrisCentroid,
  prevSmoothed: IrisCentroid | null,
  alpha: number = GAZE_EMA_ALPHA
): IrisCentroid {
  'worklet';
  if (!prevSmoothed) {
    return raw;
  }
  return {
    gazeX: alpha * raw.gazeX + (1 - alpha) * prevSmoothed.gazeX,
    gazeY: alpha * raw.gazeY + (1 - alpha) * prevSmoothed.gazeY,
  };
}

/**
 * Evalúa desplazamiento horizontal (ΔX) para distinguir lectura activa vs mirada perdida.
 */
export function evaluateSaccade(
  landmarks: readonly LandmarkPoint[],
  previousSmoothedGaze: IrisCentroid | null,
  bounds: GazeCalibrationBounds
): SaccadeEvaluation {
  'worklet';
  const rawGaze = extractIrisCentroid(landmarks);
  const { gazeX, gazeY } = smoothGazeEma(rawGaze, previousSmoothedGaze);
  const deltaX = previousSmoothedGaze !== null ? gazeX - previousSmoothedGaze.gazeX : 0;
  const absDeltaX = Math.abs(deltaX);

  const isSaccade =
    previousSmoothedGaze !== null &&
    absDeltaX >= SACCADE_MIN_DELTA_X &&
    absDeltaX <= SACCADE_MAX_DELTA_X;

  const isFixated = previousSmoothedGaze !== null && absDeltaX < SACCADE_MIN_DELTA_X;

  const isWithinBounds =
    gazeX >= bounds.minGazeX - GAZE_BOUNDS_MARGIN &&
    gazeX <= bounds.maxGazeX + GAZE_BOUNDS_MARGIN &&
    gazeY >= bounds.minGazeY - GAZE_BOUNDS_MARGIN &&
    gazeY <= bounds.maxGazeY + GAZE_BOUNDS_MARGIN;

  return {
    gazeX,
    gazeY,
    deltaX,
    absDeltaX,
    isSaccade,
    isFixated,
    isWithinBounds,
  };
}
