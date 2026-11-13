import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon, Rect } from 'react-native-svg';
import { CognitiveState } from '../core/cognitive/stateMachine';

interface CognitiveHUDProps {
  state: CognitiveState;
  reason: string;
  effectiveReadingSec: number;
  avgEar: number;
  blinkRatePerMin: number;
  isPaused: boolean;
  isAmberHighlighted: boolean;
  modelReady: boolean;
  onTogglePause: () => void;
}

const STATE_VISUALS: Record<
  CognitiveState,
  { label: string; color: string; bg: string; border: string }
> = {
  LECTURA_ACTIVA: {
    label: 'Lectura activa',
    color: '#34D399',
    bg: 'rgba(6, 78, 59, 0.82)',
    border: 'rgba(52, 211, 153, 0.45)',
  },
  DISTRACCION_BLOQUEO: {
    label: 'Distracción / Bloqueo',
    color: '#FBBF24',
    bg: 'rgba(120, 53, 15, 0.88)',
    border: 'rgba(251, 191, 36, 0.7)',
  },
  FATIGA_OCULAR: {
    label: 'Fatiga ocular',
    color: '#FB7185',
    bg: 'rgba(136, 19, 55, 0.88)',
    border: 'rgba(251, 113, 133, 0.7)',
  },
};

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Píldora flotante minimalista superpuesta sobre el lector con métricas en vivo.
 */
export function CognitiveHUD({
  state,
  reason,
  effectiveReadingSec,
  avgEar,
  blinkRatePerMin,
  isPaused,
  isAmberHighlighted,
  modelReady,
  onTogglePause,
}: CognitiveHUDProps) {
  const visual = isAmberHighlighted
    ? STATE_VISUALS.DISTRACCION_BLOQUEO
    : STATE_VISUALS[state];

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: isPaused ? 'rgba(30, 41, 59, 0.92)' : visual.bg,
          borderColor: isPaused ? '#64748B' : visual.border,
        },
      ]}
    >
      <View style={styles.leftRow}>
        <View
          style={[
            styles.dot,
            { backgroundColor: isPaused ? '#94A3B8' : visual.color },
          ]}
        />
        <View style={styles.textCol}>
          <Text style={styles.stateText} numberOfLines={1}>
            {isPaused ? 'Pausa (20-20-20)' : visual.label}
          </Text>
          <Text style={styles.metaText} numberOfLines={1}>
            {modelReady
              ? `EAR ${avgEar.toFixed(2)} · ${Math.round(blinkRatePerMin)}/min · ${reason}`
              : 'Cámara sin modelo TFLite (modo lector)'}
          </Text>
        </View>
      </View>

      <View style={styles.rightRow}>
        <Text style={styles.timerText}>{formatDuration(effectiveReadingSec)}</Text>
        <Pressable
          onPress={onTogglePause}
          style={styles.pauseBtn}
          accessibilityLabel={isPaused ? 'Reanudar lectura' : 'Pausar lectura'}
        >
          {isPaused ? (
            <Svg width={12} height={12} viewBox="0 0 12 12">
              <Polygon points="2.5,1.5 10.5,6 2.5,10.5" fill="#F8FAFC" />
            </Svg>
          ) : (
            <Svg width={12} height={12} viewBox="0 0 12 12">
              <Rect x={2} y={1.8} width={2.8} height={8.4} rx={0.8} fill="#F8FAFC" />
              <Rect x={7.2} y={1.8} width={2.8} height={8.4} rx={0.8} fill="#F8FAFC" />
            </Svg>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 9,
  },
  textCol: {
    flex: 1,
  },
  stateText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  metaText: {
    color: '#CBD5E1',
    fontSize: 10,
    marginTop: 1,
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timerText: {
    color: '#F1F5F9',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  pauseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
