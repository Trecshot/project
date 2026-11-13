import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CognitiveHUD } from '../components/CognitiveHUD';
import { DocumentViewer } from '../components/DocumentViewer';
import { DEFAULT_BASELINE_EAR } from '../core/biometrics/earEngine';
import {
  DEFAULT_GAZE_BOUNDS,
  GazeCalibrationBounds,
} from '../core/biometrics/saccadeEngine';
import {
  BiometricFrameSample,
  BiometricSlidingWindow,
} from '../core/cognitive/slidingWindow';
import {
  CognitiveState,
  CognitiveStateMachine,
  STATE_EVALUATION_INTERVAL_MS,
} from '../core/cognitive/stateMachine';
import { useBiometricFrameProcessor } from '../core/vision/frameProcessor';
import {
  Camera,
  useVisionTelemetrySetup,
} from '../core/vision/useFaceLandmarkModel';
import {
  createReadingSession,
  finishReadingSession,
  getLatestCalibration,
  insertTelemetrySnapshot,
} from '../database/telemetryRepository';
import { dispatchCognitiveAlert } from '../services/alertService';

const SAMPLE_STUDY_TEXT = `Neurobiología de la Atención y Fatiga Visual

Cuando leemos texto continuo en una pantalla, nuestros ojos no se deslizan suavemente; avanzan mediante pequeños saltos rápidos llamados sacadas horizontales, intercalados con fijaciones breves de 200 a 250 milisegundos donde el cerebro extrae la información léxica.

1. Parpadeo y película lagrimal
En condiciones de reposo, una persona parpadea entre 12 y 20 veces por minuto. Durante la lectura intensa en pantallas retroiluminadas, esa frecuencia puede caer por debajo de 5 parpadeos por minuto, provocando sequedad ocular y visión borrosa.

2. Bloqueos cognitivos (Mind-Wandering)
Antes de que percibas cansancio consciente, tus ojos suelen delatar la pérdida de foco: las sacadas horizontales se detienen (ΔX ≈ 0) mientras la mirada queda suspendida en una misma palabra durante varios segundos.

3. La regla 20-20-20
Cada 20 a 45 minutos de lectura sostenida, o al aparecer señales tempranas de PERCLOS elevado, relajar el músculo ciliar mirando un objeto a 6 metros durante 20 segundos restaura la acomodación visual y estabiliza la atención.`;

