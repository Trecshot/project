import { CognitiveState } from '../core/cognitive/stateMachine';
import { getDatabase, withDbTransaction } from './dbClient';
import {
  GlobalTelemetryStats,
  ReadingSessionRow,
  TelemetrySnapshotRow,
  UserCalibrationRow,
} from './schema';

export interface SaveCalibrationInput {
  baselineEar: number;
  minGazeX: number;
  maxGazeX: number;
  minGazeY: number;
  maxGazeY: number;
}

export interface FinishSessionInput {
  sessionId: number;
  endTime: number;
  effectiveReadingSec: number;
  distractedSec: number;
  fatigueEventsCount: number;
  avgBlinkRate: number;
}

export interface InsertSnapshotInput {
  sessionId: number;
  timestampOffsetSec: number;
  cognitiveState: CognitiveState;
  avgEar: number;
  saccadeFrequency: number;
}

export async function saveCalibration(
  input: SaveCalibrationInput
): Promise<UserCalibrationRow> {
  const updatedAt = Date.now();
  return withDbTransaction(async (db) => {
    const res = await db.runAsync(
      `INSERT INTO user_calibration (
        baseline_ear, min_gaze_x, max_gaze_x, min_gaze_y, max_gaze_y, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.baselineEar,
        input.minGazeX,
        input.maxGazeX,
        input.minGazeY,
        input.maxGazeY,
        updatedAt,
      ]
    );
    return {
      id: res.lastInsertRowId,
      baseline_ear: input.baselineEar,
      min_gaze_x: input.minGazeX,
      max_gaze_x: input.maxGazeX,
      min_gaze_y: input.minGazeY,
      max_gaze_y: input.maxGazeY,
      updated_at: updatedAt,
    };
  });
}

export async function getLatestCalibration(): Promise<UserCalibrationRow | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<UserCalibrationRow>(
    `SELECT * FROM user_calibration ORDER BY updated_at DESC, id DESC LIMIT 1`
  );
  return row ?? null;
}

export async function createReadingSession(
  documentTitle: string,
  startTime: number = Date.now()
): Promise<number> {
  const db = await getDatabase();
  const res = await db.runAsync(
    `INSERT INTO reading_sessions (document_title, start_time) VALUES (?, ?)`,
    [documentTitle, startTime]
  );
  return res.lastInsertRowId;
}

export async function finishReadingSession(
  input: FinishSessionInput
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE reading_sessions
     SET end_time = ?,
         effective_reading_sec = ?,
         distracted_sec = ?,
         fatigue_events_count = ?,
         avg_blink_rate = ?
     WHERE id = ?`,
    [
      input.endTime,
      Math.round(input.effectiveReadingSec),
      Math.round(input.distractedSec),
      input.fatigueEventsCount,
      input.avgBlinkRate,
      input.sessionId,
    ]
  );
}

export async function insertTelemetrySnapshot(
  input: InsertSnapshotInput
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO telemetry_snapshots (
      session_id, timestamp_offset_sec, cognitive_state, avg_ear, saccade_frequency
    ) VALUES (?, ?, ?, ?, ?)`,
    [
      input.sessionId,
      Math.round(input.timestampOffsetSec),
      input.cognitiveState,
      input.avgEar,
      input.saccadeFrequency,
    ]
  );
}

export async function listReadingSessions(
  limit: number = 30
): Promise<ReadingSessionRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<ReadingSessionRow>(
    `SELECT * FROM reading_sessions ORDER BY start_time DESC LIMIT ?`,
    [limit]
  );
}

export async function getReadingSessionById(
  sessionId: number
): Promise<ReadingSessionRow | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ReadingSessionRow>(
    `SELECT * FROM reading_sessions WHERE id = ?`,
    [sessionId]
  );
  return row ?? null;
}

export async function getSessionSnapshots(
  sessionId: number
): Promise<TelemetrySnapshotRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<TelemetrySnapshotRow>(
    `SELECT * FROM telemetry_snapshots
     WHERE session_id = ?
     ORDER BY timestamp_offset_sec ASC`,
    [sessionId]
  );
}

export async function deleteReadingSession(sessionId: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM reading_sessions WHERE id = ?`, [sessionId]);
}

export async function getGlobalStats(): Promise<GlobalTelemetryStats> {
  const db = await getDatabase();
  const agg = await db.getFirstAsync<{
    total_sessions: number;
    total_effective: number | null;
    total_distracted: number | null;
    total_fatigue: number | null;
    avg_blink: number | null;
  }>(
    `SELECT
       COUNT(*) AS total_sessions,
       SUM(effective_reading_sec) AS total_effective,
       SUM(distracted_sec) AS total_distracted,
       SUM(fatigue_events_count) AS total_fatigue,
       AVG(CASE WHEN avg_blink_rate > 0 THEN avg_blink_rate ELSE NULL END) AS avg_blink
     FROM reading_sessions`
  );

  const onset = await db.getFirstAsync<{ avg_onset_sec: number | null }>(
    `SELECT AVG(first_fatigue_sec) AS avg_onset_sec
     FROM (
       SELECT session_id, MIN(timestamp_offset_sec) AS first_fatigue_sec
       FROM telemetry_snapshots
       WHERE cognitive_state = 'FATIGA_OCULAR'
       GROUP BY session_id
     )`
  );

  return {
    totalSessions: agg?.total_sessions ?? 0,
    totalEffectiveReadingSec: agg?.total_effective ?? 0,
    totalDistractedSec: agg?.total_distracted ?? 0,
    totalFatigueEvents: agg?.total_fatigue ?? 0,
    avgBlinkRate: agg?.avg_blink ?? 0,
    avgFatigueOnsetMin:
      onset?.avg_onset_sec !== null && onset?.avg_onset_sec !== undefined
        ? Math.round((onset.avg_onset_sec / 60) * 10) / 10
        : null,
  };
}
