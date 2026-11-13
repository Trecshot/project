import { FaceCropRect } from './landmarkIndices';

export const BLAZEFACE_INPUT_SIZE = 128;
export const BLAZEFACE_NUM_ANCHORS = 896;
export const BLAZEFACE_SCORE_THRESHOLD = 0.5;
export const BLAZEFACE_ROI_EXPANSION = 1.45;

/**
 * Precalcula los 896 centros (x, y) de anclas SSD para MediaPipe BlazeFace short-range (128x128):
 * - Capa 1: mapa 16x16 con 2 anclas por celda (512 anclas)
 * - Capa 2: mapa 8x8 con 6 anclas por celda (384 anclas)
 */
function buildBlazeFaceAnchors(): {
  anchorsX: Float32Array;
  anchorsY: Float32Array;
} {
  const anchorsX = new Float32Array(BLAZEFACE_NUM_ANCHORS);
  const anchorsY = new Float32Array(BLAZEFACE_NUM_ANCHORS);
  let idx = 0;

  // Capa 16x16 x 2
  for (let y = 0; y < 16; y++) {
    const cy = (y + 0.5) / 16;
    for (let x = 0; x < 16; x++) {
      const cx = (x + 0.5) / 16;
      for (let a = 0; a < 2; a++) {
        anchorsX[idx] = cx;
        anchorsY[idx] = cy;
        idx++;
      }
    }
  }

  // Capa 8x8 x 6
  for (let y = 0; y < 8; y++) {
    const cy = (y + 0.5) / 8;
    for (let x = 0; x < 8; x++) {
      const cx = (x + 0.5) / 8;
      for (let a = 0; a < 6; a++) {
        anchorsX[idx] = cx;
        anchorsY[idx] = cy;
        idx++;
      }
    }
  }

  return { anchorsX, anchorsY };
}

const PRECOMPUTED = buildBlazeFaceAnchors();
export const BLAZEFACE_ANCHORS_X = PRECOMPUTED.anchorsX;
export const BLAZEFACE_ANCHORS_Y = PRECOMPUTED.anchorsY;

function sigmoid(x: number): number {
  'worklet';
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function clamp01(val: number): number {
  'worklet';
  return Math.max(0, Math.min(1, val));
}

/**
 * Decodifica los tensores SSD de BlazeFace ([1, 896, 16] regresiones + [1, 896, 1] logits),
 * selecciona la detección con mayor confianza tras sigmoide y devuelve el recorte ROI cuadrado
 * tanto en píxeles de frame como en coordenadas normalizadas [0, 1].
 */
export function decodeBlazeFaceBestBox(
  regressions: ArrayLike<number> | undefined,
  scores: ArrayLike<number> | undefined,
  frameWidth: number,
  frameHeight: number,
  anchorsX: Float32Array = BLAZEFACE_ANCHORS_X,
  anchorsY: Float32Array = BLAZEFACE_ANCHORS_Y
): { pixelCrop: FaceCropRect; normCrop: FaceCropRect; score: number } | undefined {
  'worklet';
  if (
    !regressions ||
    !scores ||
    regressions.length < BLAZEFACE_NUM_ANCHORS * 16 ||
    scores.length < BLAZEFACE_NUM_ANCHORS
  ) {
    return undefined;
  }

  let bestIdx = -1;
  let bestScore = BLAZEFACE_SCORE_THRESHOLD;

  for (let i = 0; i < BLAZEFACE_NUM_ANCHORS; i++) {
    const rawLogit = scores[i];
    if (!Number.isFinite(rawLogit)) continue;
    const prob = sigmoid(rawLogit);
    if (prob > bestScore) {
      bestScore = prob;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) {
    return undefined;
  }

  const base = bestIdx * 16;
  const dx = regressions[base];
  const dy = regressions[base + 1];
  const dw = regressions[base + 2];
  const dh = regressions[base + 3];

  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    !Number.isFinite(dw) ||
    !Number.isFinite(dh)
  ) {
    return undefined;
  }

  const cx = dx / BLAZEFACE_INPUT_SIZE + anchorsX[bestIdx];
  const cy = dy / BLAZEFACE_INPUT_SIZE + anchorsY[bestIdx];
  const boxW = Math.abs(dw) / BLAZEFACE_INPUT_SIZE;
  const boxH = Math.abs(dh) / BLAZEFACE_INPUT_SIZE;

  const side = Math.min(1, Math.max(boxW, boxH) * BLAZEFACE_ROI_EXPANSION);
  if (side <= 0.05) {
    return undefined;
  }

  const normX = clamp01(cx - side * 0.5);
  const normY = clamp01(cy - side * 0.5);
  const normW = Math.min(1 - normX, side);
  const normH = Math.min(1 - normY, side);

  return {
    pixelCrop: {
      x: Math.round(normX * frameWidth),
      y: Math.round(normY * frameHeight),
      width: Math.max(1, Math.round(normW * frameWidth)),
      height: Math.max(1, Math.round(normH * frameHeight)),
    },
    normCrop: { x: normX, y: normY, width: normW, height: normH },
    score: bestScore,
  };
}
