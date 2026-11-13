import { WindowMetrics } from './slidingWindow';

export type CognitiveState =
  | 'LECTURA_ACTIVA'
  | 'DISTRACCION_BLOQUEO'
  | 'FATIGA_OCULAR';

export type AlertType =
  | 'DISTRACCION_HAPTIC'
  | 'FATIGA_NOTIFICATION'
  | 'BREAK_45MIN_NOTIFICATION';

export interface StateEvaluationResult {
  state: CognitiveState;
  reason: string;
  alertToTrigger: AlertType | null;
  shouldPauseEffectiveReading: boolean;
  metrics: WindowMetrics;
}

export const STATE_EVALUATION_INTERVAL_MS = 5_000;
export const PERCLOS_FATIGUE_THRESHOLD = 0.15;
export const MIN_BLINK_RATE_PER_MIN = 5;
export const WARMUP_FOR_BLINK_RATE_MS = 15_000;
export const FIXATION_DISTRACTION_MS = 8_000;
export const OUT_OF_BOUNDS_DISTRACTION_MS = 4_000;
export const ACCUMULATED_DISTRACTION_ALERT_MS = 15_000;
export const CONTINUOUS_READING_BREAK_SEC = 45 * 60;
export const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Clasifica el estado cognitivo a partir de las métricas de la ventana de 30s.
 */
export function classifyCognitiveState(metrics: WindowMetrics): {
  state: CognitiveState;
  reason: string;
} {
  if (metrics.validFaceSampleCount === 0) {
    return {
      state: 'DISTRACCION_BLOQUEO',
      reason: 'Rostro no detectado en el encuadre',
    };
  }

  // 1. Reglas de FATIGA_OCULAR (máxima prioridad para salud visual)
  if (metrics.perclosRatio > PERCLOS_FATIGUE_THRESHOLD) {
    return {
      state: 'FATIGA_OCULAR',
      reason: `PERCLOS elevado (${Math.round(metrics.perclosRatio * 100)}%)`,
    };
  }

  if (metrics.longBlinkCount > 0) {
    return {
      state: 'FATIGA_OCULAR',
      reason: 'Parpadeos prolongados (> 400 ms)',
    };
  }

  if (
    metrics.windowSpanMs >= WARMUP_FOR_BLINK_RATE_MS &&
    metrics.blinkRatePerMin < MIN_BLINK_RATE_PER_MIN
  ) {
    return {
      state: 'FATIGA_OCULAR',
      reason: `Tasa de parpadeo muy baja (${metrics.blinkRatePerMin.toFixed(1)}/min)`,
    };
  }

  // 2. Reglas de DISTRACCION_BLOQUEO
  if (metrics.maxContinuousFixationMs > FIXATION_DISTRACTION_MS) {
    return {
      state: 'DISTRACCION_BLOQUEO',
      reason: 'Mirada fija sin avance horizontal (> 8s)',
    };
  }

  if (metrics.maxContinuousOutOfBoundsMs > OUT_OF_BOUNDS_DISTRACTION_MS) {
    return {
      state: 'DISTRACCION_BLOQUEO',
      reason: 'Mirada o cabeza fuera de pantalla (> 4s)',
    };
  }

  // 3. Estado nominal de LECTURA_ACTIVA
  if (
    metrics.latestHeadAligned &&
    metrics.latestWithinBounds &&
    metrics.saccadeCount > 0
  ) {
    return {
      state: 'LECTURA_ACTIVA',
      reason: 'Lectura fluida con sacadas y parpadeo estable',
    };
  }

  return {
    state: 'LECTURA_ACTIVA',
    reason: 'Lectura activa monitoreada',
  };
}

/**
 * Máquina de estados cognitivos con evaluación periódica, acumuladores
 * y cooldown de 10 minutos por tipo de alerta.
 */
