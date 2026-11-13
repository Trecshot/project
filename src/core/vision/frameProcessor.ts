import { useMemo } from 'react';
import { useFrameProcessor } from 'react-native-vision-camera';
import type { TensorflowModel } from 'react-native-fast-tflite';
import { Worklets } from 'react-native-worklets-core';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import {
  BlinkTrackerState,
  DEFAULT_BASELINE_EAR,
  evaluateEar,
} from '../biometrics/earEngine';
import { evaluateHeadPose } from '../biometrics/headPoseEngine';
import {
  DEFAULT_GAZE_BOUNDS,
  evaluateSaccade,
  GazeCalibrationBounds,
  IrisCentroid,
} from '../biometrics/saccadeEngine';
import { BiometricFrameSample } from '../cognitive/slidingWindow';
import { LandmarkPoint, TOTAL_FACE_LANDMARKS } from './landmarkIndices';

export const TARGET_CAMERA_FPS = 15;
export const FACE_LANDMARK_INPUT_SIZE = 192;
export const FACE_DETECTOR_INPUT_SIZE = 128;

export type ResizeRotation = '0deg' | '90deg' | '180deg' | '270deg';

export interface FaceCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TelemetryPipelineConfig {
  baselineEar: number;
  gazeBounds: GazeCalibrationBounds;
  isActive: boolean;
  /** Modelo opcional de 1.ª etapa (face_detector.tflite) para recorte ROI */
  faceDetectorModel?: TensorflowModel;
  /**
   * Rotación manual para `vision-camera-resize-plugin` ('0deg' | '90deg' | '180deg' | '270deg').
   * Útil en Android si la cámara frontal entrega frames rotados 90° o 270° respecto a portrait.
   */
  rotation?: ResizeRotation;
}

/**
 * Mapea `frame.orientation` de Vision Camera a la rotación de `resize(...)`.
 * Si se pasa `overrideRotation`, tiene prioridad para calibrar sensores Android específicos.
 */
export function resolveFrameRotation(
  frameOrientation: string,
  overrideRotation?: ResizeRotation
): ResizeRotation {
  'worklet';
  if (overrideRotation) {
    return overrideRotation;
  }
  switch (frameOrientation) {
    case 'landscape-left':
      return '90deg';
    case 'landscape-right':
      return '270deg';
    case 'portrait-upside-down':
      return '180deg';
    default:
      return '0deg';
  }
}

/**
 * Convierte la salida plana del modelo TFLite de MediaPipe (478 x 3)
 * a coordenadas normalizadas [0, 1]. Descarta salidas con valores NaN/Inf.
 */
export function parseFaceLandmarksOutput(
  rawTensor: ArrayLike<number> | undefined,
  inputSize: number = FACE_LANDMARK_INPUT_SIZE,
  cropRect?: FaceCropRect
): LandmarkPoint[] | null {
  'worklet';
  if (!rawTensor || rawTensor.length < TOTAL_FACE_LANDMARKS * 3) {
    return null;
  }

  let maxCoord = 0;
  for (let i = 0; i < 30; i++) {
    const val = rawTensor[i];
    if (!Number.isFinite(val)) {
      return null;
    }
    const absVal = Math.abs(val);
    if (absVal > maxCoord) maxCoord = absVal;
  }
  const scale = maxCoord > 2.0 ? 1 / inputSize : 1;

  const landmarks = new Array<LandmarkPoint>(TOTAL_FACE_LANDMARKS);
  for (let i = 0; i < TOTAL_FACE_LANDMARKS; i++) {
    const offset = i * 3;
    const rawX = rawTensor[offset];
    const rawY = rawTensor[offset + 1];
    const rawZ = rawTensor[offset + 2];

    if (
      !Number.isFinite(rawX) ||
      !Number.isFinite(rawY) ||
      !Number.isFinite(rawZ)
    ) {
      return null;
    }

    const normX = rawX * scale;
    const normY = rawY * scale;

    landmarks[i] = {
      x: cropRect ? cropRect.x + normX * cropRect.width : normX,
      y: cropRect ? cropRect.y + normY * cropRect.height : normY,
      z: rawZ * scale,
    };
  }

  return landmarks;
}

