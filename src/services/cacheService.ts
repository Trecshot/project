import * as FileSystem from 'expo-file-system';
import { logTelemetryError } from '../core/utils/clock';

const TEMP_DOC_EXTENSIONS = ['.pdf', '.epub', '.txt', '.md', '.tflite'];

/**
 * Purga archivos temporales copiados por DocumentPicker en `FileSystem.cacheDirectory`
 * para evitar fuga pasiva de almacenamiento tras múltiples sesiones de lectura.
 */
export async function purgeDocumentCache(specificUri?: string): Promise<void> {
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) return;

  try {
    if (specificUri && specificUri.startsWith(cacheDir)) {
      await FileSystem.deleteAsync(specificUri, { idempotent: true });
    }

    const pickerDir = `${cacheDir}DocumentPicker`;
    const pickerInfo = await FileSystem.getInfoAsync(pickerDir);
    if (pickerInfo.exists) {
      await FileSystem.deleteAsync(pickerDir, { idempotent: true });
    }

    const entries = await FileSystem.readDirectoryAsync(cacheDir);
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      if (TEMP_DOC_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        await FileSystem.deleteAsync(`${cacheDir}${entry}`, {
          idempotent: true,
        });
      }
    }
  } catch (err) {
    logTelemetryError(
      'CacheService',
      'Fallo purgando archivos temporales del directorio caché',
      err
    );
  }
}
