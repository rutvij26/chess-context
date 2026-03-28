import { config } from "../config.js";
import type {
  PlayerStats,
  RatingInfo,
  OpeningEntry,
  RecentForm,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class PlayerNotFoundError extends Error {
  constructor(username: string, platform: string) {
    super(`Player "${username}" not found on ${platform}`);
    this.name = "PlayerNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Chess.com API response shapes (partial)
// ---------------------------------------------------------------------------

interface ChessComRating {
  last?: { rating: number; date: number };
  best?: { rating: number; game: string };
  record?: { win: number; loss: number; draw: number };
}

interface ChessComStats {
  chess_bullet?: ChessComRating;
  chess_blitz?: ChessComRating;
  chess_rapid?: ChessComRating;
  chess_daily?: ChessComRating;
}

interface ChessComProfile {
  username: string;
  player_id: number;
  title?: string;
}

interface ChessComArchivesResponse {
  archives: string[];
}

interface ChessComGamesResponse {
  games: ChessComGame[];
}

export interface ChessComGame {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  white: { username: string; result: string; rating: number };
  black: { username: string; result: string; rating: number };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, retries = 3): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (response.status === 404) {
      throw new Error("NOT_FOUND");
    }

    if (response.status === 429) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw new Error("Rate limited by Chess.com API");
    }

    if (!response.ok) {
      throw new Error(`Chess.com API error: ${response.status}`);
    }

    return (await response.json()) as T;
  }
  throw new Error("All retries exhausted");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getProfile(username: string): Promise<ChessComProfile> {
  try {
    return await fetchJson<ChessComProfile>(
      `${config.chesscom.baseUrl}/player/${encodeURIComponent(username)}`
    );
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      throw new PlayerNotFoundError(username, "chess.com");
    }
    throw err;
  }
}

export async function getStats(username: string): Promise<ChessComStats> {
  try {
    return await fetchJson<ChessComStats>(
      `${config.chesscom.baseUrl}/player/${encodeURIComponent(username)}/stats`
    );
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      throw new PlayerNotFoundError(username, "chess.com");
    }
    throw err;
  }
}

/**
 * Fetch the most recent N games for a player.
 * Fetches from the latest monthly archive, then the previous one if needed.
 */
export async function getRecentGames(
  username: string,
  count = 50
): Promise<ChessComGame[]> {
  const archives = await fetchJson<ChessComArchivesResponse>(
    `${config.chesscom.baseUrl}/player/${encodeURIComponent(username)}/games/archives`
  );

  const allGames: ChessComGame[] = [];
  const urls = [...archives.archives].reverse(); // Most recent first

  for (const url of urls) {
    if (allGames.length >= count) break;
    const monthly = await fetchJson<ChessComGamesResponse>(url);
    allGames.push(...monthly.games.reverse()); // Most recent first
    // Small delay to be a good API citizen
    await new Promise((r) => setTimeout(r, 200));
  }

  return allGames.slice(0, count);
}

// ---------------------------------------------------------------------------
// Stats aggregation
// ---------------------------------------------------------------------------

function toRatingInfo(r?: ChessComRating): RatingInfo | undefined {
  if (!r?.last) return undefined;
  return {
    current: r.last.rating,
    peak: r.best?.rating ?? r.last.rating,
    games: (r.record?.win ?? 0) + (r.record?.loss ?? 0) + (r.record?.draw ?? 0),
  };
}

