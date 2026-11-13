import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router, useFocusEffect } from 'expo-router';
import { formatDuration } from '../components/CognitiveHUD';
import {
  GlobalTelemetryStats,
  ReadingSessionRow,
  UserCalibrationRow,
} from '../database/schema';
import {
  getGlobalStats,
  getLatestCalibration,
  listReadingSessions,
} from '../database/telemetryRepository';

export default function DashboardScreen() {
  const [calibration, setCalibration] = useState<UserCalibrationRow | null>(null);
  const [stats, setStats] = useState<GlobalTelemetryStats | null>(null);
  const [sessions, setSessions] = useState<ReadingSessionRow[]>([]);
  const [webUrl, setWebUrl] = useState('');

  const loadDashboard = useCallback(async () => {
    const [cal, globalStats, recentSessions] = await Promise.all([
      getLatestCalibration(),
      getGlobalStats(),
      listReadingSessions(25),
    ]);
    setCalibration(cal);
    setStats(globalStats);
    setSessions(recentSessions);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDashboard().catch((err) =>
        console.warn('Error cargando dashboard:', err)
      );
    }, [loadDashboard])
  );

  const openSampleReader = () => {
    router.push({
      pathname: '/reader',
      params: {
        mode: 'text',
        title: 'Lectura de prueba: Neurobiología de la Atención',
      },
    });
  };

  const openWebReader = () => {
    const trimmed = webUrl.trim();
    if (!trimmed) {
      Alert.alert('URL requerida', 'Ingresa el enlace de un artículo web.');
      return;
    }
    const normalized =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;

    router.push({
      pathname: '/reader',
      params: {
        mode: 'web',
        uri: normalized,
        title: normalized.replace(/^https?:\/\//, '').slice(0, 48),
      },
    });
  };

  const pickLocalDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/plain',
          'text/markdown',
          'application/pdf',
          'application/epub+zip',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const asset = result.assets[0];
      const lowerName = (asset.name ?? '').toLowerCase();
      const mode = lowerName.endsWith('.pdf')
        ? 'pdf'
        : lowerName.endsWith('.epub')
        ? 'epub'
        : 'text';

      router.push({
        pathname: '/reader',
        params: {
          mode,
          uri: asset.uri,
          title: asset.name ?? 'Documento local',
        },
      });
    } catch {
      Alert.alert('Error', 'No se pudo abrir el selector de documentos.');
    }
  };

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={sessions}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={
        <View style={styles.headerBlock}>
          {/* Estado de calibración */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Calibración biométrica</Text>
              <View
                style={[
                  styles.badge,
                  calibration ? styles.badgeOk : styles.badgeWarn,
                ]}
              >
                <Text style={styles.badgeText}>
                  {calibration ? 'Calibrado' : 'Pendiente'}
                </Text>
              </View>
            </View>
            <Text style={styles.cardSubtitle}>
              {calibration
                ? `EAR basal: ${calibration.baseline_ear.toFixed(3)} · Iris X [${calibration.min_gaze_x.toFixed(2)}, ${calibration.max_gaze_x.toFixed(2)}]`
                : 'Calibra tus párpados y rango visual antes de leer para evitar falsos positivos.'}
            </Text>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => router.push('/calibration')}
            >
              <Text style={styles.secondaryBtnText}>
                {calibration ? 'Recalibrar mirada (5s)' : 'Iniciar calibración (5s)'}
              </Text>
            </Pressable>
          </View>

          {/* Lanzador del Lector Instrumentado */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nueva sesión de lectura</Text>
            <View style={styles.buttonRow}>
              <Pressable style={styles.primaryBtn} onPress={openSampleReader}>
                <Text style={styles.primaryBtnText}>Texto guiado</Text>
              </Pressable>
              <Pressable style={styles.secondaryBtnFlex} onPress={pickLocalDocument}>
                <Text style={styles.secondaryBtnText}>Abrir TXT / PDF / EPUB</Text>
              </Pressable>
            </View>
            <View style={styles.urlRow}>
              <TextInput
                value={webUrl}
                onChangeText={setWebUrl}
                placeholder="https://articulo-web..."
                placeholderTextColor="#64748B"
                autoCapitalize="none"
                keyboardType="url"
                style={styles.urlInput}
              />
              <Pressable style={styles.urlBtn} onPress={openWebReader}>
                <Text style={styles.urlBtnText}>Web</Text>
              </Pressable>
            </View>
          </View>

          {/* Métricas globales */}
          <View style={styles.metricsGrid}>
            <View style={styles.metricBox}>
              <Text style={styles.metricVal}>
                {formatDuration(stats?.totalEffectiveReadingSec ?? 0)}
              </Text>
              <Text style={styles.metricLbl}>Lectura efectiva</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricVal}>
                {stats && stats.avgBlinkRate > 0
                  ? `${stats.avgBlinkRate.toFixed(1)}/m`
                  : '--'}
              </Text>
              <Text style={styles.metricLbl}>Parpadeo medio</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricVal}>
                {stats?.avgFatigueOnsetMin !== null &&
                stats?.avgFatigueOnsetMin !== undefined
                  ? `${stats.avgFatigueOnsetMin} min`
                  : '--'}
              </Text>
              <Text style={styles.metricLbl}>Caída de foco</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Historial de sesiones</Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            Aún no tienes sesiones registradas. Inicia una lectura para ver tu
            curva de atención y fatiga.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={styles.sessionCard}
          onPress={() => router.push(`/session/${item.id}`)}
        >
          <View style={styles.sessionTop}>
            <Text style={styles.sessionTitle} numberOfLines={1}>
              {item.document_title}
            </Text>
            <Text style={styles.sessionDate}>
              {new Date(item.start_time).toLocaleDateString()}
            </Text>
          </View>
          <View style={styles.sessionMetaRow}>
            <Text style={styles.sessionMeta}>
              Efectivo: {formatDuration(item.effective_reading_sec)}
            </Text>
            <Text style={styles.sessionMeta}>
              Bloqueos: {formatDuration(item.distracted_sec)}
            </Text>
            <Text style={styles.sessionMetaFatigue}>
              Fatiga: {item.fatigue_events_count}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  headerBlock: {
    gap: 14,
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 10,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeOk: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  badgeWarn: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  badgeText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#0284C7',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryBtn: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryBtnFlex: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#E2E8F0',
    fontWeight: '600',
    fontSize: 13,
  },
  urlRow: {
    flexDirection: 'row',
    gap: 8,
  },
  urlInput: {
    flex: 1,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#F8FAFC',
    fontSize: 13,
  },
  urlBtn: {
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  urlBtnText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  metricBox: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
  },
  metricVal: {
    color: '#38BDF8',
    fontSize: 17,
    fontWeight: '800',
  },
  metricLbl: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  sectionTitle: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  emptyCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  sessionCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 10,
    gap: 6,
  },
  sessionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  sessionTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  sessionDate: {
    color: '#64748B',
    fontSize: 12,
  },
  sessionMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sessionMeta: {
    color: '#94A3B8',
    fontSize: 12,
  },
  sessionMetaFatigue: {
    color: '#FB7185',
    fontSize: 12,
    fontWeight: '600',
  },
});