/**
 * Ejecuta el cálculo biométrico completo sobre un frame dentro del hilo Worklet,
 * aplicando suavizado EMA de 3 frames sobre las coordenadas del iris.
 */
export function processLandmarksInWorklet(
  landmarks: LandmarkPoint[] | null,
  timestampMs: number,
  baselineEar: number,
  gazeBounds: GazeCalibrationBounds,
  blinkState: BlinkTrackerState,
  prevSmoothedGaze: IrisCentroid | null
): {
  sample: BiometricFrameSample;
  nextBlinkState: BlinkTrackerState;
  nextSmoothedGaze: IrisCentroid | null;
} {
  'worklet';
  if (!landmarks) {
    return {
      sample: {
        timestampMs,
        faceDetected: false,
        avgEar: 0,
        isEyeClosed: false,
        blinkCompleted: false,
        blinkDurationMs: 0,
        gazeX: 0.5,
        gazeY: 0.5,
        absDeltaX: 0,
        isSaccade: false,
        isFixated: false,
        isWithinBounds: false,
        isHeadAligned: false,
      },
      nextBlinkState: blinkState,
      nextSmoothedGaze: null,
    };
  }

  const earEval = evaluateEar(landmarks, baselineEar, blinkState, timestampMs);
  const saccadeEval = evaluateSaccade(landmarks, prevSmoothedGaze, gazeBounds);
  const headEval = evaluateHeadPose(landmarks);

  return {
    sample: {
      timestampMs,
      faceDetected: true,
      avgEar: earEval.avgEar,
      isEyeClosed: earEval.isEyeClosed,
      blinkCompleted: earEval.blinkCompleted,
      blinkDurationMs: earEval.blinkDurationMs,
      gazeX: saccadeEval.gazeX,
      gazeY: saccadeEval.gazeY,
      absDeltaX: saccadeEval.absDeltaX,
      isSaccade: saccadeEval.isSaccade,
      isFixated: saccadeEval.isFixated,
      isWithinBounds: saccadeEval.isWithinBounds,
      isHeadAligned: headEval.isAligned,
    },
    nextBlinkState: earEval.nextBlinkState,
    nextSmoothedGaze: {
      gazeX: saccadeEval.gazeX,
      gazeY: saccadeEval.gazeY,
    },
  };
}

/**
 * Extrae el recorte ROI cuadrado en píxeles de frame cuando está disponible
 * la salida de `face_detector.tflite` (formato [ymin, xmin, ymax, xmax] o [cx, cy, w, h]).
 */
function extractFaceCropFromDetector(
  detectorOutput: ArrayLike<number> | undefined,
  frameWidth: number,
  frameHeight: number
): { pixelCrop: FaceCropRect; normCrop: FaceCropRect } | undefined {
  'worklet';
  if (!detectorOutput || detectorOutput.length < 4) {
    return undefined;
  }

  const cx = detectorOutput[0];
  const cy = detectorOutput[1];
  const w = detectorOutput[2];
  const h = detectorOutput[3];
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0.05 ||
    h <= 0.05
  ) {
    return undefined;
  }

  const normX = Math.max(0, Math.min(1, cx / FACE_DETECTOR_INPUT_SIZE - (w / FACE_DETECTOR_INPUT_SIZE) * 0.65));
  const normY = Math.max(0, Math.min(1, cy / FACE_DETECTOR_INPUT_SIZE - (h / FACE_DETECTOR_INPUT_SIZE) * 0.65));
  const normW = Math.min(1 - normX, (w / FACE_DETECTOR_INPUT_SIZE) * 1.3);
  const normH = Math.min(1 - normY, (h / FACE_DETECTOR_INPUT_SIZE) * 1.3);

  return {
    pixelCrop: {
      x: Math.round(normX * frameWidth),
      y: Math.round(normY * frameHeight),
      width: Math.max(1, Math.round(normW * frameWidth)),
      height: Math.max(1, Math.round(normH * frameHeight)),
    },
    normCrop: { x: normX, y: normY, width: normW, height: normH },
  };
}

