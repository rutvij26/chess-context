import { isDbConfigured } from "../store/db.js";
import { getAnalysesForUser } from "../store/analysis-store.js";
import { getGamesForUser } from "../store/game-store.js";
import { extractPuzzles, type GameMeta } from "../intelligence/puzzle-classifier.js";
import { waitUntilRouterReady } from "../engines/engine-router.js";
import { buildPositionBoardData, sanToUci } from "../intelligence/board-builder.js";
import type { GeneratePuzzlesInput, GeneratePuzzlesOutput, BoardArrow } from "../types/index.js";

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

  // Detect low-coverage analyses (engine wasn't available when analysis ran).
  const lowCoverageCount = analyses.filter(
    (a) => (a.white_accuracy === null || a.white_accuracy === 0) &&
            (a.black_accuracy === null || a.black_accuracy === 0)
  ).length;
  if (lowCoverageCount === analyses.length) {
    return {
      username: input.username,
      puzzles: [],
      games_scanned: analyses.length,
      note: `All ${analyses.length} analyzed game(s) have zero accuracy scores — the engine was not available when analysis ran. Wait 30–60s after server start and run refresh_games again for puzzles to be generated.`,
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

  const rawPuzzles = await extractPuzzles(
    analyses,
    gameMetas,
    difficulty,
    15 // max puzzles per call
  );

  // Apply puzzle_type filter post-extraction (based on theme keywords)
  const puzzleType = input.puzzle_type ?? "all";
  const filteredRaw =
    puzzleType === "all"
      ? rawPuzzles
      : rawPuzzles.filter((p) => {
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

  // Add board_data to each puzzle: show the starting position with an arrow
  // for the first solution move so the user can immediately visualise the tactic.
  const filtered = filteredRaw.map((puzzle) => {
    const arrows: BoardArrow[] = [];
    const firstMoveSan = puzzle.solution[0];
    if (firstMoveSan) {
      const uci = sanToUci(puzzle.fen, firstMoveSan);
      if (uci) {
        arrows.push({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          color: "#4caf50",
          label: "Solution",
          width: "thick",
        });
      }
    }
    return { ...puzzle, board_data: buildPositionBoardData(puzzle.fen, arrows, puzzle.color_to_move) };
  });

  // Produce a precise note depending on WHY no puzzles were returned.
  let note: string | undefined;
  if (rawPuzzles.length === 0) {
    note =
      `No blunders with a forcing engine continuation found in ${analyses.length} analyzed game(s). ` +
      `Analysis may still be running — check get_analysis_progress. ` +
      `If analysis is complete, the games may not contain clear tactical blunders (eval drop ≥ 150cp).`;
  } else if (filtered.length === 0) {
    note =
      `Found ${rawPuzzles.length} puzzle(s) in your games but none matched ` +
      `difficulty="${difficulty}" / type="${puzzleType}". Try broadening your filters.`;
  }

  return {
    username: input.username,
    puzzles: filtered,
    games_scanned: analyses.length,
    ...(note ? { note } : {}),
  };
}
