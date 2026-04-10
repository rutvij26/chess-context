import { Chess } from "chess.js";
import { waitUntilRouterReady, getEval } from "../engines/engine-router.js";
import {
  classifyPhase,
  classifyPawnStructure,
  getMaterialBalance,
  estimateComplexity,
} from "../intelligence/position-classifier.js";
import { tagThemes } from "../intelligence/theme-tagger.js";
import { generateNarrative } from "../intelligence/narrative-generator.js";
import { config } from "../config.js";
import type {
  AnalyzePositionInput,
  PositionAnalysis,
  TopMove,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a UCI move (e.g. "e2e4") to SAN notation using chess.js.
 * Returns the UCI move if conversion fails.
 */
export function uciToSan(board: Chess, uciMove: string): string {
  try {
    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length === 5 ? uciMove[4] : undefined;
    const result = board.move({
      from: from as Parameters<typeof board.move>[0] extends { from: infer F } ? F : string,
      to: to as Parameters<typeof board.move>[0] extends { to: infer T } ? T : string,
      ...(promotion ? { promotion } : {}),
    });
    const san = result.san;
    board.undo();
    return san;
  } catch {
    return uciMove;
  }
}

/**
 * Convert a PV (array of UCI moves) to SAN notation.
 * Returns the first 4 moves as SAN.
 */
export function pvToSan(board: Chess, pv: string[]): string[] {
  const clone = new Chess(board.fen());
  const sans: string[] = [];

  for (const uciMove of pv.slice(0, 4)) {
    try {
      const from = uciMove.slice(0, 2);
      const to = uciMove.slice(2, 4);
      const promotion = uciMove.length === 5 ? uciMove[4] : undefined;
      const result = clone.move({ from, to, ...(promotion ? { promotion } : {}) });
      sans.push(result.san);
    } catch {
      break; // Stop if a move is illegal (can happen at end of PV)
    }
  }

  return sans;
}

function evalToText(scoreCp: number | null, scoreMate: number | null): string {
  if (scoreMate !== null) {
    return scoreMate > 0 ? `Mate in ${scoreMate}` : `Mated in ${Math.abs(scoreMate)}`;
  }
  if (scoreCp === null) return "Unknown";
  if (scoreCp >= 300) return "White is winning";
  if (scoreCp <= -300) return "Black is winning";
  if (scoreCp >= 100) return "White has a clear advantage";
  if (scoreCp <= -100) return "Black has a clear advantage";
  if (scoreCp >= 25) return "Slight advantage for White";
  if (scoreCp <= -25) return "Slight advantage for Black";
  return "Equal position";
}

function buildMoveExplanation(board: Chess, san: string, pvSan: string[]): string {
  const captures = san.includes("x");
  const check = san.includes("+") || san.includes("#");
  const castling = san.includes("O-O");

  const continuation =
    pvSan.length > 1 ? ` Expected continuation: ${pvSan.slice(0, 3).join(" ")}` : "";

  if (castling) return `Castling — improves king safety and connects the rooks.${continuation}`;
  if (check) return `A checking move that forces the opponent to respond.${continuation}`;
  if (captures) return `A capture that changes the material balance.${continuation}`;
  return `A developing/positional move improving piece placement or pawn structure.${continuation}`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleAnalyzePosition(
  input: AnalyzePositionInput
): Promise<PositionAnalysis> {
  await waitUntilRouterReady(config.stockfish.readinessTimeout);

  const depth = input.depth ?? config.stockfish.defaultDepth;
  const numLines = input.num_lines ?? config.stockfish.defaultMultiPv;

  // Validate FEN
  let board: Chess;
  try {
    board = new Chess(input.fen);
  } catch {
    throw new Error(`Invalid FEN string: ${input.fen}`);
  }

  const lines = await getEval(input.fen, depth, numLines);

  if (lines.length === 0) {
    throw new Error("Engine returned no analysis lines for this position.");
  }

  // Classify position
  const phase = classifyPhase(board);
  const structures = classifyPawnStructure(board);
  const material = getMaterialBalance(board);
  const themes = tagThemes(board, phase);

  const bestLine = lines[0]!;
  const evalSwing = bestLine.score_cp !== null ? Math.abs(bestLine.score_cp) : 0;
  const complexity = estimateComplexity(board, evalSwing);

  // Build top moves
  const topMoves: TopMove[] = lines.map((line) => {
    const firstMove = line.pv[0] ?? "";
    const san = firstMove ? uciToSan(board, firstMove) : "";
    const pvSan = pvToSan(board, line.pv);
    return {
      move_uci: firstMove,
      move_san: san,
      eval_cp: line.score_cp,
      eval_mate: line.score_mate,
      continuation: pvSan.slice(1),
      explanation: buildMoveExplanation(board, san, pvSan),
    };
  });

  // Generate narrative
  const narrative = generateNarrative(
    phase,
    structures,
    themes,
    bestLine.score_cp,
    bestLine.score_mate
  );

  return {
    evaluation: {
      score_cp: bestLine.score_cp,
      score_mate: bestLine.score_mate,
      score_text: evalToText(bestLine.score_cp, bestLine.score_mate),
      depth: bestLine.depth,
    },
    best_moves: topMoves,
    position_context: {
      phase,
      move_number: Math.ceil(board.history().length / 2) + 1,
      pawn_structures: structures,
      themes,
      material_balance: material.advantage,
      complexity,
      narrative,
    },
  };
}
