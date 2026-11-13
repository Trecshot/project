# Eye Telemetry App

Aplicación móvil de lectura instrumentada en **React Native + Expo + TypeScript** que ejecuta telemetría ocular local en tiempo real mediante **Vision Camera**, **Worklets JSI**, **Fast TFLite** y **SQLite**.

## Estructura del Proyecto

- `assets/models/` — Modelo facial MediaPipe (`face_landmarker.task` / `face_landmarks_detector.tflite`).
- `assets/sounds/soft_chime.wav` — Alerta auditiva suave para pausas 20-20-20.
- `src/app/` — Rutas de Expo Router (`index`, `calibration`, `reader`, `session/[id]`).
- `src/core/vision/` — Índices de 478 landmarks + iris y procesador de frames en worklet.
- `src/core/biometrics/` — Motores puros de EAR, sacadas horizontales y pose de cabeza.
- `src/core/cognitive/` — Ventana deslizante circular de 30s y máquina de estados con cooldown.
- `src/database/` — Esquema SQLite (`reading_sessions`, `telemetry_snapshots`, `user_calibration`) y repositorio.
- `src/services/` — Servicio de alertas hápticas y notificaciones locales.
- `src/components/` — `CalibrationTarget`, `CognitiveHUD` y `TelemetryChart`.

## Requisitos Previos e Instalación

> Nota: Requiere **Development Build** nativo (`expo prebuild`); no es compatible con Expo Go debido a JSI/TFLite.

1. Instala dependencias:
   ```bash
   npm install
   ```
2. Descarga el modelo MediaPipe Face Landmarker en `assets/models/` (ver `assets/models/README.md`).
3. Genera los proyectos nativos Android/iOS:
   ```bash
   npx expo prebuild
   ```
4. Compila y ejecuta en un dispositivo físico conectado por USB:
   ```bash
   npx expo run:android
   ```
5. Ejecuta pruebas unitarias y chequeo de tipos:
   ```bash
   npm run typecheck
   npm test
   ```
