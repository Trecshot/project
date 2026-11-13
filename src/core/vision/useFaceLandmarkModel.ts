import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
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
import { logTelemetryError } from '../utils/clock';
import { BUNDLED_MODEL_MODULES } from './modelAssets';

export const LANDMARK_MODEL_FILENAME = 'face_landmarks_detector.tflite';
export const DETECTOR_MODEL_FILENAME = 'face_detector.tflite';

const MODELS_DIR = `${FileSystem.documentDirectory ?? ''}models/`;

export interface VisionPipelineStatus {
  model: TensorflowModel | undefined;
  faceDetectorModel: TensorflowModel | undefined;
  modelReady: boolean;
  detectorReady: boolean;
  modelPathHint: string;
  activeDelegate: TensorflowModelDelegate | null;
  device: ReturnType<typeof useCameraDevice>;
  format: ReturnType<typeof useCameraFormat>;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  importLocalModel: (
    kind: 'landmarks' | 'detector'
  ) => Promise<boolean>;
}

async function resolveModelUri(
  bundledModule: number | null,
  localFilename: string
): Promise<string | null> {
  const localPath = `${MODELS_DIR}${localFilename}`;
  try {
    const localInfo = await FileSystem.getInfoAsync(localPath);
    if (localInfo.exists) {
      return localPath;
    }
  } catch (err) {
    logTelemetryError(
      'VisionModelSetup',
      `Error verificando modelo local ${localFilename}`,
      err
    );
  }

  if (bundledModule !== null) {
    const asset = Asset.fromModule(bundledModule);
    await asset.downloadAsync();
    return asset.localUri ?? asset.uri;
  }

  return null;
}

/**
 * Carga un modelo TFLite intentando primero GPU/CoreML y haciendo fallback a CPU ('default').
 */
async function loadModelWithDelegateFallback(
  modelUrl: string
): Promise<{ model: TensorflowModel; delegate: TensorflowModelDelegate }> {
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
 * y carga segura sin errores estáticos de Metro cuando los `.tflite` aún no están en `assets/models/`.
 */
export function useVisionTelemetrySetup(): VisionPipelineStatus {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const format = useCameraFormat(device, [
    { videoResolution: { width: 640, height: 480 } },
    { fps: 15 },
  ]);

  const [model, setModel] = useState<TensorflowModel | undefined>(undefined);
  const [faceDetectorModel, setFaceDetectorModel] = useState<
    TensorflowModel | undefined
  >(undefined);
  const [activeDelegate, setActiveDelegate] =
    useState<TensorflowModelDelegate | null>(null);

  const loadModels = useCallback(async () => {
    try {
      const landmarkUri = await resolveModelUri(
        BUNDLED_MODEL_MODULES.landmarks,
        LANDMARK_MODEL_FILENAME
      );
      if (landmarkUri) {
        const res = await loadModelWithDelegateFallback(landmarkUri);
        setModel(res.model);
        setActiveDelegate(res.delegate);
      }

      const detectorUri = await resolveModelUri(
        BUNDLED_MODEL_MODULES.detector,
        DETECTOR_MODEL_FILENAME
      );
      if (detectorUri) {
        const detRes = await loadModelWithDelegateFallback(detectorUri);
        setFaceDetectorModel(detRes.model);
      }
    } catch (err) {
      logTelemetryError('VisionModelSetup', 'Error cargando modelos TFLite', err);
    }
  }, []);

  useEffect(() => {
    loadModels().catch((err) => {
      logTelemetryError(
        'VisionModelSetup',
        'Fallo inesperado inicializando modelos TFLite',
        err
      );
    });
  }, [loadModels]);

  const importLocalModel = useCallback(
    async (kind: 'landmarks' | 'detector'): Promise<boolean> => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
      });

      if (picked.canceled || !picked.assets?.[0]) {
        return false;
      }

      const targetName =
        kind === 'landmarks'
          ? LANDMARK_MODEL_FILENAME
          : DETECTOR_MODEL_FILENAME;

      await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
      const destUri = `${MODELS_DIR}${targetName}`;
      await FileSystem.copyAsync({
        from: picked.assets[0].uri,
        to: destUri,
      });

      await loadModels();
      return true;
    },
    [loadModels]
  );

  return useMemo(
    () => ({
      model,
      faceDetectorModel,
      modelReady: Boolean(model),
      detectorReady: Boolean(faceDetectorModel),
      modelPathHint: `assets/models/${LANDMARK_MODEL_FILENAME}`,
      activeDelegate,
      device,
      format,
      hasPermission,
      requestPermission,
      importLocalModel,
    }),
    [
      model,
      faceDetectorModel,
      activeDelegate,
      device,
      format,
      hasPermission,
      requestPermission,
      importLocalModel,
    ]
  );
}

export { Camera };
