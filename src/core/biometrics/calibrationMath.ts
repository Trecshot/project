import { DEFAULT_BASELINE_EAR } from './earEngine';
import {
  DEFAULT_GAZE_BOUNDS,
  GazeCalibrationBounds,
} from './saccadeEngine';

export interface ComputedCalibration {
  baselineEar: number;
  bounds: GazeCalibrationBounds;
}

/**
 * Calcula el percentil `p` (en [0, 1]) mediante interpolación lineal sobre un arreglo ordenado.
 */
export function computePercentile(
  sortedAsc: readonly number[],
  p: number
): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];

  const clampedP = Math.max(0, Math.min(1, p));
  const index = clampedP * (sortedAsc.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sortedAsc[lo];
  const weight = index - lo;
  return sortedAsc[lo] * (1 - weight) + sortedAsc[hi] * weight;
}

/**
 * Calcula umbrales de calibración robustos frente a outliers:
 * - EAR basal: media recortada entre P10 y P90
 * - Rango visual (X, Y): percentiles P5 y P95 en lugar de min/max absolutos
 */
export function computeRobustCalibration(
  earSamples: readonly number[],
  gazeXSamples: readonly number[],
  gazeYSamples: readonly number[]
): ComputedCalibration {
  let baselineEar = DEFAULT_BASELINE_EAR;
  if (earSamples.length > 0) {
    const sortedEars = [...earSamples].sort((a, b) => a - b);
    const start = Math.floor(sortedEars.length * 0.1);
    const end = Math.ceil(sortedEars.length * 0.9);
    const trimmed = sortedEars.slice(start, Math.max(start + 1, end));
    baselineEar = trimmed.reduce((acc, v) => acc + v, 0) / trimmed.length;
  }

  let minGazeX = DEFAULT_GAZE_BOUNDS.minGazeX;
  let maxGazeX = DEFAULT_GAZE_BOUNDS.maxGazeX;
  if (gazeXSamples.length >= 4) {
    const sortedX = [...gazeXSamples].sort((a, b) => a - b);
    minGazeX = computePercentile(sortedX, 0.05);
    maxGazeX = computePercentile(sortedX, 0.95);
  }

  let minGazeY = DEFAULT_GAZE_BOUNDS.minGazeY;
  let maxGazeY = DEFAULT_GAZE_BOUNDS.maxGazeY;
  if (gazeYSamples.length >= 4) {
    const sortedY = [...gazeYSamples].sort((a, b) => a - b);
    minGazeY = computePercentile(sortedY, 0.05);
    maxGazeY = computePercentile(sortedY, 0.95);
  }

  return {
    baselineEar,
    bounds: {
      minGazeX,
      maxGazeX: Math.max(maxGazeX, minGazeX + 0.05),
      minGazeY,
      maxGazeY: Math.max(maxGazeY, minGazeY + 0.05),
    },
  };
}