export class CognitiveStateMachine {
  private currentState: CognitiveState = 'LECTURA_ACTIVA';
  private accumulatedDistractionMs = 0;
  private continuousEffectiveReadingSec = 0;
  private lastEvaluationAtMs: number | null = null;
  private lastAlertSentAt: Record<AlertType, number> = {
    DISTRACCION_HAPTIC: -Infinity,
    FATIGA_NOTIFICATION: -Infinity,
    BREAK_45MIN_NOTIFICATION: -Infinity,
  };

  reset(): void {
    this.currentState = 'LECTURA_ACTIVA';
    this.accumulatedDistractionMs = 0;
    this.continuousEffectiveReadingSec = 0;
    this.lastEvaluationAtMs = null;
    this.lastAlertSentAt = {
      DISTRACCION_HAPTIC: -Infinity,
      FATIGA_NOTIFICATION: -Infinity,
      BREAK_45MIN_NOTIFICATION: -Infinity,
    };
  }

  resetContinuousBreakTimer(): void {
    this.continuousEffectiveReadingSec = 0;
  }

  getCurrentState(): CognitiveState {
    return this.currentState;
  }

  getContinuousEffectiveReadingSec(): number {
    return this.continuousEffectiveReadingSec;
  }

  private canFireAlert(type: AlertType, nowMs: number): boolean {
    return nowMs - this.lastAlertSentAt[type] >= ALERT_COOLDOWN_MS;
  }

  private markAlertFired(type: AlertType, nowMs: number): void {
    this.lastAlertSentAt[type] = nowMs;
  }

  evaluate(
    metrics: WindowMetrics,
    nowMs: number,
    isPaused: boolean = false
  ): StateEvaluationResult {
    const elapsedMs =
      this.lastEvaluationAtMs !== null
        ? Math.max(0, nowMs - this.lastEvaluationAtMs)
        : STATE_EVALUATION_INTERVAL_MS;
    this.lastEvaluationAtMs = nowMs;

    if (isPaused) {
      return {
        state: this.currentState,
        reason: 'Sesión en pausa',
        alertToTrigger: null,
        shouldPauseEffectiveReading: true,
        metrics,
      };
    }

    const { state, reason } = classifyCognitiveState(metrics);
    this.currentState = state;

    if (state === 'LECTURA_ACTIVA') {
      this.continuousEffectiveReadingSec += elapsedMs / 1000;
      this.accumulatedDistractionMs = Math.max(
        0,
        this.accumulatedDistractionMs - elapsedMs * 0.5
      );
    } else if (state === 'DISTRACCION_BLOQUEO') {
      this.accumulatedDistractionMs += elapsedMs;
    }

    let alertToTrigger: AlertType | null = null;
    let shouldPauseEffectiveReading = false;

    if (
      state === 'FATIGA_OCULAR' &&
      this.canFireAlert('FATIGA_NOTIFICATION', nowMs)
    ) {
      alertToTrigger = 'FATIGA_NOTIFICATION';
      shouldPauseEffectiveReading = true;
      this.markAlertFired('FATIGA_NOTIFICATION', nowMs);
    } else if (
      this.continuousEffectiveReadingSec >= CONTINUOUS_READING_BREAK_SEC &&
      this.canFireAlert('BREAK_45MIN_NOTIFICATION', nowMs)
    ) {
      alertToTrigger = 'BREAK_45MIN_NOTIFICATION';
      shouldPauseEffectiveReading = true;
      this.markAlertFired('BREAK_45MIN_NOTIFICATION', nowMs);
    } else if (
      state === 'DISTRACCION_BLOQUEO' &&
      this.accumulatedDistractionMs > ACCUMULATED_DISTRACTION_ALERT_MS &&
      this.canFireAlert('DISTRACCION_HAPTIC', nowMs)
    ) {
      alertToTrigger = 'DISTRACCION_HAPTIC';
      this.markAlertFired('DISTRACCION_HAPTIC', nowMs);
      this.accumulatedDistractionMs = 0;
    }

    return {
      state,
      reason,
      alertToTrigger,
      shouldPauseEffectiveReading,
      metrics,
    };
  }
}
