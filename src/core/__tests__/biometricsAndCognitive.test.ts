import {
  BlinkTrackerState,
  DEFAULT_BASELINE_EAR,
  evaluateEar,
} from '../biometrics/earEngine';
import { evaluateHeadPose } from '../biometrics/headPoseEngine';
import {
  DEFAULT_GAZE_BOUNDS,
  evaluateSaccade,
  smoothGazeEma,
} from '../biometrics/saccadeEngine';
import {
  BiometricFrameSample,
  BiometricSlidingWindow,
} from '../cognitive/slidingWindow';
import {
  CognitiveStateMachine,
  classifyCognitiveState,
} from '../cognitive/stateMachine';
import { parseFaceLandmarksOutput } from '../vision/frameProcessor';
import {
  HEAD_POSE_INDICES,
  LEFT_EYE_EAR_INDICES,
  LEFT_IRIS_INDICES,
  LandmarkPoint,
  RIGHT_EYE_EAR_INDICES,
  RIGHT_IRIS_INDICES,
  TOTAL_FACE_LANDMARKS,
} from '../vision/landmarkIndices';

function createNeutralLandmarks(
  eyeOpenness: number = 0.03,
  irisX: number = 0.5,
  irisY: number = 0.5
): LandmarkPoint[] {
  const pts: LandmarkPoint[] = Array.from({ length: TOTAL_FACE_LANDMARKS }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));

  // Left eye horizontal span = 0.10, vertical = eyeOpenness -> EAR = eyeOpenness / 0.10
  const [l1, l2, l3, l4, l5, l6] = LEFT_EYE_EAR_INDICES;
  pts[l1] = { x: 0.35, y: 0.4 };
  pts[l4] = { x: 0.45, y: 0.4 };
  pts[l2] = { x: 0.38, y: 0.4 - eyeOpenness * 0.5 };
  pts[l3] = { x: 0.42, y: 0.4 - eyeOpenness * 0.5 };
  pts[l6] = { x: 0.38, y: 0.4 + eyeOpenness * 0.5 };
  pts[l5] = { x: 0.42, y: 0.4 + eyeOpenness * 0.5 };

  // Right eye horizontal span = 0.10
  const [r1, r2, r3, r4, r5, r6] = RIGHT_EYE_EAR_INDICES;
  pts[r1] = { x: 0.55, y: 0.4 };
  pts[r4] = { x: 0.65, y: 0.4 };
  pts[r2] = { x: 0.58, y: 0.4 - eyeOpenness * 0.5 };
  pts[r3] = { x: 0.62, y: 0.4 - eyeOpenness * 0.5 };
  pts[r6] = { x: 0.58, y: 0.4 + eyeOpenness * 0.5 };
  pts[r5] = { x: 0.62, y: 0.4 + eyeOpenness * 0.5 };

  pts[LEFT_IRIS_INDICES.center] = { x: irisX - 0.05, y: irisY };
  pts[RIGHT_IRIS_INDICES.center] = { x: irisX + 0.05, y: irisY };

  pts[HEAD_POSE_INDICES.leftEyeOuter] = { x: 0.35, y: 0.4 };
  pts[HEAD_POSE_INDICES.rightEyeOuter] = { x: 0.65, y: 0.4 };
  pts[HEAD_POSE_INDICES.forehead] = { x: 0.5, y: 0.2 };
  pts[HEAD_POSE_INDICES.chin] = { x: 0.5, y: 0.8 };
  pts[HEAD_POSE_INDICES.noseTip] = { x: 0.5, y: 0.4 + 0.22 * 0.6 };

  return pts;
}

