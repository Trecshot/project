import { useMemo } from 'react';
import { useFrameProcessor } from 'react-native-vision-camera';
import type { TensorflowModel } from 'react-native-fast-tflite';
import { Worklets } from 'react-native-worklets-core';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import {
  BlinkTrackerState,
  DEFAULT_BASELINE_EAR,
  evaluateEarFromTensor,
} from '../biometrics/earEngine';
import { evaluateHeadPoseFromTensor } from '../biometrics/headPoseEngine';
import {
  DEFAULT_GAZE_BOUNDS,
  evaluateSaccadeFromTensor,
  GazeCalibrationBounds,
  IrisCentroid,
} from '../biometrics/saccadeEngine';
import { BiometricFrameSample } from '../cognitive/slidingWindow';
import { monotonicNowMs } from '../utils/clock';
import {
  BLAZEFACE_INPUT_SIZE,
  decodeBlazeFaceBestBox,
} from './blazefaceDecoder';
import {
  FaceCropRect,
  LandmarkPoint,
  resolveFlatTensorScale,
  TOTAL_FACE_LANDMARKS,
} from './landmarkIndices';

export const TARGET_CAMERA_FPS = 15;
export const FACE_LANDMARK_INPUT_SIZE = 192;

export type ResizeRotation = '0deg' | '90deg' | '180deg' | '270deg';

export interface TelemetryPipelineConfig {
  baselineEar: number;
  gazeBounds: GazeCalibrationBounds;
  isActive: boolean;
  /** Modelo opcional de 1.ª etapa (face_detector.tflite / BlazeFace SSD) para recorte ROI */
  faceDetectorModel?: TensorflowModel;
  /** Rotación manual ('0deg' | '90deg' | '180deg' | '270deg') para sensores Android */
  rotation?: ResizeRotation;
}

/**
 * Mapea `frame.orientation` de Vision Camera a la rotación de `resize(...)`.
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
 * Normaliza un tensor RGB Float32 in-place (cero asignaciones):
 * - Si los valores están en [0, 255], los lleva a [0.0, 1.0] o [-1.0, 1.0].
 * - Si ya están en [0.0, 1.0] y targetRange es '-1_1', aplica (x * 2 - 1).
 */
export function normalizeRgbTensorInPlace(
  tensor: Float32Array,
  targetRange: '0_1' | '-1_1'
): void {
  'worklet';
  const len = tensor.length;
  if (len === 0) return;

  let maxVal = 0;
  const probeLimit = Math.min(len, 96);
  for (let i = 0; i < probeLimit; i++) {
    const v = tensor[i];
    if (v > maxVal) maxVal = v;
  }

  const isByteRange = maxVal > 1.5;

  if (targetRange === '0_1') {
    if (!isByteRange) return;
    const inv255 = 1 / 255;
    for (let i = 0; i < len; i++) {
      tensor[i] *= inv255;
    }
    return;
  }

  // targetRange === '-1_1' (requerido por BlazeFace short-range)
  if (isByteRange) {
    const inv127_5 = 1 / 127.5;
    for (let i = 0; i < len; i++) {
      tensor[i] = tensor[i] * inv127_5 - 1;
    }
  } else {
    for (let i = 0; i < len; i++) {
      tensor[i] = tensor[i] * 2 - 1;
    }
  }
}

/**
 * Parser completo de 478 landmarks (mantenido para utilidades/pruebas fuera del hot path).
 */
