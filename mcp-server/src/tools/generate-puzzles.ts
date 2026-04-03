import { isDbConfigured } from "../store/db.js";
import { getAnalysesForUser } from "../store/analysis-store.js";
import { getGamesForUser } from "../store/game-store.js";
import { extractPuzzles, type GameMeta } from "../intelligence/puzzle-classifier.js";
import { waitUntilRouterReady } from "../engines/engine-router.js";
import type { GeneratePuzzlesInput, GeneratePuzzlesOutput } from "../types/index.js";

export async function handleGeneratePuzzles(
  input: GeneratePuzzlesInput
): Promise<GeneratePuzzlesOutput> {
  if (!isDbConfigured()) {
    return {
      username: input.username,
      puzzles: [],
      games_scanned: 0,
      note: "DATABASE_URL is not configured. Run refresh_games first to populate the game store.",
    };
  }

  const limit = input.num_games ?? 20;

  const [analyses, games] = await Promise.all([
    getAnalysesForUser(input.platform, input.username, limit),
    getGamesForUser(input.platform, input.username, limit),
  ]);

  if (analyses.length === 0) {
    return {
      username: input.username,
      puzzles: [],
      games_scanned: 0,
      note: `No analyzed games found. Run refresh_games({ username: "${input.username}", platform: "${input.platform}" }) first, then wait for analysis to complete.`,
    };
  }

  // Build GameMeta from player_games table, keyed by player_game_id
  const gameMap = new Map(games.map((g) => [g.id, g]));

  const gameMetas: GameMeta[] = analyses.map((a) => {
    const meta = gameMap.get(Number(a.player_game_id));
    return {
      game_id: meta?.game_id ?? null,
      player_color: (meta?.player_color as "white" | "black" | null) ?? null,
    };
  });

  // Wait for engine to be ready before running evaluations
  try {
    await waitUntilRouterReady(30_000);
  } catch {
    return {
      username: input.username,
      puzzles: [],
      games_scanned: analyses.length,
      note: "Engine is not ready. Try again after the engine has warmed up (~30-60s after server start).",
    };
  }

  const difficulty = input.difficulty ?? "all";

  const puzzles = await extractPuzzles(
    analyses,
    gameMetas,
    difficulty,
    15 // max puzzles per call
  );

  // Apply puzzle_type filter post-extraction (based on theme keywords)
  const puzzleType = input.puzzle_type ?? "all";
  const filtered =
    puzzleType === "all"
      ? puzzles
      : puzzles.filter((p) => {
          if (puzzleType === "tactical") {
            return ["checkmate", "fork", "pin", "back_rank_weakness", "tactical_combination"].includes(p.theme);
          }
          if (puzzleType === "positional") {
            return ["open_file_tactic", "bishop_activity", "rook_activity", "knight_maneuver", "king_attack"].includes(p.theme);
          }
          if (puzzleType === "endgame") {
            return p.source_move_number >= 35;
          }
          return true;
        });

  const note =
    filtered.length === 0
      ? `No puzzles matched your filters (difficulty: ${difficulty}, type: ${puzzleType}). Try broadening your search.`
      : undefined;

  return {
    username: input.username,
    puzzles: filtered,
    games_scanned: analyses.length,
    ...(note ? { note } : {}),
  };
}
