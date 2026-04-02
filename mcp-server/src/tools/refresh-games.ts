import { Chess } from "chess.js";
import { getRecentGames as getChessComGames } from "../data/chesscom-api.js";
import { getRecentGames as getLichessGames } from "../data/lichess-api.js";
import { insertGames, getGameIdsForUser, type InsertableGame } from "../store/game-store.js";
import { enqueueUnanalyzedGames, startPipeline } from "../store/analysis-pipeline.js";
import { isDbConfigured } from "../store/db.js";
import type { RefreshGamesInput, RefreshGamesOutput } from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPgnHeader(pgn: string, tag: string): string | null {
  const match = pgn.match(new RegExp(`\\[${tag} "([^"]+)"\\]`));
  return match?.[1] ?? null;
}

function parseResult(result: string | null, playerColor: "white" | "black"): "win" | "loss" | "draw" {
  if (!result) return "draw";
  if (result === "1/2-1/2") return "draw";
  if (result === "1-0") return playerColor === "white" ? "win" : "loss";
  if (result === "0-1") return playerColor === "black" ? "win" : "loss";
  return "draw";
}

// ---------------------------------------------------------------------------
// Chess.com game mapping
// ---------------------------------------------------------------------------

function mapChessComGames(
  username: string,
  games: Awaited<ReturnType<typeof getChessComGames>>
) {
  return games
    .filter((g) => g.pgn)
    .map((g) => {
      const usernameLC = username.toLowerCase();
      const isWhite = g.white.username.toLowerCase() === usernameLC;
      const playerColor = isWhite ? "white" : "black";
      const player = isWhite ? g.white : g.black;
      const opponent = isWhite ? g.black : g.white;

      // Extract game ID from URL: https://www.chess.com/game/live/123456789
      const gameIdMatch = g.url.match(/\/game\/(?:live|daily)\/(\d+)/);
      const gameId = gameIdMatch?.[1] ?? g.url;

      const openingName = extractPgnHeader(g.pgn, "Opening");
      const result = parseResult(extractPgnHeader(g.pgn, "Result"), playerColor);

      return {
        platform: "chess.com",
        username: usernameLC,
        game_id: gameId,
        pgn: g.pgn,
        time_control: g.time_control ?? null,
        played_at: g.end_time ? new Date(g.end_time * 1000) : null,
        result,
        opening_name: openingName,
        opening_eco: null,
        player_color: playerColor,
        opponent: opponent.username,
        player_rating: player.rating,
        opponent_rating: opponent.rating,
      };
    });
}

// ---------------------------------------------------------------------------
// Lichess game mapping
// ---------------------------------------------------------------------------

function mapLichessGames(
  username: string,
  games: Awaited<ReturnType<typeof getLichessGames>>
) {
  return games
    .filter((g) => g.pgn)
    .map((g) => {
      const usernameLC = username.toLowerCase();
      const whiteId = g.players.white.user?.id?.toLowerCase() ?? "";
      const isWhite = whiteId === usernameLC || g.players.white.user?.name?.toLowerCase() === usernameLC;
      const playerColor = isWhite ? "white" : "black";
      const playerSide = isWhite ? g.players.white : g.players.black;
      const opponentSide = isWhite ? g.players.black : g.players.white;
      const opponentName = opponentSide.user?.name ?? opponentSide.user?.id ?? "Unknown";

      let result: "win" | "loss" | "draw" = "draw";
      if (g.winner === "white") result = isWhite ? "win" : "loss";
      else if (g.winner === "black") result = !isWhite ? "win" : "loss";

      return {
        platform: "lichess",
        username: usernameLC,
        game_id: g.id,
        pgn: g.pgn ?? "",
        time_control: g.speed ?? null,
        played_at: g.lastMoveAt ? new Date(g.lastMoveAt) : null,
        result,
        opening_name: g.opening?.name ?? null,
        opening_eco: g.opening?.eco ?? null,
        player_color: playerColor,
        opponent: opponentName,
        player_rating: playerSide.rating ?? null,
        opponent_rating: opponentSide.rating ?? null,
      };
    });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleRefreshGames(
  input: RefreshGamesInput
): Promise<RefreshGamesOutput> {
  if (!isDbConfigured()) {
    return {
      username: input.username,
      platform: input.platform,
      fetched: 0,
      new_games: 0,
      queued_for_analysis: 0,
      already_analyzed: 0,
      status: "error",
      message:
        "DATABASE_URL is not configured. " +
        "Set DATABASE_URL=postgresql://chess:chess@localhost:5432/chess_context " +
        "and start Postgres with: docker compose up -d postgres",
    };
  }

  const count = input.count ?? 20;
  const usernameLC = input.username.toLowerCase();

  // Fetch games from platform API
  let mappedGames: InsertableGame[];
  if (input.platform === "chess.com") {
    const raw = await getChessComGames(input.username, count);
    mappedGames = mapChessComGames(input.username, raw);
  } else {
    const raw = await getLichessGames(input.username, count);
    mappedGames = mapLichessGames(input.username, raw);
  }

  const fetched = mappedGames.length;

  // Insert only new games (upsert, skip existing)
  const newGames = await insertGames(mappedGames);

  // Queue unanalyzed games for background processing
  const queued = await enqueueUnanalyzedGames(input.platform, usernameLC);
  const alreadyAnalyzed = fetched - queued - (fetched - newGames < 0 ? 0 : fetched - newGames);

  // Kick off background pipeline (non-blocking)
  if (queued > 0) {
    startPipeline();
  }

  const status = queued > 0 ? "processing" : "up_to_date";
  const message =
    queued > 0
      ? `Fetched ${fetched} games (${newGames} new). Analyzing ${queued} games in the background — call get_mistake_patterns or get_style_fingerprint in a minute.`
      : `Fetched ${fetched} games. All games are already analyzed and ready.`;

  return {
    username: input.username,
    platform: input.platform,
    fetched,
    new_games: newGames,
    queued_for_analysis: queued,
    already_analyzed: Math.max(0, fetched - newGames),
    status,
    message,
  };
}
