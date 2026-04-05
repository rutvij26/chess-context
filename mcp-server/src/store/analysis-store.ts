import { sql } from "./db.js";
import type { MoveRecord } from "../intelligence/critical-moments.js";
import type { CriticalMoment } from "../types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameAnalysisRow {
  id: number;
  player_game_id: number;
  schema_version: string;
  move_records: MoveRecord[];
  white_accuracy: number | null;
  black_accuracy: number | null;
  critical_moments: CriticalMoment[] | null;
  phase_breakdown: Record<string, unknown> | null;
  patterns_detected: string[] | null;
  analyzed_at: Date;
}

export interface InsertableAnalysis {
  player_game_id: number;
  move_records: MoveRecord[];
  white_accuracy: number | null;
  black_accuracy: number | null;
  critical_moments: CriticalMoment[] | null;
  phase_breakdown: Record<string, unknown> | null;
  patterns_detected: string[] | null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function insertAnalysis(data: InsertableAnalysis): Promise<void> {
  const db = sql();
  // Use db.json() to pass JSONB values — do NOT pre-stringify with JSON.stringify().
  // JSON.stringify() produces a JS string, which postgres.js then serializes as a
  // JSON string value ("…"), storing the wrong JSONB type (string instead of array).
  // The `as any` casts are needed because our interfaces lack JSON index signatures
  // but are structurally JSON-serializable at runtime.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await db`
    INSERT INTO game_analyses
      (player_game_id, schema_version, move_records, white_accuracy, black_accuracy,
       critical_moments, phase_breakdown, patterns_detected)
    VALUES (
      ${data.player_game_id},
      '0.6',
      ${db.json(data.move_records as any)},
      ${data.white_accuracy},
      ${data.black_accuracy},
      ${db.json((data.critical_moments ?? null) as any)},
      ${db.json((data.phase_breakdown ?? null) as any)},
      ${data.patterns_detected ?? null}
    )
    ON CONFLICT (player_game_id) DO UPDATE SET
      schema_version   = EXCLUDED.schema_version,
      move_records     = EXCLUDED.move_records,
      white_accuracy   = EXCLUDED.white_accuracy,
      black_accuracy   = EXCLUDED.black_accuracy,
      critical_moments = EXCLUDED.critical_moments,
      phase_breakdown  = EXCLUDED.phase_breakdown,
      patterns_detected = EXCLUDED.patterns_detected,
      analyzed_at      = NOW()
  `;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getAnalysesForUser(
  platform: string,
  username: string,
  limit = 50
): Promise<GameAnalysisRow[]> {
  const db = sql();
  const rows = await db<(Omit<GameAnalysisRow, "white_accuracy" | "black_accuracy"> & { white_accuracy: string | null; black_accuracy: string | null })[]>`
    SELECT ga.*
    FROM game_analyses ga
    JOIN player_games pg ON pg.id = ga.player_game_id
    WHERE pg.platform = ${platform}
      AND pg.username = ${username.toLowerCase()}
    ORDER BY pg.played_at DESC NULLS LAST
    LIMIT ${limit}
  `;
  // postgres.js v3 returns NUMERIC(5,2) columns as strings — coerce to number here
  // so the declared GameAnalysisRow type (number | null) matches runtime values.
  return rows.map((r) => ({
    ...r,
    white_accuracy: r.white_accuracy == null ? null : Number(r.white_accuracy),
    black_accuracy: r.black_accuracy == null ? null : Number(r.black_accuracy),
  }));
}

export async function getAnalysisForGame(
  playerGameId: number
): Promise<GameAnalysisRow | null> {
  const db = sql();
  const rows = await db<GameAnalysisRow[]>`
    SELECT * FROM game_analyses
    WHERE player_game_id = ${playerGameId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export interface QueueStatusRow {
  status: string;
  count: number;
}

export async function getQueueStatusForUser(
  platform: string,
  username: string
): Promise<QueueStatusRow[]> {
  const db = sql();
  const rows = await db<{ status: string; count: string }[]>`
    SELECT aq.status, COUNT(*) as count
    FROM analysis_queue aq
    JOIN player_games pg ON pg.id = aq.player_game_id
    WHERE pg.platform = ${platform}
      AND pg.username = ${username.toLowerCase()}
    GROUP BY aq.status
  `;
  return rows.map((r) => ({ status: r.status, count: parseInt(r.count, 10) }));
}

export async function countAnalysesForUser(
  platform: string,
  username: string
): Promise<number> {
  const db = sql();
  const rows = await db<{ count: string }[]>`
    SELECT COUNT(*) as count
    FROM game_analyses ga
    JOIN player_games pg ON pg.id = ga.player_game_id
    WHERE pg.platform = ${platform}
      AND pg.username = ${username.toLowerCase()}
  `;
  return parseInt(rows[0]?.count ?? "0", 10);
}
