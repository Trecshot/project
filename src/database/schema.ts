import { CognitiveState } from '../core/cognitive/stateMachine';

export interface ReadingSessionRow {
  id: number;
  document_title: string;
  start_time: number;
  end_time: number | null;
  effective_reading_sec: number;
  distracted_sec: number;
  fatigue_events_count: number;
  avg_blink_rate: number;
}

export interface TelemetrySnapshotRow {
  id: number;
  session_id: number;
  timestamp_offset_sec: number;
  cognitive_state: CognitiveState;
  avg_ear: number;
  saccade_frequency: number;
}

export interface UserCalibrationRow {
  id: number;
  baseline_ear: number;
  min_gaze_x: number;
  max_gaze_x: number;
  min_gaze_y: number;
  max_gaze_y: number;
  updated_at: number;
}

export interface GlobalTelemetryStats {
  totalSessions: number;
  totalEffectiveReadingSec: number;
  totalDistractedSec: number;
  totalFatigueEvents: number;
  avgBlinkRate: number;
  avgFatigueOnsetMin: number | null;
}

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS reading_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_title TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    effective_reading_sec INTEGER NOT NULL DEFAULT 0,
    distracted_sec INTEGER NOT NULL DEFAULT 0,
    fatigue_events_count INTEGER NOT NULL DEFAULT 0,
    avg_blink_rate REAL NOT NULL DEFAULT 0
  );`,
  `CREATE TABLE IF NOT EXISTS telemetry_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    timestamp_offset_sec INTEGER NOT NULL,
    cognitive_state TEXT NOT NULL,
    avg_ear REAL NOT NULL,
    saccade_frequency REAL NOT NULL,
    FOREIGN KEY (session_id) REFERENCES reading_sessions(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS user_calibration (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baseline_ear REAL NOT NULL,
    min_gaze_x REAL NOT NULL,
    max_gaze_x REAL NOT NULL,
    min_gaze_y REAL NOT NULL,
    max_gaze_y REAL NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_start_time
    ON reading_sessions (start_time DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_session_offset
    ON telemetry_snapshots (session_id, timestamp_offset_sec ASC);`,
];
