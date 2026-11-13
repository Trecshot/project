# Eye Telemetry App

Aplicación móvil de lectura instrumentada en **React Native + Expo + TypeScript** que ejecuta telemetría ocular local en tiempo real mediante **Vision Camera**, **Worklets JSI**, **Fast TFLite** y **SQLite**.

## Estructura del Proyecto

- `assets/models/` — Modelos MediaPipe opcionales para empaquetado estático (`face_landmarks_detector.tflite` y `face_detector.tflite`).
- `assets/sounds/soft_chime.wav` — Alerta auditiva suave (PCM 16 bits) para pausas 20-20-20.
- `src/app/` — Rutas de Expo Router (`index`, `calibration`, `reader`, `session/[id]`).
- `src/core/vision/` — Índices de 27 landmarks clave, decodificador BlazeFace SSD (896 anclas), carga segura con fallback GPU/CPU y procesador en worklet sin GC.
- `src/core/biometrics/` — Motores puros de EAR, sacadas con normalización anatómica del iris, pose de cabeza y calibración robusta P5/P95.
- `src/core/cognitive/` — Ventana deslizante circular de 30s con tolerancia a parpadeos y máquina de estados con cooldown de 10 minutos.
- `src/database/` — Esquema SQLite (`reading_sessions`, `telemetry_snapshots`, `user_calibration`) y repositorio.
- `src/services/` — Servicio de alertas hápticas y notificaciones locales.
- `src/components/` — `CalibrationTarget`, `CognitiveHUD`, `DocumentViewer` y `TelemetryChart`.

## Requisitos Previos e Instalación

> Nota: Requiere **Development Build** nativo (`expo prebuild`); no es compatible con Expo Go debido a JSI/TFLite.

1. Instala dependencias:
   ```bash
   npm install
   ```
2. Genera los proyectos nativos Android/iOS y compila en tu teléfono físico por USB:
   ```bash
   npx expo prebuild
   npx expo run:android
   ```
3. **Carga de modelos TFLite (2 opciones):**
   - **Vía rápida (sin recompilar):** abre la app ya compilada y usa los botones **Importar Landmarks .tflite** y **Importar BlazeFace .tflite** en el Dashboard (se copian automáticamente a `FileSystem.documentDirectory/models/`).
   - **Vía embebida en el bundle:** extrae `face_landmarks_detector.tflite` (y opcionalmente `face_detector.tflite`) desde `face_landmarker.task` dentro de `assets/models/` y habilita sus `require(...)` en `src/core/vision/modelAssets.ts` antes de recompilar.
4. Ejecuta pruebas unitarias y chequeo de tipos:
   ```bash
   npm run typecheck
   npm test
   ```

## Notas del Lector (PDF / EPUB / TXT)

- **TXT / Markdown:** funciona **100% offline** sin límites estrictos.
- **PDF / EPUB locales:** admiten archivos de hasta **15 MB** (transferidos al `WebView` en fragmentos de 256 KB para evitar errores de memoria en Android) y requieren conexión inicial a internet para cargar `PDF.js` / `epub.js` desde CDN.
