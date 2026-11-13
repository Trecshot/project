# Modelos Biométricos (MediaPipe Face Landmarker)

Descarga oficial del paquete MediaPipe Face Landmarker (~3.7 MB):
- https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task

El archivo `.task` es un contenedor ZIP que incluye:
- `face_landmarks_detector.tflite` (malla facial de 478 puntos + iris, **requerido**)
- `face_detector.tflite` (detector BlazeFace SSD de 1.ª etapa para recorte ROI, **opcional pero recomendado**)

## Cómo cargarlos en la app

Tienes **dos opciones**:

1. **Vía rápida sin recompilar (recomendada):**
   Compila e instala la app directamente y usa los botones **Importar Landmarks .tflite** / **Importar BlazeFace .tflite** en el Dashboard. La app los copia a `FileSystem.documentDirectory/models/` y los activa al instante con fallback `['android-gpu', 'default']`.
2. **Embebidos en el bundle:**
   Extrae los archivos `.tflite` en esta carpeta (`assets/models/`) y registra sus `require(...)` en `src/core/vision/modelAssets.ts` antes de ejecutar `npx expo prebuild` y `npx expo run:android`.
