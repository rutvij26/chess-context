import { sql } from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerGameRow {
  id: number;
  platform: string;
  username: string;
  game_id: string;
  pgn: string;
  time_control: string | null;
  played_at: Date | null;
  result: string | null;
  opening_name: string | null;
  opening_eco: string | null;
  player_color: string | null;
  opponent: string | null;
  player_rating: number | null;
  opponent_rating: number | null;
}

export interface InsertableGame {
  platform: string;
  username: string;
  game_id: string;
  pgn: string;
  time_control?: string | null;
  played_at?: Date | null;
  result?: string | null;
  opening_name?: string | null;
  opening_eco?: string | null;
  player_color?: string | null;
  opponent?: string | null;
  player_rating?: number | null;
  opponent_rating?: number | null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Upsert a batch of games. Returns the count of newly inserted rows.
 */
export async function insertGames(games: InsertableGame[]): Promise<number> {
  if (games.length === 0) return 0;

  const db = sql();

  const rows = games.map((g) => ({
    platform: g.platform,
    username: g.username.toLowerCase(),
    game_id: g.game_id,
    pgn: g.pgn,
    time_control: g.time_control ?? null,
    played_at: g.played_at ?? null,
    result: g.result ?? null,
    opening_name: g.opening_name ?? null,
    opening_eco: g.opening_eco ?? null,
    player_color: g.player_color ?? null,
    opponent: g.opponent ?? null,
    player_rating: g.player_rating ?? null,
    opponent_rating: g.opponent_rating ?? null,
  }));

  const result = await db`
    INSERT INTO player_games ${db(rows)}
    ON CONFLICT (platform, username, game_id) DO NOTHING
    RETURNING id
  `;

  return result.length;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getGamesForUser(
  platform: string,
  username: string,
  limit = 50
): Promise<PlayerGameRow[]> {
  const db = sql();
  return db<PlayerGameRow[]>`
    SELECT *
    FROM player_games
    WHERE platform = ${platform}
      AND username = ${username.toLowerCase()}
    ORDER BY played_at DESC NULLS LAST
    LIMIT ${limit}
  `;
}

export async function getGameIdsForUser(
  platform: string,
  username: string
): Promise<string[]> {
  const db = sql();
  const rows = await db<{ game_id: string }[]>`
    SELECT game_id
    FROM player_games
    WHERE platform = ${platform}
      AND username = ${username.toLowerCase()}
  `;
  return rows.map((r) => r.game_id);
}

/** Return IDs of player_games rows that have no analysis yet. */
export async function getUnanalyzedGameIds(
  platform: string,
  username: string
): Promise<number[]> {
  const db = sql();
  const rows = await db<{ id: number }[]>`
    SELECT pg.id
    FROM player_games pg
    LEFT JOIN game_analyses ga ON ga.player_game_id = pg.id
    WHERE pg.platform = ${platform}
      AND pg.username = ${username.toLowerCase()}
      AND ga.id IS NULL
    ORDER BY pg.played_at DESC NULLS LAST
  `;
  return rows.map((r) => r.id);
}
