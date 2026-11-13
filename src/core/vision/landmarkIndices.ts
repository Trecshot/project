export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
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
 * Distancia euclidiana 2D compatible con worklets JSI.
 */
export function distance2D(a: LandmarkPoint, b: LandmarkPoint): number {
  'worklet';
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
