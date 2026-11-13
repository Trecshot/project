import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatDuration } from '../../components/CognitiveHUD';
import { TelemetryChart } from '../../components/TelemetryChart';
import {
  ReadingSessionRow,
  TelemetrySnapshotRow,
} from '../../database/schema';
import {
  deleteReadingSession,
  getReadingSessionById,
  getSessionSnapshots,
} from '../../database/telemetryRepository';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = Number(id);

  const [session, setSession] = useState<ReadingSessionRow | null>(null);
  const [snapshots, setSnapshots] = useState<TelemetrySnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!Number.isFinite(sessionId)) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const [sess, snaps] = await Promise.all([
          getReadingSessionById(sessionId),
          getSessionSnapshots(sessionId),
        ]);
        setSession(sess);
        setSnapshots(snaps);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  const handleDelete = () => {
    Alert.alert(
      'Eliminar sesión',
      '¿Seguro que deseas eliminar esta sesión y sus muestras?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            await deleteReadingSession(sessionId);
            router.back();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Sesión no encontrada.</Text>
      </View>
    );
  }

  const totalMonitored =
    session.effective_reading_sec + session.distracted_sec;
  const focusPct =
    totalMonitored > 0
      ? Math.round((session.effective_reading_sec / totalMonitored) * 100)
      : 100;

  const firstFatigueSnap = snapshots.find(
    (s) => s.cognitive_state === 'FATIGA_OCULAR'
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{session.document_title}</Text>
      <Text style={styles.dateText}>
        {new Date(session.start_time).toLocaleString()}
      </Text>

      <View style={styles.grid}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>
            {formatDuration(session.effective_reading_sec)}
          </Text>
          <Text style={styles.statLabel}>Lectura efectiva</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{focusPct}%</Text>
          <Text style={styles.statLabel}>Índice de foco</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>
            {session.avg_blink_rate > 0
              ? `${session.avg_blink_rate.toFixed(1)}/m`
              : '--'}
          </Text>
          <Text style={styles.statLabel}>Parpadeo medio</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: '#FB7185' }]}>
            {firstFatigueSnap
              ? `Min ${(firstFatigueSnap.timestamp_offset_sec / 60).toFixed(1)}`
              : 'Sin fatiga'}
          </Text>
          <Text style={styles.statLabel}>Inicio fatiga</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Evolución Atención vs. Fatiga</Text>
      <TelemetryChart snapshots={snapshots} />

      <Text style={styles.sectionTitle}>
        Muestras registradas ({snapshots.length})
      </Text>
      {snapshots.slice(-12).map((snap) => (
        <View key={snap.id} style={styles.snapRow}>
          <Text style={styles.snapTime}>
            {formatDuration(snap.timestamp_offset_sec)}
          </Text>
          <Text style={styles.snapState}>{snap.cognitive_state}</Text>
          <Text style={styles.snapEar}>EAR {snap.avg_ear.toFixed(2)}</Text>
        </View>
      ))}

      <Pressable style={styles.deleteBtn} onPress={handleDelete}>
        <Text style={styles.deleteBtnText}>Eliminar sesión</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  center: {
    flex: 1,
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800',
  },
  dateText: {
    color: '#64748B',
    fontSize: 12,
    marginBottom: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statBox: {
    width: '48%',
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  statValue: {
    color: '#38BDF8',
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
  },
  sectionTitle: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 6,
  },
  snapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  snapTime: {
    color: '#94A3B8',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  snapState: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  snapEar: {
    color: '#38BDF8',
    fontSize: 12,
  },
  deleteBtn: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(251, 113, 133, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(251, 113, 133, 0.35)',
  },
  deleteBtnText: {
    color: '#FB7185',
    fontWeight: '700',
    fontSize: 13,
  },
});
