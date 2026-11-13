import { computeRobustCalibration } from '../biometrics/calibrationMath';
import {
  BlinkTrackerState,
  DEFAULT_BASELINE_EAR,
  evaluateEar,
} from '../biometrics/earEngine';
import { evaluateHeadPose } from '../biometrics/headPoseEngine';
import {
  DEFAULT_GAZE_BOUNDS,
  evaluateSaccade,
  extractIrisCentroid,
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
import { monotonicNowMs } from '../utils/clock';
import {
  BLAZEFACE_ANCHORS_X,
  BLAZEFACE_ANCHORS_Y,
  BLAZEFACE_NUM_ANCHORS,
  decodeBlazeFaceBestBox,
} from '../vision/blazefaceDecoder';
import {
  normalizeRgbTensorInPlace,
  parseFaceLandmarksOutput,
  processFlatTensorInWorklet,
} from '../vision/frameProcessor';
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
  relativeIrisX: number = 0.5,
  relativeIrisY: number = 0.5,
  headOffsetX: number = 0
): LandmarkPoint[] {
  const pts: LandmarkPoint[] = Array.from({ length: TOTAL_FACE_LANDMARKS }, () => ({
    x: 0.5 + headOffsetX,
    y: 0.5,
    z: 0,
  }));

  // Ojo izquierdo: [0.35, 0.45] + headOffsetX (ancho = 0.10)
  const [l1, l2, l3, l4, l5, l6] = LEFT_EYE_EAR_INDICES;
  pts[l1] = { x: 0.35 + headOffsetX, y: 0.4 };
  pts[l4] = { x: 0.45 + headOffsetX, y: 0.4 };
  pts[l2] = { x: 0.38 + headOffsetX, y: 0.4 - eyeOpenness * 0.5 };
  pts[l3] = { x: 0.42 + headOffsetX, y: 0.4 - eyeOpenness * 0.5 };
  pts[l6] = { x: 0.38 + headOffsetX, y: 0.4 + eyeOpenness * 0.5 };
  pts[l5] = { x: 0.42 + headOffsetX, y: 0.4 + eyeOpenness * 0.5 };

  // Ojo derecho: [0.55, 0.65] + headOffsetX (ancho = 0.10)
  const [r1, r2, r3, r4, r5, r6] = RIGHT_EYE_EAR_INDICES;
  pts[r1] = { x: 0.55 + headOffsetX, y: 0.4 };
  pts[r4] = { x: 0.65 + headOffsetX, y: 0.4 };
  pts[r2] = { x: 0.58 + headOffsetX, y: 0.4 - eyeOpenness * 0.5 };
  pts[r3] = { x: 0.62 + headOffsetX, y: 0.4 - eyeOpenness * 0.5 };
  pts[r6] = { x: 0.58 + headOffsetX, y: 0.4 + eyeOpenness * 0.5 };
  pts[r5] = { x: 0.62 + headOffsetX, y: 0.4 + eyeOpenness * 0.5 };

  pts[LEFT_IRIS_INDICES.center] = {
    x: 0.35 + headOffsetX + relativeIrisX * 0.1,
    y: 0.4 + (relativeIrisY - 0.5) * 0.1,
  };
  pts[RIGHT_IRIS_INDICES.center] = {
    x: 0.55 + headOffsetX + relativeIrisX * 0.1,
    y: 0.4 + (relativeIrisY - 0.5) * 0.1,
  };

  pts[HEAD_POSE_INDICES.leftEyeOuter] = { x: 0.35 + headOffsetX, y: 0.4 };
  pts[HEAD_POSE_INDICES.rightEyeOuter] = { x: 0.65 + headOffsetX, y: 0.4 };
  pts[HEAD_POSE_INDICES.forehead] = { x: 0.5 + headOffsetX, y: 0.2 };
  pts[HEAD_POSE_INDICES.chin] = { x: 0.5 + headOffsetX, y: 0.8 };
  pts[HEAD_POSE_INDICES.noseTip] = {
    x: 0.5 + headOffsetX,
    y: 0.4 + 0.22 * 0.6,
  };

  return pts;
}