function extractOpenings(
  games: ChessComGame[],
  username: string,
  color: "white" | "black",
  filterFirstMove?: string
): OpeningEntry[] {
  const lower = username.toLowerCase();
  const relevant = games.filter((g) =>
    color === "white"
      ? g.white.username.toLowerCase() === lower
      : g.black.username.toLowerCase() === lower
  );

  const counts: Map<string, { wins: number; total: number }> = new Map();

  for (const game of relevant) {
    const pgn = game.pgn;
    const firstMoveLine = pgn.match(/\n1\. (.+)/)?.[1] ?? "";
    const tokens = firstMoveLine.split(/\s+/).filter((t) => !t.startsWith("{"));

    // White moves are tokens at even indices (0, 2, ...) after filtering numbers
    const moveParts = firstMoveLine
      .replace(/\d+\.\s*/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    // First move of the game
    const whiteFirst = moveParts[0] ?? "";
    const blackFirst = moveParts[1] ?? "";

    const key =
      color === "white"
        ? whiteFirst
        : filterFirstMove
        ? `${filterFirstMove} ${blackFirst}`
        : blackFirst;

    if (!key) continue;
    if (filterFirstMove && color === "black" && whiteFirst !== filterFirstMove)
      continue;

    const entry = counts.get(key) ?? { wins: 0, total: 0 };
    entry.total++;

    const isWin =
      (color === "white" && game.white.result === "win") ||
      (color === "black" && game.black.result === "win");
    if (isWin) entry.wins++;

    counts.set(key, entry);
  }

  const total = relevant.length || 1;
  return Array.from(counts.entries())
    .map(([opening, { wins, total: n }]) => ({
      opening,
      frequency: Math.round((n / total) * 100),
      win_rate: Math.round((wins / n) * 100),
      sample_size: n,
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);
}

function computeRecentForm(
  games: ChessComGame[],
  username: string,
  count: number
): RecentForm {
  const lower = username.toLowerCase();
  const recent = games.slice(0, count);

  let wins = 0,
    draws = 0,
    losses = 0;

  for (const g of recent) {
    const isWhite = g.white.username.toLowerCase() === lower;
    const result = isWhite ? g.white.result : g.black.result;
    if (result === "win") wins++;
    else if (result === "agreed" || result === "stalemate" || result === "repetition" || result === "insufficient" || result === "50move" || result === "timevsinsufficient") draws++;
    else losses++;
  }

  // Simple trend: compare first half vs second half win rate
  const half = Math.floor(recent.length / 2);
  const firstHalf = recent.slice(0, half);
  const secondHalf = recent.slice(half);
  const winRate1 = firstHalf.filter((g) => {
    const isWhite = g.white.username.toLowerCase() === lower;
    return (isWhite ? g.white.result : g.black.result) === "win";
  }).length / (half || 1);
  const winRate2 = secondHalf.filter((g) => {
    const isWhite = g.white.username.toLowerCase() === lower;
    return (isWhite ? g.white.result : g.black.result) === "win";
  }).length / (half || 1);

  const diff = winRate1 - winRate2;
  const trend: RecentForm["rating_trend"] =
    diff > 0.1 ? "rising" : diff < -0.1 ? "falling" : "stable";

  return {
    last_n_games: recent.length,
    wins,
    draws,
    losses,
    rating_trend: trend,
  };
}

function computeWinRates(
  games: ChessComGame[],
  username: string
): { overall: number; as_white: number; as_black: number } {
  const lower = username.toLowerCase();
  let totalWins = 0, totalGames = 0;
  let whiteWins = 0, whiteGames = 0;
  let blackWins = 0, blackGames = 0;

  for (const g of games) {
    const isWhite = g.white.username.toLowerCase() === lower;
    const result = isWhite ? g.white.result : g.black.result;
    const isWin = result === "win";

    totalGames++;
    if (isWin) totalWins++;

    if (isWhite) {
      whiteGames++;
      if (isWin) whiteWins++;
    } else {
      blackGames++;
      if (isWin) blackWins++;
    }
  }

  return {
    overall: Math.round((totalWins / (totalGames || 1)) * 100),
    as_white: Math.round((whiteWins / (whiteGames || 1)) * 100),
    as_black: Math.round((blackWins / (blackGames || 1)) * 100),
  };
}

export async function buildPlayerStats(username: string): Promise<PlayerStats> {
  const [stats, games] = await Promise.all([
    getStats(username),
    getRecentGames(username, config.analysis.recentGamesCount),
  ]);

  return {
    username,
    platform: "chess.com",
    ratings: (() => {
      const bullet = toRatingInfo(stats.chess_bullet);
      const blitz = toRatingInfo(stats.chess_blitz);
      const rapid = toRatingInfo(stats.chess_rapid);
      return {
        ...(bullet !== undefined ? { bullet } : {}),
        ...(blitz !== undefined ? { blitz } : {}),
        ...(rapid !== undefined ? { rapid } : {}),
      };
    })(),
    win_rate: computeWinRates(games, username),
    opening_repertoire: {
      as_white: extractOpenings(games, username, "white"),
      as_black_vs_e4: extractOpenings(games, username, "black", "e4"),
      as_black_vs_d4: extractOpenings(games, username, "black", "d4"),
    },
    recent_form: computeRecentForm(
      games,
      username,
      config.analysis.recentFormCount
    ),
  };
}