export function parseFaceLandmarksOutput(
  rawTensor: ArrayLike<number> | undefined,
  inputSize: number = FACE_LANDMARK_INPUT_SIZE,
  cropRect?: FaceCropRect
): LandmarkPoint[] | null {
  'worklet';
  const scale = resolveFlatTensorScale(rawTensor, inputSize);
  if (scale === null || !rawTensor) {
    return null;
  }

  const landmarks = new Array<LandmarkPoint>(TOTAL_FACE_LANDMARKS);
  for (let i = 0; i < TOTAL_FACE_LANDMARKS; i++) {
    const offset = i * 3;
    const x = rawTensor[offset];
    const y = rawTensor[offset + 1];
    const z = rawTensor[offset + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    const normX = x * scale;
    const normY = y * scale;
    landmarks[i] = {
      x: cropRect ? cropRect.x + normX * cropRect.width : normX,
      y: cropRect ? cropRect.y + normY * cropRect.height : normY,
      z: z * scale,
    };
  }

  return landmarks;
}

/**
 * Procesa el tensor plano directamente en el Worklet leyendo únicamente los 27 índices
 * necesarios (sin instanciar 478 objetos ni arreglos en cada frame).
 */
export function processFlatTensorInWorklet(
  rawTensor: ArrayLike<number> | undefined,
  inputSize: number,
  cropRect: FaceCropRect | undefined,
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
  const scale = resolveFlatTensorScale(rawTensor, inputSize);
  if (scale === null || !rawTensor) {
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

  const earEval = evaluateEarFromTensor(
    rawTensor,
    scale,
    cropRect,
    baselineEar,
    blinkState,
    timestampMs
  );
  const saccadeEval = evaluateSaccadeFromTensor(
    rawTensor,
    scale,
    cropRect,
    prevSmoothedGaze,
    gazeBounds
  );
  const headEval = evaluateHeadPoseFromTensor(rawTensor, scale, cropRect);

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
 * Hook de Vision Camera:
 * 1) Opcionalmente detecta ROI facial con BlazeFace SSD (896 anclas + sigmoide)
 * 2) Reeescala y convierte YUV -> RGB Float32 [0.0, 1.0] (192x192) con crop ROI
 * 3) Evalúa biometría con cero asignaciones de objetos de malla en el worklet JSI
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

      const nowMs = monotonicNowMs();
      if (nowMs - lastProcessedTsShared.value < minIntervalMs) {
        return;
      }
      lastProcessedTsShared.value = nowMs;

      const rotation = resolveFrameRotation(
        frame.orientation,
        overrideRotation
      );

      // Etapa 1 (opcional): BlazeFace SSD [1, 896, 16] + [1, 896, 1] con normalización [-1, 1]
      let cropInfo:
        | { pixelCrop: FaceCropRect; normCrop: FaceCropRect; score: number }
        | undefined;
      if (faceDetectorModel) {
        const detectorInput = resize(frame, {
          scale: {
            width: BLAZEFACE_INPUT_SIZE,
            height: BLAZEFACE_INPUT_SIZE,
          },
          pixelFormat: 'rgb',
          dataType: 'float32',
          rotation,
        });
        normalizeRgbTensorInPlace(detectorInput, '-1_1');

        const detectorOut = faceDetectorModel.runSync([detectorInput]);
        cropInfo = decodeBlazeFaceBestBox(
          detectorOut[0] as ArrayLike<number> | undefined,
          detectorOut[1] as ArrayLike<number> | undefined,
          frame.width,
          frame.height
        );

        // Si el detector está cargado pero no encuentra rostro con confianza >= 0.5, reportamos sin rostro
        if (!cropInfo) {
          const emptyRes = processFlatTensorInWorklet(
            undefined,
            FACE_LANDMARK_INPUT_SIZE,
            undefined,
            nowMs,
            baselineEar,
            gazeBounds,
            blinkStateShared.value,
            smoothedGazeShared.value
          );
          blinkStateShared.value = emptyRes.nextBlinkState;
          smoothedGazeShared.value = emptyRes.nextSmoothedGaze;
          emitSampleToJS(emptyRes.sample);
          return;
        }
      } else {
        // Fallback en modo 1 modelo: recorte cuadrado centrado (75% del encuadre) para lectura a 30-40 cm
        const sideNorm = 0.75;
        const xNorm = (1 - sideNorm) * 0.5;
        const yNorm = (1 - sideNorm) * 0.5;
        cropInfo = {
          pixelCrop: {
            x: Math.round(xNorm * frame.width),
            y: Math.round(yNorm * frame.height),
            width: Math.max(1, Math.round(sideNorm * frame.width)),
            height: Math.max(1, Math.round(sideNorm * frame.height)),
          },
          normCrop: {
            x: xNorm,
            y: yNorm,
            width: sideNorm,
            height: sideNorm,
          },
          score: 1,
        };
      }

      // Etapa 2: Recorte ROI + RGB Float32 normalizado [0.0, 1.0] (192x192)
      const resizedRgbFloat32 = resize(frame, {
        crop: cropInfo.pixelCrop,
        scale: {
          width: FACE_LANDMARK_INPUT_SIZE,
          height: FACE_LANDMARK_INPUT_SIZE,
        },
        pixelFormat: 'rgb',
        dataType: 'float32',
        rotation,
      });
      normalizeRgbTensorInPlace(resizedRgbFloat32, '0_1');

      const outputs = model.runSync([resizedRgbFloat32]);
      const result = processFlatTensorInWorklet(
        outputs[0] as ArrayLike<number> | undefined,
        FACE_LANDMARK_INPUT_SIZE,
        cropInfo.normCrop,
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