export default function ReaderScreen() {
  const params = useLocalSearchParams<{
    mode?: string;
    uri?: string;
    title?: string;
  }>();

  const mode = params.mode ?? 'text';
  const docTitle = params.title ?? 'Lectura sin título';
  const docUri = params.uri;

  const vision = useVisionTelemetrySetup();

  const [baselineEar, setBaselineEar] = useState(DEFAULT_BASELINE_EAR);
  const [gazeBounds, setGazeBounds] =
    useState<GazeCalibrationBounds>(DEFAULT_GAZE_BOUNDS);
  const [textContent, setTextContent] = useState(SAMPLE_STUDY_TEXT);
  const [base64Content, setBase64Content] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(17);

  const [cognitiveState, setCognitiveState] =
    useState<CognitiveState>('LECTURA_ACTIVA');
  const [stateReason, setStateReason] = useState('Monitoreando atención');
  const [avgEar, setAvgEar] = useState(DEFAULT_BASELINE_EAR);
  const [blinkRate, setBlinkRate] = useState(15);
  const [effectiveReadingSec, setEffectiveReadingSec] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [amberHighlight, setAmberHighlight] = useState(false);

  const sessionIdRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number>(Date.now());
  const hasFinalizedRef = useRef(false);
  const blinkRateSamplesRef = useRef<number[]>([]);
  const isPausedRef = useRef(false);
  const evalTickCountRef = useRef(0);

  const slidingWindow = useMemo(() => new BiometricSlidingWindow(), []);
  const stateMachine = useMemo(() => new CognitiveStateMachine(), []);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const persistSessionSummary = useCallback(
    async (isFinalClose: boolean) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      if (isFinalClose && hasFinalizedRef.current) return;
      if (isFinalClose) {
        hasFinalizedRef.current = true;
      }

      const nowMs = Date.now();
      stateMachine.advanceClock(nowMs, isPausedRef.current);

      const samples = blinkRateSamplesRef.current;
      const meanBlink =
        samples.length > 0
          ? samples.reduce((a, b) => a + b, 0) / samples.length
          : 0;

      await finishReadingSession({
        sessionId: sid,
        endTime: nowMs,
        effectiveReadingSec: stateMachine.getEffectiveReadingSec(),
        distractedSec: stateMachine.getDistractedSec(),
        fatigueEventsCount: stateMachine.getFatigueEventsCount(),
        avgBlinkRate: meanBlink,
      });
    },
    [stateMachine]
  );

  // Carga calibración, contenido del documento (incl. base64 PDF/EPUB) y crea sesión
  useEffect(() => {
    let active = true;
    (async () => {
      if (!vision.hasPermission) {
        await vision.requestPermission();
      }
      const cal = await getLatestCalibration();
      if (active && cal) {
        setBaselineEar(cal.baseline_ear);
        setGazeBounds({
          minGazeX: cal.min_gaze_x,
          maxGazeX: cal.max_gaze_x,
          minGazeY: cal.min_gaze_y,
          maxGazeY: cal.max_gaze_y,
        });
      }

      if (docUri) {
        try {
          if (mode === 'text') {
            const content = await FileSystem.readAsStringAsync(docUri);
            if (active && content) setTextContent(content);
          } else if (mode === 'pdf' || mode === 'epub') {
            const b64 = await FileSystem.readAsStringAsync(docUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            if (active && b64) setBase64Content(b64);
          }
        } catch {
          // Mantiene contenido de respaldo si falla la lectura local
        }
      }

      const id = await createReadingSession(docTitle, sessionStartRef.current);
      if (active) {
        sessionIdRef.current = id;
      }
    })();

    return () => {
      active = false;
      // Cierre seguro ante gestos Back nativos o desmontaje abrupto
      persistSessionSummary(true).catch(() => {});
    };
  }, [docTitle, docUri, mode, vision, persistSessionSummary]);

  // Guarda progreso cuando la app pasa a segundo plano o se apaga la pantalla
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        setIsPaused(true);
        persistSessionSummary(false).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [persistSessionSummary]);

  const onBiometricSample = useCallback(
    (sample: BiometricFrameSample) => {
      if (isPausedRef.current) return;
      slidingWindow.push(sample);
    },
    [slidingWindow]
  );

  const frameProcessor = useBiometricFrameProcessor(
    vision.model,
    {
      baselineEar,
      gazeBounds,
      faceDetectorModel: vision.faceDetectorModel,
      isActive: !isPaused && vision.modelReady,
    },
    onBiometricSample
  );

  // Reloj único de UI sincronizado con CognitiveStateMachine (1s)
  useEffect(() => {
    const tick = setInterval(() => {
      const sec = stateMachine.advanceClock(Date.now(), isPausedRef.current);
      setEffectiveReadingSec(sec);
    }, 1000);
    return () => clearInterval(tick);
  }, [stateMachine]);

  // Loop unificado: evalúa cada 5s y persiste snapshot cada 3 ticks (15s) sin recalcular dos veces
  useEffect(() => {
    const evalTimer = setInterval(() => {
      const nowMs = Date.now();
      const metrics = slidingWindow.computeMetrics(nowMs);
      const result = stateMachine.evaluate(
        metrics,
        nowMs,
        isPausedRef.current
      );

      setCognitiveState(result.state);
      setStateReason(result.reason);
      setEffectiveReadingSec(result.effectiveReadingSec);

      if (metrics.validFaceSampleCount > 0) {
        setAvgEar(metrics.avgEar);
        setBlinkRate(metrics.blinkRatePerMin);
        blinkRateSamplesRef.current.push(metrics.blinkRatePerMin);
      }

      if (result.state !== 'DISTRACCION_BLOQUEO') {
        setAmberHighlight(false);
      }

      if (result.alertToTrigger) {
        if (result.alertToTrigger === 'DISTRACCION_HAPTIC') {
          setAmberHighlight(true);
        }
        if (result.shouldPauseEffectiveReading) {
          setIsPaused(true);
          setShowBreakModal(true);
        }
        dispatchCognitiveAlert(result.alertToTrigger).catch(() => {});
      }

      evalTickCountRef.current += 1;
      const sid = sessionIdRef.current;
      if (
        sid &&
        !isPausedRef.current &&
        evalTickCountRef.current % 3 === 0
      ) {
        const offsetSec = Math.round((nowMs - sessionStartRef.current) / 1000);
        insertTelemetrySnapshot({
          sessionId: sid,
          timestampOffsetSec: offsetSec,
          cognitiveState: result.state,
          avgEar:
            metrics.validFaceSampleCount > 0 ? metrics.avgEar : baselineEar,
          saccadeFrequency: metrics.saccadeFrequencyHz,
        }).catch(() => {});
      }
    }, STATE_EVALUATION_INTERVAL_MS);

    return () => clearInterval(evalTimer);
  }, [slidingWindow, stateMachine, baselineEar]);

  const handleEndSession = async () => {
    const sid = sessionIdRef.current;
    await persistSessionSummary(true);
    if (sid) {
      router.replace(`/session/${sid}`);
    } else {
      router.back();
    }
  };

  const resumeFromBreak = () => {
    stateMachine.resetContinuousBreakTimer();
    setShowBreakModal(false);
    setIsPaused(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      {vision.device && vision.hasPermission && (
        <Camera
          style={styles.hiddenCamera}
          device={vision.device}
          format={vision.format}
          fps={15}
          isActive={!isPaused}
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
        />
      )}

      <View style={styles.topBar}>
        <Pressable style={styles.endBtn} onPress={handleEndSession}>
          <Text style={styles.endBtnText}>Finalizar</Text>
        </Pressable>
        <Text style={styles.docTitle} numberOfLines={1}>
          {docTitle}
        </Text>
        {mode === 'text' ? (
          <View style={styles.fontControls}>
            <Pressable
              style={styles.fontBtn}
              onPress={() => setFontSize((s) => Math.max(13, s - 2))}
            >
              <Text style={styles.fontBtnText}>A-</Text>
            </Pressable>
            <Pressable
              style={styles.fontBtn}
              onPress={() => setFontSize((s) => Math.min(26, s + 2))}
            >
              <Text style={styles.fontBtnText}>A+</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.fontControls} />
        )}
      </View>

      <View style={styles.hudWrapper}>
        <CognitiveHUD
          state={cognitiveState}
          reason={stateReason}
          effectiveReadingSec={effectiveReadingSec}
          avgEar={avgEar}
          blinkRatePerMin={blinkRate}
          isPaused={isPaused}
          isAmberHighlighted={amberHighlight}
          modelReady={vision.modelReady}
          onTogglePause={() => setIsPaused((p) => !p)}
        />
      </View>

      <DocumentViewer
        mode={mode}
        uri={docUri}
        textContent={textContent}
        base64Content={base64Content}
        fontSize={fontSize}
      />

      <Modal visible={showBreakModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Descanso Visual (Regla 20-20-20)</Text>
            <Text style={styles.modalBody}>
              Detectamos fatiga ocular o un bloque continuo de 45 minutos. Mira un
              punto a 6 metros de distancia durante 20 segundos para relajar la
              vista. El contador efectivo está en pausa.
            </Text>
            <Pressable style={styles.modalBtn} onPress={resumeFromBreak}>
              <Text style={styles.modalBtnText}>Ya descansé, reanudar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  hiddenCamera: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#1E293B',
    gap: 8,
  },
  endBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  endBtnText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  docTitle: {
    flex: 1,
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  fontControls: {
    flexDirection: 'row',
    gap: 6,
    minWidth: 64,
    justifyContent: 'flex-end',
  },
  fontBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
  },
  fontBtnText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  hudWrapper: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.8)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  modalBody: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 21,
  },
  modalBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  modalBtnText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 14,
  },
});