/**
 * Hook de Vision Camera que convierte el frame YUV a RGB Float32 (192x192)
 * con `vision-camera-resize-plugin`, ejecuta MediaPipe TFLite en GPU/CPU
 * y envía muestras compactas al hilo JS.
 */
export function useBiometricFrameProcessor(
  model: TensorflowModel | undefined,
  config: TelemetryPipelineConfig,
  onSample: (sample: BiometricFrameSample) => void
) {
  const { resize } = useResizePlugin();

  const blinkStateShared = useMemo(
    () =>
      Worklets.createSharedValue<BlinkTrackerState>({
        isCurrentlyClosed: false,
        closedStartedAtMs: null,
      }),
    []
  );
  const smoothedGazeShared = useMemo(
    () => Worklets.createSharedValue<IrisCentroid | null>(null),
    []
  );
  const lastProcessedTsShared = useMemo(
    () => Worklets.createSharedValue<number>(0),
    []
  );

  const emitSampleToJS = useMemo(
    () => Worklets.createRunOnJS(onSample),
    [onSample]
  );

  const baselineEar =
    config.baselineEar > 0 ? config.baselineEar : DEFAULT_BASELINE_EAR;
  const gazeBounds = config.gazeBounds ?? DEFAULT_GAZE_BOUNDS;
  const isActive = config.isActive;
  const faceDetectorModel = config.faceDetectorModel;
  const overrideRotation = config.rotation;
  const minIntervalMs = 1000 / TARGET_CAMERA_FPS;

  return useFrameProcessor(
    (frame) => {
      'worklet';
      if (!isActive || !model) {
        return;
      }

      const nowMs = Date.now();
      if (nowMs - lastProcessedTsShared.value < minIntervalMs) {
        return;
      }
      lastProcessedTsShared.value = nowMs;

      const rotation = resolveFrameRotation(
        frame.orientation,
        overrideRotation
      );

      // Etapa opcional 1: Detección de ROI facial si se provee face_detector.tflite
      let cropInfo:
        | { pixelCrop: FaceCropRect; normCrop: FaceCropRect }
        | undefined;
      if (faceDetectorModel) {
        const detectorInput = resize(frame, {
          scale: {
            width: FACE_DETECTOR_INPUT_SIZE,
            height: FACE_DETECTOR_INPUT_SIZE,
          },
          pixelFormat: 'rgb',
          dataType: 'float32',
          rotation,
        });
        const detectorOut = faceDetectorModel.runSync([detectorInput]);
        cropInfo = extractFaceCropFromDetector(
          detectorOut[0] as ArrayLike<number> | undefined,
          frame.width,
          frame.height
        );
      }

      // Conversión crítica YUV_420_888 -> RGB Float32 reescalado a 192x192 con compensación de orientación
      const resizedRgbFloat32 = resize(frame, {
        ...(cropInfo ? { crop: cropInfo.pixelCrop } : {}),
        scale: {
          width: FACE_LANDMARK_INPUT_SIZE,
          height: FACE_LANDMARK_INPUT_SIZE,
        },
        pixelFormat: 'rgb',
        dataType: 'float32',
        rotation,
      });

      const outputs = model.runSync([resizedRgbFloat32]);
      const landmarks = parseFaceLandmarksOutput(
        outputs[0] as ArrayLike<number> | undefined,
        FACE_LANDMARK_INPUT_SIZE,
        cropInfo?.normCrop
      );

      const result = processLandmarksInWorklet(
        landmarks,
        nowMs,
        baselineEar,
        gazeBounds,
        blinkStateShared.value,
        smoothedGazeShared.value
      );

      blinkStateShared.value = result.nextBlinkState;
      smoothedGazeShared.value = result.nextSmoothedGaze;

      emitSampleToJS(result.sample);
    },
    [
      model,
      faceDetectorModel,
      overrideRotation,
      isActive,
      baselineEar,
      gazeBounds,
      emitSampleToJS,
      resize,
      blinkStateShared,
      smoothedGazeShared,
      lastProcessedTsShared,
    ]
  );
}
