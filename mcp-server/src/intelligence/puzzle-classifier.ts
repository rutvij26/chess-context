import { Chess } from "chess.js";
import { createHash } from "crypto";
import { getEval } from "../engines/engine-router.js";
import { tagThemes } from "./theme-tagger.js";
import { classifyPhase } from "./position-classifier.js";
import { config } from "../config.js";
import type { ChessPuzzle } from "../types/index.js";
import type { MoveRecord } from "./critical-moments.js";
import type { CriticalMoment } from "../types/index.js";
import type { GameAnalysisRow } from "../store/analysis-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameMeta {
  game_id: string | null;
  player_color: "white" | "black" | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fenToId(fen: string): string {
  return createHash("sha256").update(fen).digest("hex").slice(0, 8);
}

/**
 * Convert a UCI PV array to SAN notation using chess.js.
 * Returns as many moves as can be applied cleanly (stops on illegal move).
 */
function pvToSan(fen: string, pv: string[]): string[] {
  const chess = new Chess(fen);
  const sans: string[] = [];
  for (const uci of pv) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length === 5 ? uci[4] : undefined;
    try {
      const result = chess.move({
        from: from as Parameters<typeof chess.move>[0] extends { from: infer F } ? F : string,
        to: to as Parameters<typeof chess.move>[0] extends { to: infer T } ? T : string,
        ...(promotion ? { promotion } : {}),
      });
      sans.push(result.san);
    } catch {
      break;
    }
  }
  return sans;
}

function classifyDifficulty(
  solutionLength: number,
  evalSwingCp: number,
  isMate: boolean
): ChessPuzzle["difficulty"] {
  if (isMate || solutionLength === 1) return "easy";
  if (solutionLength <= 3 && evalSwingCp >= 200) return "medium";
  return "hard";
}

function detectTheme(fen: string, solutionSan: string[]): string {
  const chess = new Chess(fen);
  const phase = classifyPhase(chess);
  const themes = tagThemes(chess, phase);

  // Check for mate theme first
  if (solutionSan.some((s) => s.includes("#"))) return "checkmate";
  if (solutionSan.some((s) => s.includes("+"))) {
    if (themes.includes("pin")) return "pin";
    if (themes.includes("fork_potential")) return "fork";
  }
  if (themes.includes("back_rank")) return "back_rank_weakness";
  if (themes.includes("pin")) return "pin";
  if (themes.includes("fork_potential")) return "fork";
  if (themes.includes("open_file")) return "open_file_tactic";
  if (themes.includes("king_safety")) return "king_attack";

  // Fallback based on piece type in first solution move
  const firstMove = solutionSan[0] ?? "";
  if (firstMove.startsWith("R") || firstMove.startsWith("Q")) return "rook_activity";
  if (firstMove.startsWith("N")) return "knight_maneuver";
  if (firstMove.startsWith("B")) return "bishop_activity";

  return "tactical_combination";
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Extract puzzles from stored game analyses.
 *
 * For each blunder (eval_drop >= blunderThreshold) in stored critical_moments,
 * locate the FEN before the blunder from move_records, run the engine to get
 * the forcing PV, then classify difficulty and theme.
 *
 * Engine calls are cached (SQLite), so re-runs are near-instant for
 * previously analyzed positions.
 */
export async function extractPuzzles(
  analyses: GameAnalysisRow[],
  gameMetas: GameMeta[],
  difficultyFilter: "easy" | "medium" | "hard" | "all",
  maxPuzzles = 15
): Promise<ChessPuzzle[]> {
  // Collect candidates: (fenBefore, evalDrop, color, gameId, moveNumber)
  interface Candidate {
    fen: string;
    evalDropCp: number;
    color: "white" | "black";
    gameId: string | null;
    moveNumber: number;
  }

  const candidates: Candidate[] = [];

  for (let i = 0; i < analyses.length; i++) {
    const analysis = analyses[i]!;
    const meta = gameMetas[i] ?? { game_id: null, player_color: null };

    const moments: CriticalMoment[] = Array.isArray(analysis.critical_moments)
      ? analysis.critical_moments
      : [];
    const moveRecords: MoveRecord[] = Array.isArray(analysis.move_records)
      ? analysis.move_records
      : [];

    for (const moment of moments) {
      if (moment.eval_drop_cp < config.analysis.blunderThreshold) continue;

      // Find the matching MoveRecord to get fenBefore
      const record = moveRecords.find(
        (r) => r.moveNumber === moment.move_number && r.color === moment.color
      );
      if (!record?.fenBefore) continue;

      candidates.push({
        fen: record.fenBefore,
        evalDropCp: moment.eval_drop_cp,
        color: moment.color,
        gameId: meta.game_id,
        moveNumber: moment.move_number,
      });
    }
  }

  // Deduplicate by FEN (same position can appear across games)
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.fen)) return false;
    seen.add(c.fen);
    return true;
  });

  // Sort by eval drop descending (most critical first) and cap
  unique.sort((a, b) => b.evalDropCp - a.evalDropCp);
  const topCandidates = unique.slice(0, maxPuzzles * 2); // extra buffer for difficulty filter

  const puzzles: ChessPuzzle[] = [];

  for (const candidate of topCandidates) {
    if (puzzles.length >= maxPuzzles) break;

    let lines;
    try {
      lines = await getEval(candidate.fen, 16, 1);
    } catch {
      continue;
    }

    const bestLine = lines[0];
    if (!bestLine || bestLine.pv.length === 0) continue;

    const solution = pvToSan(candidate.fen, bestLine.pv.slice(0, 5));
    if (solution.length === 0) continue;

    const isMate = bestLine.score_mate !== null && bestLine.score_mate > 0;
    const difficulty = classifyDifficulty(solution.length, candidate.evalDropCp, isMate);

    if (difficultyFilter !== "all" && difficulty !== difficultyFilter) continue;

    const theme = detectTheme(candidate.fen, solution);

    puzzles.push({
      id: fenToId(candidate.fen),
      fen: candidate.fen,
      color_to_move: candidate.color,
      solution,
      difficulty,
      eval_swing_cp: candidate.evalDropCp,
      theme,
      source_game_id: candidate.gameId,
      source_move_number: candidate.moveNumber,
    });
  }

  // Stable sort: easy → medium → hard
  const order: Record<ChessPuzzle["difficulty"], number> = { easy: 0, medium: 1, hard: 2 };
  puzzles.sort((a, b) => order[a.difficulty] - order[b.difficulty]);

  return puzzles;
}
