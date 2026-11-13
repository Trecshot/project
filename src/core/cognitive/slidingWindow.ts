import { LONG_BLINK_THRESHOLD_MS } from '../biometrics/earEngine';

export interface BiometricFrameSample {
  timestampMs: number;
  faceDetected: boolean;
  avgEar: number;
  isEyeClosed: boolean;
  blinkCompleted: boolean;
  blinkDurationMs: number;
  gazeX: number;
  gazeY: number;
  absDeltaX: number;
  isSaccade: boolean;
  isFixated: boolean;
  isWithinBounds: boolean;
  isHeadAligned: boolean;
}

export interface WindowMetrics {
  sampleCount: number;
  validFaceSampleCount: number;
  windowSpanMs: number;
  avgEar: number;
  perclosRatio: number;
  blinkCount: number;
  blinkRatePerMin: number;
  longBlinkCount: number;
  saccadeCount: number;
  saccadeFrequencyHz: number;
  maxContinuousFixationMs: number;
  maxContinuousOutOfBoundsMs: number;
  latestHeadAligned: boolean;
  latestWithinBounds: boolean;
}

export const DEFAULT_WINDOW_DURATION_MS = 30_000;
export const DEFAULT_BUFFER_CAPACITY = 600; // Hasta 30s @ 20 FPS (450 @ 15 FPS)

/**
 * Buffer circular en memoria para almacenar muestras biométricas de los últimos 30-60s.
 */
export class BiometricSlidingWindow {
  private readonly capacity: number;
  private readonly windowDurationMs: number;
  private readonly buffer: (BiometricFrameSample | undefined)[];
  private head = 0;
  private size = 0;

  constructor(
    capacity: number = DEFAULT_BUFFER_CAPACITY,
    windowDurationMs: number = DEFAULT_WINDOW_DURATION_MS
  ) {
    this.capacity = Math.max(1, capacity);
    this.windowDurationMs = Math.max(1000, windowDurationMs);
    this.buffer = new Array<BiometricFrameSample | undefined>(this.capacity);
  }

  push(sample: BiometricFrameSample): void {
    this.buffer[this.head] = sample;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.size = 0;
  }

  /**
   * Devuelve las muestras ordenadas cronológicamente dentro de la ventana activa.
   */
  getSamples(referenceNowMs?: number): BiometricFrameSample[] {
    if (this.size === 0) return [];

    const ordered: BiometricFrameSample[] = [];
    const startIdx = this.size === this.capacity ? this.head : 0;

    for (let i = 0; i < this.size; i++) {
      const item = this.buffer[(startIdx + i) % this.capacity];
      if (item) ordered.push(item);
    }

    if (ordered.length === 0) return [];

    const cutoffAnchor =
      referenceNowMs ?? ordered[ordered.length - 1].timestampMs;
    const minTimestamp = cutoffAnchor - this.windowDurationMs;

    return ordered.filter((s) => s.timestampMs >= minTimestamp);
  }

  /**
   * Calcula las métricas agregadas de la ventana deslizante para la máquina de estados.
   */
  computeMetrics(referenceNowMs?: number): WindowMetrics {
    const samples = this.getSamples(referenceNowMs);
    if (samples.length === 0) {
      return {
        sampleCount: 0,
        validFaceSampleCount: 0,
        windowSpanMs: 0,
        avgEar: 0,
        perclosRatio: 0,
        blinkCount: 0,
        blinkRatePerMin: 0,
        longBlinkCount: 0,
        saccadeCount: 0,
        saccadeFrequencyHz: 0,
        maxContinuousFixationMs: 0,
        maxContinuousOutOfBoundsMs: 0,
        latestHeadAligned: false,
        latestWithinBounds: false,
      };
    }

    const firstTs = samples[0].timestampMs;
    const lastTs = samples[samples.length - 1].timestampMs;
    const windowSpanMs = Math.max(0, lastTs - firstTs);

    let validFaceSampleCount = 0;
    let earSum = 0;
    let closedCount = 0;
    let blinkCount = 0;
    let longBlinkCount = 0;
    let saccadeCount = 0;

    let fixationStartMs: number | null = null;
    let maxContinuousFixationMs = 0;

    let outOfBoundsStartMs: number | null = null;
    let maxContinuousOutOfBoundsMs = 0;

    for (const s of samples) {
      if (!s.faceDetected) {
        fixationStartMs = null;
        if (outOfBoundsStartMs === null) {
          outOfBoundsStartMs = s.timestampMs;
        }
        maxContinuousOutOfBoundsMs = Math.max(
          maxContinuousOutOfBoundsMs,
          s.timestampMs - outOfBoundsStartMs
        );
        continue;
      }

      validFaceSampleCount++;
      earSum += s.avgEar;
      if (s.isEyeClosed) closedCount++;

      if (s.blinkCompleted) {
        blinkCount++;
        if (s.blinkDurationMs > LONG_BLINK_THRESHOLD_MS) {
          longBlinkCount++;
        }
      }

      if (s.isSaccade) {
        saccadeCount++;
      }

      // Duración continua de mirada fija (ojos abiertos + dentro de pantalla + ΔX ≈ 0)
      if (!s.isEyeClosed && s.isWithinBounds && s.isFixated) {
        if (fixationStartMs === null) {
          fixationStartMs = s.timestampMs;
        }
        maxContinuousFixationMs = Math.max(
          maxContinuousFixationMs,
          s.timestampMs - fixationStartMs
        );
      } else {
        fixationStartMs = null;
      }

      // Duración continua de iris fuera de límites calibrados o cabeza desalineada
      if (!s.isWithinBounds || !s.isHeadAligned) {
        if (outOfBoundsStartMs === null) {
          outOfBoundsStartMs = s.timestampMs;
        }
        maxContinuousOutOfBoundsMs = Math.max(
          maxContinuousOutOfBoundsMs,
          s.timestampMs - outOfBoundsStartMs
        );
      } else {
        outOfBoundsStartMs = null;
      }
    }

    const spanSec = Math.max(windowSpanMs / 1000, 1);
    const avgEar = validFaceSampleCount > 0 ? earSum / validFaceSampleCount : 0;
    const perclosRatio =
      validFaceSampleCount > 0 ? closedCount / validFaceSampleCount : 0;
    const blinkRatePerMin = (blinkCount / spanSec) * 60;
    const saccadeFrequencyHz = saccadeCount / spanSec;
    const latest = samples[samples.length - 1];

    return {
      sampleCount: samples.length,
      validFaceSampleCount,
      windowSpanMs,
      avgEar,
      perclosRatio,
      blinkCount,
      blinkRatePerMin,
      longBlinkCount,
      saccadeCount,
      saccadeFrequencyHz,
      maxContinuousFixationMs,
      maxContinuousOutOfBoundsMs,
      latestHeadAligned: latest.isHeadAligned,
      latestWithinBounds: latest.isWithinBounds,
    };
  }
}
