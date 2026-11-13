import {
  FaceCropRect,
  HEAD_POSE_INDICES,
  LandmarkPoint,
  distance2DCoords,
  readTensorX,
  readTensorY,
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

function computeHeadPoseFromScalars(
  noseX: number,
  noseY: number,
  foreheadY: number,
  chinY: number,
  leftEyeX: number,
  leftEyeY: number,
  rightEyeX: number,
  rightEyeY: number
): HeadPoseEvaluation {
  'worklet';
  const eyeMidX = (leftEyeX + rightEyeX) * 0.5;
  const eyeMidY = (leftEyeY + rightEyeY) * 0.5;
  const interOcularDist = Math.max(
    distance2DCoords(leftEyeX, leftEyeY, rightEyeX, rightEyeY),
    1e-5
  );

  const yawRatio = (noseX - eyeMidX) / (interOcularDist * 0.5);
  const yawDeg = clamp(yawRatio * 45, -90, 90);

  const faceVerticalSpan = Math.max(Math.abs(chinY - foreheadY), 1e-5);
  const neutralNoseOffset = 0.22;
  const noseVerticalRatio = (noseY - eyeMidY) / faceVerticalSpan - neutralNoseOffset;
  const pitchDeg = clamp(noseVerticalRatio * 140, -90, 90);

  const rollRad = Math.atan2(rightEyeY - leftEyeY, rightEyeX - leftEyeX);
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

/**
 * Estima Pitch, Yaw y Roll desde un arreglo de Landmarks.
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

  return computeHeadPoseFromScalars(
    nose.x,
    nose.y,
    forehead.y,
    chin.y,
    leftEye.x,
    leftEye.y,
    rightEye.x,
    rightEye.y
  );
}

/**
 * Estima pose de cabeza indexando directamente el tensor plano (cero asignaciones GC).
 */
export function evaluateHeadPoseFromTensor(
  rawTensor: ArrayLike<number>,
  scale: number,
  cropRect: FaceCropRect | undefined
): HeadPoseEvaluation {
  'worklet';
  const cropX = cropRect ? cropRect.x : 0;
  const cropY = cropRect ? cropRect.y : 0;
  const cropW = cropRect ? cropRect.width : 1;
  const cropH = cropRect ? cropRect.height : 1;

  return computeHeadPoseFromScalars(
    readTensorX(rawTensor, HEAD_POSE_INDICES.noseTip, scale, cropX, cropW),
    readTensorY(rawTensor, HEAD_POSE_INDICES.noseTip, scale, cropY, cropH),
    readTensorY(rawTensor, HEAD_POSE_INDICES.forehead, scale, cropY, cropH),
    readTensorY(rawTensor, HEAD_POSE_INDICES.chin, scale, cropY, cropH),
    readTensorX(rawTensor, HEAD_POSE_INDICES.leftEyeOuter, scale, cropX, cropW),
    readTensorY(rawTensor, HEAD_POSE_INDICES.leftEyeOuter, scale, cropY, cropH),
    readTensorX(rawTensor, HEAD_POSE_INDICES.rightEyeOuter, scale, cropX, cropW),
    readTensorY(rawTensor, HEAD_POSE_INDICES.rightEyeOuter, scale, cropY, cropH)
  );
}