describe('Motores Biométricos, Visión SSD y Cognición', () => {
  it('detecta OJO_CERRADO y mide duración de parpadeo', () => {
    const openLandmarks = createNeutralLandmarks(0.03);
    const closedLandmarks = createNeutralLandmarks(0.01);
    const blinkState: BlinkTrackerState = {
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

  it('normaliza el iris anatómicamente de forma invariante a traslación de cabeza', () => {
    const lmCentered = createNeutralLandmarks(0.03, 0.5, 0.5, 0);
    const lmShiftedHead = createNeutralLandmarks(0.03, 0.5, 0.5, 0.18);

    const gaze1 = extractIrisCentroid(lmCentered);
    const gaze2 = extractIrisCentroid(lmShiftedHead);
    expect(gaze1.gazeX).toBeCloseTo(0.5, 4);
    expect(gaze2.gazeX).toBeCloseTo(0.5, 4);

    const lmSac = createNeutralLandmarks(0.03, 0.65, 0.5, 0.18);
    const evalSac = evaluateSaccade(lmSac, gaze2, DEFAULT_GAZE_BOUNDS);
    expect(evalSac.isSaccade).toBe(true);

    const smoothed = smoothGazeEma(
      { gazeX: 0.6, gazeY: 0.5 },
      { gazeX: 0.5, gazeY: 0.5 }
    );
    expect(smoothed.gazeX).toBeCloseTo(0.55, 4);
  });

  it('mantiene la detección de fijación > 8s a pesar de parpadeos fisiológicos normales', () => {
    const window = new BiometricSlidingWindow(450, 30_000);
    for (let i = 0; i < 100; i++) {
      const ts = i * 100; // 0s a 9.9s
      const isNormalBlink = ts >= 4000 && ts <= 4150; // parpadeo de 150ms
      window.push({
        timestampMs: ts,
        faceDetected: true,
        avgEar: isNormalBlink ? 0.12 : 0.29,
        isEyeClosed: isNormalBlink,
        blinkCompleted: ts === 4200,
        blinkDurationMs: ts === 4200 ? 150 : 0,
        gazeX: 0.5,
        gazeY: 0.5,
        absDeltaX: 0,
        isSaccade: false,
        isFixated: !isNormalBlink,
        isWithinBounds: true,
        isHeadAligned: true,
      });
    }

    const metrics = window.computeMetrics(10_000);
    expect(metrics.maxContinuousFixationMs).toBeGreaterThan(8000);
    expect(classifyCognitiveState(metrics).state).toBe('DISTRACCION_BLOQUEO');
  });

  it('decodifica BlazeFace SSD (896 anclas), normaliza tensores y procesa tensor plano sin GC', () => {
    const tensor255 = new Float32Array([0, 127.5, 255]);
    normalizeRgbTensorInPlace(tensor255, '-1_1');
    expect(tensor255[0]).toBeCloseTo(-1, 3);
    expect(tensor255[1]).toBeCloseTo(0, 3);
    expect(tensor255[2]).toBeCloseTo(1, 3);

    expect(BLAZEFACE_ANCHORS_X.length).toBe(BLAZEFACE_NUM_ANCHORS);
    expect(BLAZEFACE_ANCHORS_Y.length).toBe(BLAZEFACE_NUM_ANCHORS);

    const regs = new Float32Array(BLAZEFACE_NUM_ANCHORS * 16);
    const scores = new Float32Array(BLAZEFACE_NUM_ANCHORS).fill(-10);
    scores[100] = 4.0; // sigmoide(4) > 0.98
    regs[100 * 16 + 2] = 64;
    regs[100 * 16 + 3] = 64;

    const crop = decodeBlazeFaceBestBox(regs, scores, 640, 480);
    expect(crop).toBeDefined();
    expect(crop!.score).toBeGreaterThan(0.95);

    const pts = createNeutralLandmarks(0.03, 0.5, 0.5);
    const flat = new Float32Array(TOTAL_FACE_LANDMARKS * 3);
    for (let i = 0; i < TOTAL_FACE_LANDMARKS; i++) {
      flat[i * 3] = pts[i].x;
      flat[i * 3 + 1] = pts[i].y;
      flat[i * 3 + 2] = pts[i].z ?? 0;
    }

    const res = processFlatTensorInWorklet(
      flat,
      192,
      undefined,
      1000,
      DEFAULT_BASELINE_EAR,
      DEFAULT_GAZE_BOUNDS,
      { isCurrentlyClosed: false, closedStartedAtMs: null },
      null
    );
    expect(res.sample.faceDetected).toBe(true);
    expect(res.sample.isHeadAligned).toBe(true);

    flat[33 * 3] = Number.NaN;
    expect(parseFaceLandmarksOutput(flat)).toBeNull();
  });

  it('respeta cooldown de 10 minutos y sincroniza reloj único en StateMachine', () => {
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

    sm.evaluate(distrMetrics, 0);
    sm.evaluate(distrMetrics, 5_000);
    sm.evaluate(distrMetrics, 10_000);
    const alert1 = sm.evaluate(distrMetrics, 16_000);
    expect(alert1.alertToTrigger).toBe('DISTRACCION_HAPTIC');
    expect(alert1.distractedSec).toBe(16);

    const withinCooldown = sm.evaluate(distrMetrics, 300_000);
    expect(withinCooldown.alertToTrigger).toBeNull();
    expect(evaluateHeadPose(createNeutralLandmarks()).isAligned).toBe(true);
  });

  it('calcula calibración robusta P5/P95 descartando outliers extremos', () => {
    const ears = [0.09, 0.28, 0.29, 0.29, 0.3, 0.28, 0.29, 0.28, 0.29, 0.48];
    const xs = [
      0.01, // outlier extremo inferior
      0.28, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.72,
      0.99, // outlier extremo superior
    ];
    const ys = [0.02, 0.32, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.68, 0.98];

    const cal = computeRobustCalibration(ears, xs, ys);
    expect(cal.baselineEar).toBeCloseTo(0.289, 2);
    expect(cal.bounds.minGazeX).toBeGreaterThan(0.1);
    expect(cal.bounds.maxGazeX).toBeLessThan(0.85);
    expect(cal.bounds.minGazeY).toBeGreaterThan(0.1);
    expect(cal.bounds.maxGazeY).toBeLessThan(0.85);
  });

  it('corta la ventana deslizante en reverso y provee reloj monotónico', () => {
    const win = new BiometricSlidingWindow(10, 5_000);
    for (let t = 1_000; t <= 10_000; t += 1_000) {
      win.push({
        timestampMs: t,
        faceDetected: true,
        avgEar: 0.28,
        isEyeClosed: false,
        blinkCompleted: false,
        blinkDurationMs: 0,
        gazeX: 0.5,
        gazeY: 0.5,
        absDeltaX: 0.02,
        isSaccade: true,
        isFixated: false,
        isWithinBounds: true,
        isHeadAligned: true,
      });
    }

    const active = win.getSamples(10_000);
    expect(active.length).toBe(6); // t = 5000..10000
    expect(active[0].timestampMs).toBe(5_000);
    expect(active[active.length - 1].timestampMs).toBe(10_000);

    const t1 = monotonicNowMs();
    const t2 = monotonicNowMs();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});
