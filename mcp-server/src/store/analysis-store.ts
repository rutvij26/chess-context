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
  await db`
    INSERT INTO game_analyses
      (player_game_id, schema_version, move_records, white_accuracy, black_accuracy,
       critical_moments, phase_breakdown, patterns_detected)
    VALUES (
      ${data.player_game_id},
      '0.6',
      ${JSON.stringify(data.move_records)}::jsonb,
      ${data.white_accuracy},
      ${data.black_accuracy},
      ${data.critical_moments ? JSON.stringify(data.critical_moments) : null}::jsonb,
      ${data.phase_breakdown ? JSON.stringify(data.phase_breakdown) : null}::jsonb,
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
  return db<GameAnalysisRow[]>`
    SELECT ga.*
    FROM game_analyses ga
    JOIN player_games pg ON pg.id = ga.player_game_id
    WHERE pg.platform = ${platform}
      AND pg.username = ${username.toLowerCase()}
    ORDER BY pg.played_at DESC NULLS LAST
    LIMIT ${limit}
  `;
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
