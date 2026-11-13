/**
 * Registro central de modelos embebidos en tiempo de compilación.
 *
 * IMPORTANTE: Metro Bundler resuelve cualquier `require(...)` estático en tiempo de
 * compilación. Mantén estos valores en `null` mientras los binarios `.tflite` no estén
 * físicamente en `assets/models/`. Cuando los extraigas desde `face_landmarker.task`:
 *   landmarks: require('../../../assets/models/face_landmarks_detector.tflite'),
 *   detector: require('../../../assets/models/face_detector.tflite'),
 *
 * También puedes importar ambos `.tflite` en tiempo de ejecución desde el Dashboard
 * sin recompilar Metro (se guardan en `FileSystem.documentDirectory/models/`).
 */
export const BUNDLED_MODEL_MODULES: {
  landmarks: number | null;
  detector: number | null;
} = {
  landmarks: null,
  detector: null,
};