describe('Motores Biométricos y Cognitivos', () => {
  it('detecta OJO_CERRADO cuando EAR cae por debajo del 75% del basal y mide parpadeos largos', () => {
    const openLandmarks = createNeutralLandmarks(0.03); // EAR = 0.30
    const closedLandmarks = createNeutralLandmarks(0.01); // EAR = 0.10 (< 0.75 * 0.28)
    let blinkState: BlinkTrackerState = {
      isCurrentlyClosed: false,
      closedStartedAtMs: null,
    };

    const resOpen = evaluateEar(
      openLandmarks,
      DEFAULT_BASELINE_EAR,
      blinkState,
      1000
    );
    expect(resOpen.isEyeClosed).toBe(false);
    expect(resOpen.avgEar).toBeCloseTo(0.3, 2);

    const resClosed = evaluateEar(
      closedLandmarks,
      DEFAULT_BASELINE_EAR,
      resOpen.nextBlinkState,
      1050
    );
    expect(resClosed.isEyeClosed).toBe(true);

    const resReopen = evaluateEar(
      openLandmarks,
      DEFAULT_BASELINE_EAR,
      resClosed.nextBlinkState,
      1520
    );
    expect(resReopen.blinkCompleted).toBe(true);
    expect(resReopen.blinkDurationMs).toBe(470);
  });

  it('detecta sacadas horizontales con suavizado EMA y límites calibrados del iris', () => {
    const lm1 = createNeutralLandmarks(0.03, 0.48, 0.5);
    const lm2 = createNeutralLandmarks(0.03, 0.52, 0.5);
    const eval1 = evaluateSaccade(lm1, null, DEFAULT_GAZE_BOUNDS);
    expect(eval1.isWithinBounds).toBe(true);

    const eval2 = evaluateSaccade(
      lm2,
      { gazeX: eval1.gazeX, gazeY: eval1.gazeY },
      DEFAULT_GAZE_BOUNDS
    );
    expect(eval2.isSaccade).toBe(true);
    expect(eval2.isFixated).toBe(false);

    const smoothed = smoothGazeEma({ gazeX: 0.52, gazeY: 0.5 }, { gazeX: 0.48, gazeY: 0.5 });
    expect(smoothed.gazeX).toBeCloseTo(0.5, 4);

    const outOfBounds = createNeutralLandmarks(0.03, 0.1, 0.5);
    const evalOut = evaluateSaccade(
      outOfBounds,
      null,
      DEFAULT_GAZE_BOUNDS
    );
    expect(evalOut.isWithinBounds).toBe(false);

    const nanTensor = new Float32Array(TOTAL_FACE_LANDMARKS * 3);
    nanTensor[0] = Number.NaN;
    expect(parseFaceLandmarksOutput(nanTensor)).toBeNull();
  });

  it('evalúa alineación de cabeza frontal', () => {
    const neutral = createNeutralLandmarks();
    const pose = evaluateHeadPose(neutral);
    expect(pose.isAligned).toBe(true);
    expect(Math.abs(pose.yawDeg)).toBeLessThan(5);
  });

  it('clasifica FATIGA_OCULAR por PERCLOS > 15% y DISTRACCION_BLOQUEO por fijación > 8s', () => {
    const window = new BiometricSlidingWindow(450, 30_000);

    for (let i = 0; i < 100; i++) {
      const sample: BiometricFrameSample = {
        timestampMs: i * 100,
        faceDetected: true,
        avgEar: i < 25 ? 0.14 : 0.28,
        isEyeClosed: i < 25, // 25% PERCLOS
        blinkCompleted: false,
        blinkDurationMs: 0,
        gazeX: 0.5,
        gazeY: 0.5,
        absDeltaX: 0.01,
        isSaccade: true,
        isFixated: false,
        isWithinBounds: true,
        isHeadAligned: true,
      };
      window.push(sample);
    }

    const fatigueMetrics = window.computeMetrics(10_000);
    expect(classifyCognitiveState(fatigueMetrics).state).toBe('FATIGA_OCULAR');

    // Ahora probamos fijación prolongada > 8s sin avance horizontal
    const fixationWindow = new BiometricSlidingWindow(450, 30_000);
    for (let i = 0; i < 100; i++) {
      fixationWindow.push({
        timestampMs: i * 100,
        faceDetected: true,
        avgEar: 0.29,
        isEyeClosed: false,
        blinkCompleted: i % 30 === 0,
        blinkDurationMs: 120,
        gazeX: 0.5,
        gazeY: 0.5,
        absDeltaX: 0,
        isSaccade: false,
        isFixated: true,
        isWithinBounds: true,
        isHeadAligned: true,
      });
    }
    const fixationMetrics = fixationWindow.computeMetrics(10_000);
    expect(classifyCognitiveState(fixationMetrics).state).toBe(
      'DISTRACCION_BLOQUEO'
    );
  });

  it('respeta el cooldown de 10 minutos entre alertas del mismo tipo', () => {
    const sm = new CognitiveStateMachine();
    const distrMetrics = {
      sampleCount: 100,
      validFaceSampleCount: 100,
      windowSpanMs: 20_000,
      avgEar: 0.29,
      perclosRatio: 0,
      blinkCount: 4,
      blinkRatePerMin: 12,
      longBlinkCount: 0,
      saccadeCount: 0,
      saccadeFrequencyHz: 0,
      maxContinuousFixationMs: 9500,
      maxContinuousOutOfBoundsMs: 0,
      latestHeadAligned: true,
      latestWithinBounds: true,
    };

    // Acumulamos > 15s en pasos de 5s
    sm.evaluate(distrMetrics, 0);
    sm.evaluate(distrMetrics, 5_000);
    sm.evaluate(distrMetrics, 10_000);
    const alert1 = sm.evaluate(distrMetrics, 15_000);
    expect(alert1.alertToTrigger).toBe('DISTRACCION_HAPTIC');

    // Dentro de los 10 minutos no debe volver a disparar
    const withinCooldown = sm.evaluate(distrMetrics, 300_000);
    expect(withinCooldown.alertToTrigger).toBeNull();
  });
});
