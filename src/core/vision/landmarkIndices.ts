export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

export interface FaceCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const TOTAL_FACE_LANDMARKS = 478;

/**
 * Índices exactos de MediaPipe FaceMesh (478 puntos) para el cálculo de EAR:
 * [p1 (comisura externa), p2 (párpado sup. 1), p3 (párpado sup. 2),
 *  p4 (comisura interna), p5 (párpado inf. 2), p6 (párpado inf. 1)]
 */
export const LEFT_EYE_EAR_INDICES = [33, 160, 158, 133, 153, 144] as const;
export const RIGHT_EYE_EAR_INDICES = [362, 385, 387, 263, 373, 380] as const;

export const LEFT_IRIS_INDICES = {
  center: 468,
  ring: [469, 470, 471, 472] as const,
} as const;

export const RIGHT_IRIS_INDICES = {
  center: 473,
  ring: [474, 475, 476, 477] as const,
} as const;

export const LEFT_EYEBROW_INDICES = [70, 63, 105, 66, 107] as const;
export const RIGHT_EYEBROW_INDICES = [300, 293, 334, 296, 336] as const;

export const HEAD_POSE_INDICES = {
  noseTip: 1,
  forehead: 10,
  chin: 152,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  leftMouth: 61,
  rightMouth: 291,
} as const;

/**
 * Subconjunto exacto de 27 índices utilizados por EAR, sacadas/iris y pose de cabeza.
 * Permite indexar directamente el Float32Array plano sin instanciar 478 objetos por frame.
 */
export const REQUIRED_LANDMARK_INDICES = [
  // Ojo izquierdo (6) + ojo derecho (6)
  33, 160, 158, 133, 153, 144,
  362, 385, 387, 263, 373, 380,
  // Iris izquierdo (5) + iris derecho (5)
  468, 469, 470, 471, 472,
  473, 474, 475, 476, 477,
  // Pose de cabeza adicionales (5; 33 y 263 ya incluidos arriba)
  1, 10, 152, 61, 291,
] as const;

/**
 * Distancia euclidiana 2D a partir de coordenadas escalares (cero asignaciones GC).
 */
export function distance2DCoords(
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  'worklet';
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Distancia euclidiana 2D compatible con worklets JSI.
 */
export function distance2D(a: LandmarkPoint, b: LandmarkPoint): number {
  'worklet';
  return distance2DCoords(a.x, a.y, b.x, b.y);
}

/**
 * Determina el factor de escala para un tensor plano de landmarks [0..inputSize] vs [0..1]
 * validando finitud únicamente sobre los 27 índices requeridos (cero asignaciones).
 */
export function resolveFlatTensorScale(
  rawTensor: ArrayLike<number> | undefined,
  inputSize: number
): number | null {
  'worklet';
  if (!rawTensor || rawTensor.length < TOTAL_FACE_LANDMARKS * 3) {
    return null;
  }

  let maxCoord = 0;
  for (let i = 0; i < REQUIRED_LANDMARK_INDICES.length; i++) {
    const base = REQUIRED_LANDMARK_INDICES[i] * 3;
    const x = rawTensor[base];
    const y = rawTensor[base + 1];
    const z = rawTensor[base + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    if (ax > maxCoord) maxCoord = ax;
    if (ay > maxCoord) maxCoord = ay;
  }

  return maxCoord > 2.0 ? 1 / inputSize : 1;
}

export function readTensorX(
  rawTensor: ArrayLike<number>,
  landmarkIdx: number,
  scale: number,
  cropX: number = 0,
  cropW: number = 1
): number {
  'worklet';
  return cropX + rawTensor[landmarkIdx * 3] * scale * cropW;
}

export function readTensorY(
  rawTensor: ArrayLike<number>,
  landmarkIdx: number,
  scale: number,
  cropY: number = 0,
  cropH: number = 1
): number {
  'worklet';
  return cropY + rawTensor[landmarkIdx * 3 + 1] * scale * cropH;
}
