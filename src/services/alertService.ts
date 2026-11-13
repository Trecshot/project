import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { AlertType } from '../core/cognitive/stateMachine';
import { logTelemetryError } from '../core/utils/clock';

const BREAK_CHANNEL_ID = 'eye-telemetry-breaks';

let notificationsConfigured = false;

/**
 * Configura el manejador y canal de notificaciones locales con sonido suave.
 */
export async function initializeAlerts(): Promise<boolean> {
  if (!notificationsConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(BREAK_CHANNEL_ID, {
        name: 'Descansos visuales (Regla 20-20-20)',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'soft_chime.wav',
        vibrationPattern: [0, 120, 80, 120],
        enableVibrate: true,
      });
    }
    notificationsConfigured = true;
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') {
    return true;
  }
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

/**
 * Micro-vibración doble para reenfocar la atención en DISTRACCION_BLOQUEO (> 15s).
 */
export async function triggerDistractionHaptic(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await new Promise((resolve) => setTimeout(resolve, 140));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch (err) {
    logTelemetryError(
      'AlertService',
      'Fallo ejecutando micro-vibración háptica',
      err
    );
  }
}

/**
 * Notificación local con sonido suave recomendando aplicar la regla 20-20-20.
 */
export async function triggerBreakNotification(
  reason: 'FATIGA_OCULAR' | 'BREAK_45MIN'
): Promise<void> {
  const title =
    reason === 'FATIGA_OCULAR'
      ? 'Fatiga ocular detectada'
      : '45 minutos de lectura continua';
  const body =
    'Aplica la regla 20-20-20: mira un punto a 6 metros de distancia durante 20 segundos antes de continuar.';

  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch (err) {
    logTelemetryError('AlertService', 'Fallo en háptico de advertencia', err);
  }

  try {
    await initializeAlerts();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'soft_chime.wav',
        data: { reason },
      },
      trigger: null,
    });
  } catch (err) {
    logTelemetryError(
      'AlertService',
      'Error programando notificación local de descanso',
      err
    );
  }
}

/**
 * Despacha la intervención correspondiente según el evento de la máquina de estados.
 */
export async function dispatchCognitiveAlert(
  alertType: AlertType
): Promise<void> {
  switch (alertType) {
    case 'DISTRACCION_HAPTIC':
      await triggerDistractionHaptic();
      break;
    case 'FATIGA_NOTIFICATION':
      await triggerBreakNotification('FATIGA_OCULAR');
      break;
    case 'BREAK_45MIN_NOTIFICATION':
      await triggerBreakNotification('BREAK_45MIN');
      break;
  }
}
