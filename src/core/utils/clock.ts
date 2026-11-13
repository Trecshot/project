/**
 * Reloj monotónico de alta resolución (performance.now()) compatible con Worklets JSI.
 * Evita saltos negativos por sincronización NTP o cambios de reloj del sistema operativo.
 * `Date.now()` debe reservarse exclusivamente para estampas de tiempo persistidas (SQLite).
 */
export function monotonicNowMs(): number {
  'worklet';
  if (
    typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
  ) {
    return performance.now();
  }
  return Date.now();
}

/**
 * Registro estructurado de errores para evitar bloques catch silenciosos.
 */
export function logTelemetryError(
  scope: string,
  message: string,
  error: unknown
): void {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
  console.error(`[EyeTelemetry][${scope}] ${message} -> ${detail}`, error);
}
