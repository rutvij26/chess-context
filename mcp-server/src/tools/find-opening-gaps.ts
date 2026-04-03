import { getRecentGames as getChessComGames } from "../data/chesscom-api.js";
import { getRecentGames as getLichessGames } from "../data/lichess-api.js";
import { detectOpeningGaps, type GameRecord } from "../intelligence/opening-gap-detector.js";
import type { FindOpeningGapsInput, FindOpeningGapsOutput } from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chessComResultToOutcome(
  result: string,
  playerColor: "white" | "black"
): "win" | "loss" | "draw" {
  if (result === "1/2-1/2") return "draw";
  if (result === "1-0") return playerColor === "white" ? "win" : "loss";
  if (result === "0-1") return playerColor === "black" ? "win" : "loss";
  return "draw";
}

function extractPgnHeader(pgn: string, tag: string): string | null {
  const match = pgn.match(new RegExp(`\\[${tag} "([^"]+)"\\]`));
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleFindOpeningGaps(
  input: FindOpeningGapsInput
): Promise<FindOpeningGapsOutput> {
  const numGames = input.num_games ?? 50;
  const minOccurrences = input.min_occurrences ?? 3;
  const color = input.color;

  let gameRecords: GameRecord[];

  try {
    if (input.platform === "chess.com") {
      const games = await getChessComGames(input.username, numGames);
      const usernameLC = input.username.toLowerCase();

      gameRecords = games
        .filter((g) => g.pgn)
        .map((g) => {
          const isWhite = g.white.username.toLowerCase() === usernameLC;
          const playerColor = isWhite ? "white" : "black";

          if (playerColor !== color) return null;

          const resultHeader = extractPgnHeader(g.pgn, "Result");
          const outcome = chessComResultToOutcome(resultHeader ?? "", playerColor);
          return { pgn: g.pgn, result: outcome } satisfies GameRecord;
        })
        .filter((g): g is GameRecord => g !== null);
    } else {
      const games = await getLichessGames(input.username, numGames);
      const usernameLC = input.username.toLowerCase();

      gameRecords = games
        .filter((g) => g.moves)
        .map((g) => {
          const isWhite =
            g.players.white.user?.id?.toLowerCase() === usernameLC ||
            g.players.white.user?.name?.toLowerCase() === usernameLC;
          const playerColor = isWhite ? "white" : "black";

          if (playerColor !== color) return null;

          const outcome: "win" | "loss" | "draw" = !g.winner
            ? "draw"
            : (g.winner === "white" && isWhite) || (g.winner === "black" && !isWhite)
            ? "win"
            : "loss";

          // Build a minimal PGN from Lichess moves string for chess.js
          const pgn = buildMinimalPgn(g.moves ?? "");
          return { pgn, result: outcome } satisfies GameRecord;
        })
        .filter((g): g is GameRecord => g !== null);
    }
  } catch (err) {
    return {
      username: input.username,
      platform: input.platform,
      color,
      games_analyzed: 0,
      gaps: [],
      summary: `Failed to fetch games: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (gameRecords.length === 0) {
    return {
      username: input.username,
      platform: input.platform,
      color,
      games_analyzed: 0,
      gaps: [],
      summary: `No ${color} games found for ${input.username} on ${input.platform}.`,
    };
  }

  const gaps = detectOpeningGaps(gameRecords, color, minOccurrences);

  const summary = buildSummary(input.username, color, gameRecords.length, gaps.length);

  return {
    username: input.username,
    platform: input.platform,
    color,
    games_analyzed: gameRecords.length,
    gaps,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Lichess moves string (space-separated SAN) into a minimal PGN
 * that chess.js can load.
 */
function buildMinimalPgn(movesStr: string): string {
  const moves = movesStr.trim().split(/\s+/).filter(Boolean);
  let pgn = "";
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) {
      pgn += `${Math.floor(i / 2) + 1}. `;
    }
    pgn += `${moves[i]!} `;
  }
  return pgn.trim();
}

function buildSummary(
  username: string,
  color: string,
  gamesAnalyzed: number,
  gapCount: number
): string {
  if (gapCount === 0) {
    return `Analyzed ${gamesAnalyzed} games as ${color} for ${username}. No significant opening gaps detected — your results after opponent deviations are solid.`;
  }
  return `Analyzed ${gamesAnalyzed} games as ${color} for ${username}. Found ${gapCount} opening gap${gapCount !== 1 ? "s" : ""} — positions where opponents deviate and you tend to score poorly. Study the top gap first.`;
}
