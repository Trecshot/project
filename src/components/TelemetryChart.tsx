import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { CognitiveState } from '../core/cognitive/stateMachine';
import { TelemetrySnapshotRow } from '../database/schema';

interface TelemetryChartProps {
  snapshots: TelemetrySnapshotRow[];
  width?: number;
  height?: number;
}

const STATE_SCORE: Record<CognitiveState, number> = {
  LECTURA_ACTIVA: 1.0,
  DISTRACCION_BLOQUEO: 0.45,
  FATIGA_OCULAR: 0.1,
};

const STATE_COLOR: Record<CognitiveState, string> = {
  LECTURA_ACTIVA: '#34D399',
  DISTRACCION_BLOQUEO: '#FBBF24',
  FATIGA_OCULAR: '#FB7185',
};

/**
 * Gráfica temporal de Atención vs. Fatiga y evolución del EAR durante una sesión.
 */
export function TelemetryChart({
  snapshots,
  width = 330,
  height = 180,
}: TelemetryChartProps) {
  if (snapshots.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyText}>
          No hay muestras biométricas registradas en esta sesión.
        </Text>
      </View>
    );
  }

  const padLeft = 28;
  const padRight = 14;
  const padTop = 18;
  const padBottom = 26;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxOffset = Math.max(
    snapshots[snapshots.length - 1].timestamp_offset_sec,
    1
  );

  const mapX = (offsetSec: number) =>
    padLeft + (offsetSec / maxOffset) * chartW;
  const mapAttentionY = (score: number) =>
    padTop + (1 - score) * chartH;
  const mapEarY = (ear: number) => {
    const clamped = Math.max(0, Math.min(0.45, ear));
    return padTop + (1 - clamped / 0.45) * chartH;
  };

  const attentionPath = snapshots
    .map((s, idx) => {
      const x = mapX(s.timestamp_offset_sec).toFixed(1);
      const y = mapAttentionY(STATE_SCORE[s.cognitive_state] ?? 0.5).toFixed(1);
      return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const earPath = snapshots
    .map((s, idx) => {
      const x = mapX(s.timestamp_offset_sec).toFixed(1);
      const y = mapEarY(s.avg_ear).toFixed(1);
      return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <View style={styles.container}>
      <Svg width={width} height={height}>
        <Rect
          x={padLeft}
          y={padTop}
          width={chartW}
          height={chartH}
          rx={8}
          fill="#0F172A"
          stroke="#1E293B"
          strokeWidth={1}
        />

        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = padTop + ratio * chartH;
          return (
            <Line
              key={ratio}
              x1={padLeft}
              y1={y}
              x2={padLeft + chartW}
              y2={y}
              stroke="#1E293B"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          );
        })}

        {/* Curva EAR */}
        <Path
          d={earPath}
          fill="none"
          stroke="#38BDF8"
          strokeWidth={1.8}
          strokeOpacity={0.65}
        />

        {/* Curva Atención vs Fatiga */}
        <Path
          d={attentionPath}
          fill="none"
          stroke="#34D399"
          strokeWidth={2.5}
        />

        {snapshots.map((s) => (
          <Circle
            key={s.id}
            cx={mapX(s.timestamp_offset_sec)}
            cy={mapAttentionY(STATE_SCORE[s.cognitive_state] ?? 0.5)}
            r={3.5}
            fill={STATE_COLOR[s.cognitive_state] ?? '#94A3B8'}
          />
        ))}
      </Svg>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: '#34D399' }]} />
          <Text style={styles.legendText}>Atención</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: '#FBBF24' }]} />
          <Text style={styles.legendText}>Bloqueo</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: '#FB7185' }]} />
          <Text style={styles.legendText}>Fatiga</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: '#38BDF8' }]} />
          <Text style={styles.legendText}>EAR</Text>
        </View>
      </View>

      <Text style={styles.axisHint}>
        Eje horizontal: 0 min → {(maxOffset / 60).toFixed(1)} min
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
  },
  emptyBox: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  swatch: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  legendText: {
    color: '#CBD5E1',
    fontSize: 11,
  },
  axisHint: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 6,
  },
});
