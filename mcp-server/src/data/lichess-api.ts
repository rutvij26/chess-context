import { config } from "../config.js";
import { PlayerNotFoundError } from "./chesscom-api.js";
import type {
  PlayerStats,
  RatingInfo,
  OpeningEntry,
  RecentForm,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Lichess API response shapes (partial)
// ---------------------------------------------------------------------------

interface LichessPerf {
  games: number;
  rating: number;
  rd: number;
  prog: number;
  prov?: boolean;
}

interface LichessUser {
  id: string;
  username: string;
  perfs: {
    bullet?: LichessPerf;
    blitz?: LichessPerf;
    rapid?: LichessPerf;
    classical?: LichessPerf;
    correspondence?: LichessPerf;
  };
  count?: {
    all: number;
    win: number;
    loss: number;
    draw: number;
    me: number;
    ai: number;
    game: number;
    rated: number;
    import: number;
    bookmark: number;
    playing: number;
    with: number;
    bookmark2: number;
  };
}

export interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  perf: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  players: {
    white: { user?: { id: string; name: string }; rating?: number; ratingDiff?: number };
    black: { user?: { id: string; name: string }; rating?: number; ratingDiff?: number };
  };
  opening?: { eco: string; name: string; ply: number };
  moves?: string;
  winner?: "white" | "black";
  pgn?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/x-ndjson",
  };
  if (config.lichess.token) {
    headers["Authorization"] = `Bearer ${config.lichess.token}`;
  }
  return headers;
}

function parseNdjson(text: string): LichessGame[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LichessGame;
      } catch {
        return null;
      }
    })
    .filter((g): g is LichessGame => g !== null);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getProfile(username: string): Promise<LichessUser> {
  const response = await fetch(
    `${config.lichess.baseUrl}/api/user/${encodeURIComponent(username)}`,
    {
      headers: {
        Accept: "application/json",
        ...(config.lichess.token
          ? { Authorization: `Bearer ${config.lichess.token}` }
          : {}),
      },
    }
  );

  if (response.status === 404) {
    throw new PlayerNotFoundError(username, "lichess");
  }

  if (!response.ok) {
    throw new Error(`Lichess API error: ${response.status}`);
  }

  return (await response.json()) as LichessUser;
}

export async function getRecentGames(
  username: string,
  count = 50
): Promise<LichessGame[]> {
  const url = new URL(
    `${config.lichess.baseUrl}/api/games/user/${encodeURIComponent(username)}`
  );
  url.searchParams.set("max", String(count));
  url.searchParams.set("opening", "true");
  url.searchParams.set("moves", "true");
  url.searchParams.set("rated", "true");

  const response = await fetch(url.toString(), { headers: buildHeaders() });

  if (response.status === 404) {
    throw new PlayerNotFoundError(username, "lichess");
  }

  if (!response.ok) {
    throw new Error(`Lichess API error: ${response.status}`);
  }

  const text = await response.text();
  return parseNdjson(text);
}

// ---------------------------------------------------------------------------
// Stats aggregation
// ---------------------------------------------------------------------------

function toRatingInfo(
  perf?: LichessPerf,
  username?: string
): RatingInfo | undefined {
  if (!perf || perf.games === 0) return undefined;
  return {
    current: perf.rating,
    peak: perf.rating, // Lichess basic API doesn't expose peak easily
    games: perf.games,
  };
}

function extractOpenings(
  games: LichessGame[],
  username: string,
  color: "white" | "black",
  filterFirstMove?: string
): OpeningEntry[] {
  const lower = username.toLowerCase();
  const counts: Map<string, { wins: number; total: number }> = new Map();

  for (const g of games) {
    const isWhite = g.players.white.user?.id?.toLowerCase() === lower ||
      g.players.white.user?.name?.toLowerCase() === lower;
    const isBlack = g.players.black.user?.id?.toLowerCase() === lower ||
      g.players.black.user?.name?.toLowerCase() === lower;

    if (color === "white" && !isWhite) continue;
    if (color === "black" && !isBlack) continue;

    const moves = (g.moves ?? "").trim().split(/\s+/);
    const whiteFirst = moves[0] ?? "";
    const blackFirst = moves[1] ?? "";

    if (filterFirstMove && whiteFirst !== filterFirstMove) continue;

    // Use ECO name if available, else raw move
    const key =
      g.opening?.name ??
      (color === "white"
        ? whiteFirst
        : filterFirstMove
        ? `${filterFirstMove} ${blackFirst}`
        : blackFirst);

    if (!key) continue;

    const entry = counts.get(key) ?? { wins: 0, total: 0 };
    entry.total++;

    const isWin =
      (color === "white" && g.winner === "white") ||
      (color === "black" && g.winner === "black");
    if (isWin) entry.wins++;

    counts.set(key, entry);
  }

  const total = games.filter((g) => {
    const isWhite = g.players.white.user?.id?.toLowerCase() === lower ||
      g.players.white.user?.name?.toLowerCase() === lower;
    return color === "white" ? isWhite : !isWhite;
  }).length || 1;

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
  games: LichessGame[],
  username: string,
  count: number
): RecentForm {
  const lower = username.toLowerCase();
  const recent = games.slice(0, count);

  let wins = 0, draws = 0, losses = 0;

  for (const g of recent) {
    const isWhite =
      g.players.white.user?.id?.toLowerCase() === lower ||
      g.players.white.user?.name?.toLowerCase() === lower;

    if (!g.winner) {
      draws++;
    } else if (
      (g.winner === "white" && isWhite) ||
      (g.winner === "black" && !isWhite)
    ) {
      wins++;
    } else {
      losses++;
    }
  }

  const half = Math.floor(recent.length / 2);
  const countWins = (arr: LichessGame[]) =>
    arr.filter((g) => {
      const isWhite =
        g.players.white.user?.id?.toLowerCase() === lower ||
        g.players.white.user?.name?.toLowerCase() === lower;
      return (
        (g.winner === "white" && isWhite) ||
        (g.winner === "black" && !isWhite)
      );
    }).length;

  const wr1 = countWins(recent.slice(0, half)) / (half || 1);
  const wr2 = countWins(recent.slice(half)) / (half || 1);
  const diff = wr1 - wr2;
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
  games: LichessGame[],
  username: string
): { overall: number; as_white: number; as_black: number } {
  const lower = username.toLowerCase();
  let totalWins = 0, totalGames = 0;
  let whiteWins = 0, whiteGames = 0;
  let blackWins = 0, blackGames = 0;

  for (const g of games) {
    const isWhite =
      g.players.white.user?.id?.toLowerCase() === lower ||
      g.players.white.user?.name?.toLowerCase() === lower;
    const isWin =
      (g.winner === "white" && isWhite) ||
      (g.winner === "black" && !isWhite);

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
  const [profile, games] = await Promise.all([
    getProfile(username),
    getRecentGames(username, config.analysis.recentGamesCount),
  ]);

  return {
    username: profile.username,
    platform: "lichess",
    ratings: (() => {
      const bullet = toRatingInfo(profile.perfs.bullet);
      const blitz = toRatingInfo(profile.perfs.blitz);
      const rapid = toRatingInfo(profile.perfs.rapid);
      const classical = toRatingInfo(profile.perfs.classical);
      return {
        ...(bullet !== undefined ? { bullet } : {}),
        ...(blitz !== undefined ? { blitz } : {}),
        ...(rapid !== undefined ? { rapid } : {}),
        ...(classical !== undefined ? { classical } : {}),
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
