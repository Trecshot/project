import {
  FaceCropRect,
  LEFT_EYE_EAR_INDICES,
  LEFT_IRIS_INDICES,
  LandmarkPoint,
  RIGHT_EYE_EAR_INDICES,
  RIGHT_IRIS_INDICES,
  readTensorX,
  readTensorY,
} from '../vision/landmarkIndices';

export interface GazeCalibrationBounds {
  minGazeX: number;
  maxGazeX: number;
  minGazeY: number;
  maxGazeY: number;
}

/**
 * Límites por defecto en espacio anatómico relativo a la cuenca ocular [0..1].
 * Al ser relativos a las comisuras (33/133 y 362/263), son invariantes a traslaciones de cabeza.
 */
export const DEFAULT_GAZE_BOUNDS: GazeCalibrationBounds = {
  minGazeX: 0.25,
  maxGazeX: 0.75,
  minGazeY: 0.3,
  maxGazeY: 0.7,
};

export const SACCADE_MIN_DELTA_X = 0.015;
export const SACCADE_MAX_DELTA_X = 0.35;
export const GAZE_BOUNDS_MARGIN = 0.06;
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

function computeRelativeEyeCoords(
  irisX: number,
  irisY: number,
  outerX: number,
  outerY: number,
  innerX: number,
  innerY: number
): IrisCentroid {
  'worklet';
  const eyeWidth = Math.max(Math.abs(innerX - outerX), 1e-5);
  const minX = Math.min(outerX, innerX);
  const eyeMidY = (outerY + innerY) * 0.5;

  const relX = (irisX - minX) / eyeWidth;
  const relY = 0.5 + (irisY - eyeMidY) / eyeWidth;
  return { gazeX: relX, gazeY: relY };
}

function getRelativeEyeGaze(
  landmarks: readonly LandmarkPoint[],
  irisCenterIdx: number,
  outerCornerIdx: number,
  innerCornerIdx: number
): IrisCentroid | null {
  'worklet';
  const iris = landmarks[irisCenterIdx];
  const outer = landmarks[outerCornerIdx];
  const inner = landmarks[innerCornerIdx];
  if (!iris || !outer || !inner) return null;

  return computeRelativeEyeCoords(
    iris.x,
    iris.y,
    outer.x,
    outer.y,
    inner.x,
    inner.y
  );
}

/**
 * Extrae el centroide binocular del iris normalizado respecto al ancho
 * de cada hendidura palpebral (invariante a traslación de cabeza/teléfono).
 */
export function extractIrisCentroid(
  landmarks: readonly LandmarkPoint[]
): IrisCentroid {
  'worklet';
  const left = getRelativeEyeGaze(
    landmarks,
    LEFT_IRIS_INDICES.center,
    LEFT_EYE_EAR_INDICES[0],
    LEFT_EYE_EAR_INDICES[3]
  );
  const right = getRelativeEyeGaze(
    landmarks,
    RIGHT_IRIS_INDICES.center,
    RIGHT_EYE_EAR_INDICES[3],
    RIGHT_EYE_EAR_INDICES[0]
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

function extractRelativeIrisFromTensor(
  rawTensor: ArrayLike<number>,
  scale: number,
  cropRect: FaceCropRect | undefined
): IrisCentroid {
  'worklet';
  const cropX = cropRect ? cropRect.x : 0;
  const cropY = cropRect ? cropRect.y : 0;
  const cropW = cropRect ? cropRect.width : 1;
  const cropH = cropRect ? cropRect.height : 1;

  const left = computeRelativeEyeCoords(
    readTensorX(rawTensor, LEFT_IRIS_INDICES.center, scale, cropX, cropW),
    readTensorY(rawTensor, LEFT_IRIS_INDICES.center, scale, cropY, cropH),
    readTensorX(rawTensor, LEFT_EYE_EAR_INDICES[0], scale, cropX, cropW),
    readTensorY(rawTensor, LEFT_EYE_EAR_INDICES[0], scale, cropY, cropH),
    readTensorX(rawTensor, LEFT_EYE_EAR_INDICES[3], scale, cropX, cropW),
    readTensorY(rawTensor, LEFT_EYE_EAR_INDICES[3], scale, cropY, cropH)
  );

  const right = computeRelativeEyeCoords(
    readTensorX(rawTensor, RIGHT_IRIS_INDICES.center, scale, cropX, cropW),
    readTensorY(rawTensor, RIGHT_IRIS_INDICES.center, scale, cropY, cropH),
    readTensorX(rawTensor, RIGHT_EYE_EAR_INDICES[3], scale, cropX, cropW),
    readTensorY(rawTensor, RIGHT_EYE_EAR_INDICES[3], scale, cropY, cropH),
    readTensorX(rawTensor, RIGHT_EYE_EAR_INDICES[0], scale, cropX, cropW),
    readTensorY(rawTensor, RIGHT_EYE_EAR_INDICES[0], scale, cropY, cropH)
  );

  return {
    gazeX: (left.gazeX + right.gazeX) * 0.5,
    gazeY: (left.gazeY + right.gazeY) * 0.5,
  };
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

function finalizeSaccadeEvaluation(
  rawGaze: IrisCentroid,
  previousSmoothedGaze: IrisCentroid | null,
  bounds: GazeCalibrationBounds
): SaccadeEvaluation {
  'worklet';
  const { gazeX, gazeY } = smoothGazeEma(rawGaze, previousSmoothedGaze);
  const deltaX =
    previousSmoothedGaze !== null ? gazeX - previousSmoothedGaze.gazeX : 0;
  const absDeltaX = Math.abs(deltaX);

  const isSaccade =
    previousSmoothedGaze !== null &&
    absDeltaX >= SACCADE_MIN_DELTA_X &&
    absDeltaX <= SACCADE_MAX_DELTA_X;

  const isFixated =
    previousSmoothedGaze !== null && absDeltaX < SACCADE_MIN_DELTA_X;

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

/**
 * Evalúa desplazamiento horizontal (ΔX) anatómico para distinguir lectura activa vs bloqueo.
 */
export function evaluateSaccade(
  landmarks: readonly LandmarkPoint[],
  previousSmoothedGaze: IrisCentroid | null,
  bounds: GazeCalibrationBounds
): SaccadeEvaluation {
  'worklet';
  const rawGaze = extractIrisCentroid(landmarks);
  return finalizeSaccadeEvaluation(rawGaze, previousSmoothedGaze, bounds);
}

/**
 * Evalúa sacadas indexando directamente el tensor plano (cero asignaciones GC en worklet).
 */
export function evaluateSaccadeFromTensor(
  rawTensor: ArrayLike<number>,
  scale: number,
  cropRect: FaceCropRect | undefined,
  previousSmoothedGaze: IrisCentroid | null,
  bounds: GazeCalibrationBounds
): SaccadeEvaluation {
  'worklet';
  const rawGaze = extractRelativeIrisFromTensor(rawTensor, scale, cropRect);
  return finalizeSaccadeEvaluation(rawGaze, previousSmoothedGaze, bounds);
}
