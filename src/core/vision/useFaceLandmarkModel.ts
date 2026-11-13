import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import {
  loadTensorflowModel,
  TensorflowModel,
  TensorflowModelDelegate,
} from 'react-native-fast-tflite';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
} from 'react-native-vision-camera';

const MODEL_PATH_HINT = 'assets/models/face_landmarks_detector.tflite';

export interface VisionPipelineStatus {
  model: TensorflowModel | undefined;
  modelReady: boolean;
  modelPathHint: string;
  activeDelegate: TensorflowModelDelegate | null;
  device: ReturnType<typeof useCameraDevice>;
  format: ReturnType<typeof useCameraFormat>;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
}

/**
 * Carga un modelo TFLite embebido en el bundle intentando primero aceleración
 * por GPU/CoreML y haciendo fallback automático a CPU ('default').
 */
async function loadBundledModelWithFallback(
  assetModule: number
): Promise<{ model: TensorflowModel; delegate: TensorflowModelDelegate }> {
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();
  const modelUrl = asset.localUri ?? asset.uri;

  const delegates: TensorflowModelDelegate[] =
    Platform.OS === 'android'
      ? ['android-gpu', 'default']
      : Platform.OS === 'ios'
      ? ['core-ml', 'default']
      : ['default'];

  let lastError: unknown = null;
  for (const delegate of delegates) {
    try {
      const loaded = await loadTensorflowModel({ url: modelUrl }, delegate);
      return { model: loaded, delegate };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('No se pudo inicializar el modelo TFLite');
}

/**
 * Hook compartido para permisos de cámara frontal (480p @ 15 FPS)
 * y carga offline del modelo `face_landmarks_detector.tflite` desde `assets/models/`.
 */
export function useVisionTelemetrySetup(): VisionPipelineStatus {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const format = useCameraFormat(device, [
    { videoResolution: { width: 640, height: 480 } },
    { fps: 15 },
  ]);

  const [model, setModel] = useState<TensorflowModel | undefined>(undefined);
  const [activeDelegate, setActiveDelegate] =
    useState<TensorflowModelDelegate | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const bundledModule = require('../../../assets/models/face_landmarks_detector.tflite');
        const result = await loadBundledModelWithFallback(bundledModule);
        if (mounted) {
          setModel(result.model);
          setActiveDelegate(result.delegate);
        }
      } catch (err) {
        console.warn(
          `[EyeTelemetry] Modelo no cargado (${MODEL_PATH_HINT}):`,
          err
        );
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return {
    model,
    modelReady: Boolean(model),
    modelPathHint: MODEL_PATH_HINT,
    activeDelegate,
    device,
    format,
    hasPermission,
    requestPermission,
  };
}

export { Camera };
