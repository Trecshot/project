import {
  HEAD_POSE_INDICES,
  LandmarkPoint,
  distance2D,
} from '../vision/landmarkIndices';

export const MAX_ALIGNED_YAW_DEG = 25;
export const MAX_ALIGNED_PITCH_DEG = 25;

export interface HeadPoseEvaluation {
  pitchDeg: number;
  yawDeg: number;
  rollDeg: number;
  isAligned: boolean;
}

function clamp(val: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, val));
}

/**
 * Estima Pitch (inclinación arriba/abajo), Yaw (rotación izq/der) y Roll
 * a partir de proporciones geométricas 2D/3D de la malla facial MediaPipe.
 */
export function evaluateHeadPose(
  landmarks: readonly LandmarkPoint[]
): HeadPoseEvaluation {
  'worklet';
  const nose = landmarks[HEAD_POSE_INDICES.noseTip];
  const forehead = landmarks[HEAD_POSE_INDICES.forehead];
  const chin = landmarks[HEAD_POSE_INDICES.chin];
  const leftEye = landmarks[HEAD_POSE_INDICES.leftEyeOuter];
  const rightEye = landmarks[HEAD_POSE_INDICES.rightEyeOuter];

  if (!nose || !forehead || !chin || !leftEye || !rightEye) {
    return { pitchDeg: 0, yawDeg: 0, rollDeg: 0, isAligned: false };
  }

  const eyeMidX = (leftEye.x + rightEye.x) * 0.5;
  const eyeMidY = (leftEye.y + rightEye.y) * 0.5;
  const interOcularDist = Math.max(distance2D(leftEye, rightEye), 1e-5);

  // Yaw: desplazamiento horizontal de la punta de la nariz respecto al punto medio ocular
  const yawRatio = (nose.x - eyeMidX) / (interOcularDist * 0.5);
  const yawDeg = clamp(yawRatio * 45, -90, 90);

  // Pitch: posición vertical relativa de la nariz entre el punto medio ocular y el mentón
  const faceVerticalSpan = Math.max(Math.abs(chin.y - forehead.y), 1e-5);
  const neutralNoseOffset = 0.22; // proporción anatómica neutra bajo los ojos
  const noseVerticalRatio = (nose.y - eyeMidY) / faceVerticalSpan - neutralNoseOffset;
  const pitchDeg = clamp(noseVerticalRatio * 140, -90, 90);

  // Roll: inclinación lateral de la línea entre comisuras oculares externas
  const rollRad = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const rollDeg = (rollRad * 180) / Math.PI;

  const isAligned =
    Math.abs(yawDeg) <= MAX_ALIGNED_YAW_DEG &&
    Math.abs(pitchDeg) <= MAX_ALIGNED_PITCH_DEG;

  return {
    pitchDeg,
    yawDeg,
    rollDeg,
    isAligned,
  };
}
