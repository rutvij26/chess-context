import { config } from "../config.js";
import type { CriticalMoment, MoveCategory } from "../types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MoveRecord {
  moveNumber: number;
  color: "white" | "black";
  san: string;
  fenBefore: string;
  fenAfter: string;
  evalBefore: number; // centipawns, from white's perspective
  evalAfter: number;
  bestMoveSan: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise eval to always be from the perspective of the side to move.
 * White's eval is positive when white is better.
 * Black's eval: we need to flip the sign when it's black's turn.
 */
export function evalForSideToMove(evalCp: number, color: "white" | "black"): number {
  return color === "white" ? evalCp : -evalCp;
}

export function categorise(evalDropCp: number, hadWinning: boolean, isNowLosing: boolean): MoveCategory {
  if (hadWinning && isNowLosing) return "missed_win";
  if (evalDropCp >= config.analysis.blunderThreshold) return "blunder";
  if (evalDropCp >= config.analysis.mistakeThreshold) return "mistake";
  if (evalDropCp >= config.analysis.inaccuracyThreshold) return "inaccuracy";
  return "good";
}

function buildExplanation(
  san: string,
  bestSan: string,
  category: MoveCategory,
  evalDropCp: number
): string {
  if (category === "missed_win") {
    return `${san} let a winning advantage slip away. The engine recommends ${bestSan} to maintain a decisive edge.`;
  }
  if (category === "blunder") {
    return `${san} is a blunder, losing ${(evalDropCp / 100).toFixed(1)} pawns of advantage. The best move was ${bestSan}.`;
  }
  if (category === "mistake") {
    return `${san} is a mistake, giving away ${(evalDropCp / 100).toFixed(1)} pawns. ${bestSan} was the correct continuation.`;
  }
  if (category === "inaccuracy") {
    return `${san} is slightly inaccurate. The more precise move was ${bestSan}, maintaining a better position.`;
  }
  return `${san} is a good move.`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Given a sequence of moves with evaluations (from white's perspective),
 * detect critical moments — positions where the eval changed significantly.
 */
export function detectCriticalMoments(moves: MoveRecord[]): CriticalMoment[] {
  const moments: CriticalMoment[] = [];

  for (const move of moves) {
    const evalBefore = evalForSideToMove(move.evalBefore, move.color);
    const evalAfter = evalForSideToMove(move.evalAfter, move.color);

    // Eval drop: how much worse for the side that moved
    const evalDropCp = evalBefore - evalAfter;

    if (evalDropCp < config.analysis.inaccuracyThreshold) continue;

    const hadWinning = evalBefore >= 300;
    const isNowLosing = evalAfter <= -50;

    const category = categorise(evalDropCp, hadWinning, isNowLosing);
    if (category === "good") continue;

    const explanation = buildExplanation(
      move.san,
      move.bestMoveSan,
      category,
      evalDropCp
    );

    moments.push({
      move_number: move.moveNumber,
      color: move.color,
      move_played: move.san,
      best_move: move.bestMoveSan,
      eval_before_cp: move.evalBefore,
      eval_after_cp: move.evalAfter,
      eval_drop_cp: evalDropCp,
      category,
      explanation,
    });
  }

  return moments;
}

// ---------------------------------------------------------------------------
// Accuracy calculation
// ---------------------------------------------------------------------------

/**
 * Compute accuracy for one side across all their moves.
 * A move within 30cp of the best move is considered "accurate".
 * Returns a percentage 0-100.
 */
export function computeAccuracy(moves: MoveRecord[], color: "white" | "black"): number {
  const myMoves = moves.filter((m) => m.color === color);
  if (myMoves.length === 0) return 100;

  const accurateMoves = myMoves.filter((m) => {
    const evalBefore = evalForSideToMove(m.evalBefore, m.color);
    const evalAfter = evalForSideToMove(m.evalAfter, m.color);
    const drop = evalBefore - evalAfter;
    return drop < 30;
  });

  return Math.round((accurateMoves.length / myMoves.length) * 100);
}

// ---------------------------------------------------------------------------
// Mistake categorization by game phase
// ---------------------------------------------------------------------------

export function categoriseMistakesByPhase(moments: CriticalMoment[]): {
  tactical: number;
  strategic: number;
  opening: number;
  endgame: number;
} {
  // Simple heuristic: move number determines phase
  let tactical = 0, strategic = 0, opening = 0, endgame = 0;

  for (const m of moments) {
    if (m.category === "good" || m.category === "inaccuracy") continue;

    if (m.move_number <= 12) {
      opening++;
    } else if (m.move_number >= 35) {
      endgame++;
    } else {
      // Blunders tend to be tactical, mistakes tend to be strategic
      if (m.category === "blunder") tactical++;
      else strategic++;
    }
  }

  return { tactical, strategic, opening, endgame };
}
