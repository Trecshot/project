import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

export interface CalibrationPoint {
  id: string;
  label: string;
  xPercent: number;
  yPercent: number;
}

export const CALIBRATION_SEQUENCE: readonly CalibrationPoint[] = [
  { id: 'center', label: 'Centro', xPercent: 50, yPercent: 50 },
  { id: 'top-left', label: 'Superior Izquierda', xPercent: 12, yPercent: 14 },
  { id: 'top-right', label: 'Superior Derecha', xPercent: 88, yPercent: 14 },
  { id: 'bottom-right', label: 'Inferior Derecha', xPercent: 88, yPercent: 84 },
  { id: 'bottom-left', label: 'Inferior Izquierda', xPercent: 12, yPercent: 84 },
];

interface CalibrationTargetProps {
  currentStepIndex: number;
  isRunning: boolean;
}

/**
 * Punto luminoso guía que se desplaza por el centro y las 4 esquinas
 * para calibrar EAR basal y rango físico del iris.
 */
export function CalibrationTarget({
  currentStepIndex,
  isRunning,
}: CalibrationTargetProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const activePoint =
    CALIBRATION_SEQUENCE[
      Math.min(currentStepIndex, CALIBRATION_SEQUENCE.length - 1)
    ];

  useEffect(() => {
    if (!isRunning) {
      pulseAnim.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.35,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isRunning, pulseAnim]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {CALIBRATION_SEQUENCE.map((point, idx) => {
        const isActive = idx === currentStepIndex;
        const isDone = idx < currentStepIndex;
        return (
          <View
            key={point.id}
            style={[
              styles.anchor,
              {
                left: `${point.xPercent}%`,
                top: `${point.yPercent}%`,
              },
            ]}
          >
            {isActive ? (
              <Animated.View
                style={[
                  styles.activeOuter,
                  { transform: [{ scale: pulseAnim }] },
                ]}
              >
                <View style={styles.activeInner} />
              </Animated.View>
            ) : (
              <View
                style={[
                  styles.inactiveDot,
                  isDone ? styles.doneDot : styles.pendingDot,
                ]}
              />
            )}
          </View>
        );
      })}

      {isRunning && (
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>
            Mira el punto: {activePoint.label} ({currentStepIndex + 1}/
            {CALIBRATION_SEQUENCE.length})
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    width: 44,
    height: 44,
    marginLeft: -22,
    marginTop: -22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeOuter: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(56, 189, 248, 0.28)',
    borderWidth: 2,
    borderColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E0F2FE',
  },
  inactiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  doneDot: {
    backgroundColor: '#10B981',
    opacity: 0.85,
  },
  pendingDot: {
    backgroundColor: '#334155',
    opacity: 0.7,
  },
  stepBadge: {
    position: 'absolute',
    bottom: 130,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  stepBadgeText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
});
