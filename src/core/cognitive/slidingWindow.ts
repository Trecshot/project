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
 * Usa recorrido inverso con corte temprano (sin `.filter` ni arreglos intermedios).
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

  private getSampleBackwards(backOffset: number): BiometricFrameSample | undefined {
    const idx =
      (this.head - 1 - backOffset + this.capacity * 2) % this.capacity;
    return this.buffer[idx];
  }

  /**
   * Cuenta en O(K) cuántas muestras recientes caen dentro de la ventana activa
   * recorriendo en reverso hasta cruzar `minTimestamp`.
   */
  private countActiveWindowSamples(referenceNowMs?: number): number {
    if (this.size === 0) return 0;

    const newest = this.getSampleBackwards(0);
    if (!newest) return 0;

    const cutoffAnchor = referenceNowMs ?? newest.timestampMs;
    const minTimestamp = cutoffAnchor - this.windowDurationMs;

    let validCount = 0;
    for (let offset = 0; offset < this.size; offset++) {
      const item = this.getSampleBackwards(offset);
      if (!item || item.timestampMs < minTimestamp) {
        break;
      }
      validCount++;
    }

    return validCount;
  }

  /**
   * Devuelve las muestras ordenadas cronológicamente dentro de la ventana activa
   * en una sola pasada acotada (sin `.filter()`).
   */
  getSamples(referenceNowMs?: number): BiometricFrameSample[] {
    const validCount = this.countActiveWindowSamples(referenceNowMs);
    if (validCount === 0) return [];

    const result = new Array<BiometricFrameSample>(validCount);
    for (let i = 0; i < validCount; i++) {
      result[i] = this.getSampleBackwards(validCount - 1 - i)!;
    }
    return result;
  }

  /**
   * Calcula las métricas agregadas directamente sobre el buffer circular
   * sin instanciar arreglos intermedios (cero presión de GC).
   */
  computeMetrics(referenceNowMs?: number): WindowMetrics {
    const validCount = this.countActiveWindowSamples(referenceNowMs);
    if (validCount === 0) {
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

    const first = this.getSampleBackwards(validCount - 1)!;
    const latest = this.getSampleBackwards(0)!;
    const windowSpanMs = Math.max(0, latest.timestampMs - first.timestampMs);

    let validFaceSampleCount = 0;
    let earSum = 0;
    let closedCount = 0;
    let blinkCount = 0;
    let longBlinkCount = 0;
    let saccadeCount = 0;

    let fixationStartMs: number | null = null;
    let closedInFixationStartMs: number | null = null;
    let maxContinuousFixationMs = 0;

    let outOfBoundsStartMs: number | null = null;
    let maxContinuousOutOfBoundsMs = 0;

    for (let offset = validCount - 1; offset >= 0; offset--) {
      const s = this.getSampleBackwards(offset)!;

      if (!s.faceDetected) {
        fixationStartMs = null;
        closedInFixationStartMs = null;
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

      // Duración continua de mirada fija con tolerancia a parpadeos fisiológicos (<= 400 ms)
      if (s.isWithinBounds && (s.isFixated || s.isEyeClosed)) {
        if (s.isEyeClosed) {
          if (closedInFixationStartMs === null) {
            closedInFixationStartMs = s.timestampMs;
          }
          if (
            s.timestampMs - closedInFixationStartMs >
            LONG_BLINK_THRESHOLD_MS
          ) {
            fixationStartMs = null;
          } else if (fixationStartMs !== null) {
            maxContinuousFixationMs = Math.max(
              maxContinuousFixationMs,
              s.timestampMs - fixationStartMs
            );
          }
        } else {
          closedInFixationStartMs = null;
          if (fixationStartMs === null) {
            fixationStartMs = s.timestampMs;
          }
          maxContinuousFixationMs = Math.max(
            maxContinuousFixationMs,
            s.timestampMs - fixationStartMs
          );
        }
      } else {
        fixationStartMs = null;
        closedInFixationStartMs = null;
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

    return {
      sampleCount: validCount,
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
