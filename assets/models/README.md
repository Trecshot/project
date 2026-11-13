# Modelos Biométricos (MediaPipe Face Landmarker)

Coloca aquí el archivo binario del modelo antes de compilar el Development Build:

- `face_landmarker.task` (paquete oficial de MediaPipe Face Landmarker, ~3.7 MB)
  - Descarga oficial: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task

## Nota sobre `react-native-fast-tflite`

El archivo `.task` de MediaPipe es un contenedor ZIP que incluye internamente los modelos `.tflite` (`face_detector.tflite` y `face_landmarks_detector.tflite`).

1. Si usas `react-native-fast-tflite` directamente, descomprime `face_landmarker.task` (por ejemplo renombrando una copia a `.zip`) y extrae `face_landmarks_detector.tflite` dentro de esta misma carpeta (`assets/models/face_landmarks_detector.tflite`), o conserva `face_landmarker.task` si usas un plugin nativo de MediaPipe.
2. El código en `src/core/vision/frameProcessor.ts` está preparado para cargar `face_landmarks_detector.tflite` (o `face_landmarker.task` si lo renombras/adaptas en `MODEL_ASSET`) y degradar limpiamente a modo sin modelo si el binario aún no está presente en desarrollo.
