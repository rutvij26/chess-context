/**
 * Background game analysis pipeline.
 *
 * When refresh_games queues new games, this module processes them one at a time
 * using setImmediate to yield between games so the MCP server stays responsive.
 *
 * Eval computation happens in Docker Stockfish over HTTP (async), so Node.js
 * is not blocked during the heavy lifting — only DB reads/writes touch this thread.
 */

import { sql } from "./db.js";
import { insertAnalysis } from "./analysis-store.js";
import { analyzeGameFull } from "../tools/analyze-game.js";

// ---------------------------------------------------------------------------
// Queue state (in-memory, single-process)
// ---------------------------------------------------------------------------

let _isProcessing = false;

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * Insert pending rows into analysis_queue for each player_game_id that has no
 * existing analysis. Returns the count of newly queued games.
 */
export async function enqueueUnanalyzedGames(
  platform: string,
  username: string
): Promise<number> {
  const db = sql();
  const result = await db`
    INSERT INTO analysis_queue (player_game_id)
    SELECT pg.id
    FROM player_games pg
    LEFT JOIN game_analyses ga ON ga.player_game_id = pg.id
    LEFT JOIN analysis_queue aq ON aq.player_game_id = pg.id
    WHERE pg.platform = ${platform}
      AND pg.username = ${username.toLowerCase()}
      AND ga.id IS NULL
      AND aq.id IS NULL
    ON CONFLICT (player_game_id) DO NOTHING
    RETURNING id
  `;
  return result.length;
}

// ---------------------------------------------------------------------------
// Re-queue low-coverage analyses
// ---------------------------------------------------------------------------

/**
 * Re-queue completed analyses where both accuracy scores are 0 or null —
 * a sign that the engine was not ready when the analysis ran.
 * Uses ON CONFLICT DO UPDATE so it is idempotent and safe to call every refresh.
 * Returns the count of games re-queued.
 */
export async function requeueLowCoverageAnalyses(
  platform: string,
  username: string
): Promise<number> {
  const db = sql();
  const result = await db`
    INSERT INTO analysis_queue (player_game_id, status)
    SELECT pg.id, 'pending'
    FROM player_games pg
    JOIN game_analyses ga ON ga.player_game_id = pg.id
    WHERE pg.platform = ${platform}
      AND pg.username = ${username.toLowerCase()}
      AND (ga.white_accuracy IS NULL OR ga.white_accuracy = 0)
      AND (ga.black_accuracy IS NULL OR ga.black_accuracy = 0)
    ON CONFLICT (player_game_id)
    DO UPDATE SET status = 'pending', started_at = NULL, completed_at = NULL, error = NULL
    RETURNING analysis_queue.player_game_id
  `;
  return result.length;
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

export async function getQueueStatus(
  platform: string,
  username: string
): Promise<{ pending: number; processing: number; done: number; failed: number }> {
  const db = sql();
  const rows = await db<{ status: string; count: string }[]>`
    SELECT aq.status, COUNT(*) as count
    FROM analysis_queue aq
    JOIN player_games pg ON pg.id = aq.player_game_id
    WHERE pg.platform = ${platform}
      AND pg.username = ${username.toLowerCase()}
    GROUP BY aq.status
  `;

  const counts = { pending: 0, processing: 0, done: 0, failed: 0 };
  for (const row of rows) {
    const s = row.status as keyof typeof counts;
    if (s in counts) counts[s] = parseInt(row.count, 10);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Background processor
// ---------------------------------------------------------------------------

/** Kick off background processing if not already running. */
export function startPipeline(): void {
  if (_isProcessing) return;
  setImmediate(() => void processNextQueued());
}

async function processNextQueued(): Promise<void> {
  const db = sql();

  // Claim the oldest pending item atomically.
  const rows = await db<{ id: number; player_game_id: number; pgn: string }[]>`
    UPDATE analysis_queue aq
    SET status = 'processing', started_at = NOW()
    FROM player_games pg
    WHERE aq.player_game_id = pg.id
      AND aq.status = 'pending'
      AND aq.id = (
        SELECT id FROM analysis_queue WHERE status = 'pending' ORDER BY queued_at LIMIT 1
      )
    RETURNING aq.id, aq.player_game_id, pg.pgn
  `;

  if (rows.length === 0) {
    // Queue empty — stop processing.
    _isProcessing = false;
    return;
  }

  _isProcessing = true;
  const { id: queueId, player_game_id, pgn } = rows[0]!;

  try {
    const { analysis, moveRecords } = await analyzeGameFull(pgn);

    await insertAnalysis({
      player_game_id,
      move_records: moveRecords,
      white_accuracy: analysis.summary.white_accuracy,
      black_accuracy: analysis.summary.black_accuracy,
      critical_moments: analysis.critical_moments,
      phase_breakdown: analysis.summary.phase_breakdown as unknown as Record<string, unknown>,
      patterns_detected: analysis.patterns_detected,
    });

    await db`
      UPDATE analysis_queue
      SET status = 'done', completed_at = NOW()
      WHERE id = ${queueId}
    `;

    console.error(`[Pipeline] Analyzed game ${String(player_game_id)} ✓`);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[Pipeline] Failed game ${String(player_game_id)}: ${error}`);

    await db`
      UPDATE analysis_queue
      SET status = 'failed', completed_at = NOW(), error = ${error}
      WHERE id = ${queueId}
    `;
  }

  // Yield to event loop before processing the next game.
  setImmediate(() => void processNextQueued());
}
