import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CALIBRATION_SEQUENCE,
  CalibrationTarget,
} from '../components/CalibrationTarget';
import { computeRobustCalibration } from '../core/biometrics/calibrationMath';
import { DEFAULT_BASELINE_EAR } from '../core/biometrics/earEngine';
import { DEFAULT_GAZE_BOUNDS } from '../core/biometrics/saccadeEngine';
import { BiometricFrameSample } from '../core/cognitive/slidingWindow';
import { useBiometricFrameProcessor } from '../core/vision/frameProcessor';
import {
  Camera,
  useVisionTelemetrySetup,
} from '../core/vision/useFaceLandmarkModel';
import { saveCalibration } from '../database/telemetryRepository';

const STEP_DURATION_MS = 1000; // 5 pasos x 1s = 5 segundos

export default function CalibrationScreen() {
  const vision = useVisionTelemetrySetup();
  const [stepIndex, setStepIndex] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const earSamplesRef = useRef<number[]>([]);
  const gazeXSamplesRef = useRef<number[]>([]);
  const gazeYSamplesRef = useRef<number[]>([]);

  const handleSample = useCallback(
    (sample: BiometricFrameSample) => {
      // Descarta frames con ojos cerrados para evitar outliers en el rango del iris
      if (!isRunning || !sample.faceDetected || sample.isEyeClosed) return;
      if (sample.avgEar > 0.08) {
        earSamplesRef.current.push(sample.avgEar);
      }
      gazeXSamplesRef.current.push(sample.gazeX);
      gazeYSamplesRef.current.push(sample.gazeY);
    },
    [isRunning]
  );

  const frameProcessor = useBiometricFrameProcessor(
    vision.model,
    {
      baselineEar: DEFAULT_BASELINE_EAR,
      gazeBounds: DEFAULT_GAZE_BOUNDS,
      faceDetectorModel: vision.faceDetectorModel,
      isActive: isRunning && vision.modelReady,
    },
    handleSample
  );

  const finalizeCalibration = useCallback(async () => {
    const ears = earSamplesRef.current;
    const xs = gazeXSamplesRef.current;
    const ys = gazeYSamplesRef.current;

    const { baselineEar, bounds } = computeRobustCalibration(ears, xs, ys);

    await saveCalibration({
      baselineEar,
      minGazeX: bounds.minGazeX,
      maxGazeX: bounds.maxGazeX,
      minGazeY: bounds.minGazeY,
      maxGazeY: bounds.maxGazeY,
    });

    Alert.alert(
      'Calibración guardada',
      ears.length > 0
        ? `EAR basal: ${baselineEar.toFixed(3)} · Rango X [${bounds.minGazeX.toFixed(2)}, ${bounds.maxGazeX.toFixed(2)}] (${ears.length} muestras)`
        : 'Sin modelo TFLite activo: se guardaron umbrales base por defecto.',
      [{ text: 'Continuar', onPress: () => router.back() }]
    );
  }, []);

  useEffect(() => {
    if (!isRunning) return;

    const timer = setInterval(() => {
      setStepIndex((prev) => {
        const next = prev + 1;
        if (next >= CALIBRATION_SEQUENCE.length) {
          clearInterval(timer);
          setIsRunning(false);
          finalizeCalibration().catch((err) =>
            Alert.alert('Error', String(err))
          );
          return prev;
        }
        return next;
      });
    }, STEP_DURATION_MS);

    return () => clearInterval(timer);
  }, [isRunning, finalizeCalibration]);

  const startCalibration = async () => {
    if (!vision.hasPermission) {
      const granted = await vision.requestPermission();
      if (!granted) {
        Alert.alert(
          'Permiso requerido',
          'Se necesita acceso a la cámara frontal para calibrar tu EAR basal.'
        );
        return;
      }
    }
    earSamplesRef.current = [];
    gazeXSamplesRef.current = [];
    gazeYSamplesRef.current = [];
    setStepIndex(0);
    setIsRunning(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      {vision.device && vision.hasPermission && (
        <Camera
          style={styles.hiddenCamera}
          device={vision.device}
          format={vision.format}
          fps={15}
          isActive={isRunning}
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
        />
      )}

      <CalibrationTarget currentStepIndex={stepIndex} isRunning={isRunning} />

      <View style={styles.overlayBottom}>
        <Text style={styles.title}>Calibración Geométrica (5 segundos)</Text>
        <Text style={styles.subtitle}>
          Sigue el punto luminoso con la mirada sin mover bruscamente el teléfono.
          {!vision.modelReady
            ? `\nAviso: No se detectó ${vision.modelPathHint}; puedes probar el flujo o colocar el binario antes del build.`
            : ''}
        </Text>

        <View style={styles.actionsRow}>
          <Pressable
            style={styles.cancelBtn}
            onPress={() => router.back()}
            disabled={isRunning}
          >
            <Text style={styles.cancelText}>Volver</Text>
          </Pressable>
          <Pressable
            style={[styles.startBtn, isRunning && styles.disabledBtn]}
            onPress={startCalibration}
            disabled={isRunning}
          >
            <Text style={styles.startText}>
              {isRunning ? 'Calibrando...' : 'Comenzar (5s)'}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
    justifyContent: 'flex-end',
  },
  hiddenCamera: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
  },
  overlayBottom: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    borderTopWidth: 1,
    borderColor: '#1E293B',
    gap: 10,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  cancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#1E293B',
  },
  cancelText: {
    color: '#CBD5E1',
    fontWeight: '600',
  },
  startBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#0284C7',
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.5,
  },
  startText: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
});
