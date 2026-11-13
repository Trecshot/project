import React, { createContext, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDatabase } from '../database/dbClient';
import { initializeAlerts } from '../services/alertService';

interface DatabaseContextValue {
  isReady: boolean;
  error: string | null;
}

const DatabaseContext = createContext<DatabaseContextValue>({
  isReady: false,
  error: null,
});

export function useDatabaseStatus(): DatabaseContextValue {
  return useContext(DatabaseContext);
}

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await getDatabase();
        await initializeAlerts();
        if (mounted) {
          setIsReady(true);
        }
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : 'Error inicializando SQLite'
          );
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <DatabaseContext.Provider value={{ isReady, error }}>
        <StatusBar style="light" />
        {!isReady ? (
          <View style={styles.bootContainer}>
            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : (
              <>
                <ActivityIndicator size="large" color="#38BDF8" />
                <Text style={styles.bootText}>
                  Inicializando base de datos biométrica...
                </Text>
              </>
            )}
          </View>
        ) : (
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: '#0B1120' },
              headerTintColor: '#F8FAFC',
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: '#020617' },
            }}
          >
            <Stack.Screen
              name="index"
              options={{ title: 'Eye Telemetry' }}
            />
            <Stack.Screen
              name="calibration"
              options={{
                title: 'Calibración Ocular',
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="reader"
              options={{
                title: 'Lector Instrumentado',
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="session/[id]"
              options={{ title: 'Detalle de Sesión' }}
            />
          </Stack>
        )}
      </DatabaseContext.Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  bootContainer: {
    flex: 1,
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  bootText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  errorText: {
    color: '#FB7185',
    fontSize: 14,
    textAlign: 'center',
  },
});
