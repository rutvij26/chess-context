import { Chess } from "chess.js";
import type { BoardArrow, BoardData, BoardMove } from "../types/index.js";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function classToColor(classification: string | null): string {
  switch (classification) {
    case "best":      return "#4caf50";
    case "excellent":
    case "good":      return "#8bc34a";
    case "inaccuracy": return "#ffeb3b";
    case "mistake":   return "#ff9800";
    case "blunder":
    case "missed_win":
    case "miss":      return "#f44336";
    default:          return "#2196f3";
  }
}

// ---------------------------------------------------------------------------
// SAN → UCI conversion helper
// ---------------------------------------------------------------------------

/**
 * Convert a SAN move at a given FEN position to UCI notation (e.g. "e2e4").
 * Returns null if the move is illegal or cannot be parsed.
 */
export function sanToUci(fen: string, san: string): string | null {
  try {
    const board = new Chess(fen);
    const move = board.move(san);
    return move.from + move.to + (move.promotion ?? "");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Position board helpers
// ---------------------------------------------------------------------------

/**
 * Build arrows for the top engine moves at a position.
 * The first move gets a "Best" label and a thick arrow; subsequent moves get
 * progressively thinner arrows.
 */
export function buildPositionArrows(topMoveUcis: string[]): BoardArrow[] {
  const widths: BoardArrow["width"][] = ["thick", "normal", "thin"];
  const colors = ["#4caf50", "#8bc34a", "#81c784"];
  const arrows: BoardArrow[] = [];

  for (let i = 0; i < Math.min(topMoveUcis.length, 3); i++) {
    const uci = topMoveUcis[i];
    if (!uci || uci.length < 4) continue;
    arrows.push({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      color: colors[i] ?? "#4caf50",
      label: i === 0 ? "Best" : null,
      width: widths[i] ?? "thin",
    });
  }

  return arrows;
}

/**
 * Build board data for a single position (no game history).
 *
 * Used by: analyze_position, generate_puzzles (per puzzle),
 *          find_opening_gaps (per gap), get_opening_theory.
 *
 * The arrows are stored in meta.initial_arrows so a frontend can render them
 * on the initial FEN before any moves are played.
 */
export function buildPositionBoardData(
  fen: string,
  arrows: BoardArrow[],
  orientation: "white" | "black" = "white"
): BoardData {
  return {
    meta: {
      initialFen: fen,
      orientation,
      ...(arrows.length > 0 ? { initial_arrows: arrows } : {}),
    },
    moves: [],
    players: {
      white: { name: "White", rating: null },
      black: { name: "Black", rating: null },
    },
    opening: null,
    result: "*",
    timeControl: null,
  };
}

// ---------------------------------------------------------------------------
// Game board
// ---------------------------------------------------------------------------

export interface GameBoardParams {
  /** Verbose move list from chess.js history({ verbose: true }). */
  history: ReadonlyArray<{
    from: string;
    to: string;
    san: string;
    promotion?: string;
  }>;
  /**
   * Centipawn evaluations indexed by position index.
   * evals[0] = initial position, evals[i] = position after ply i.
   */
  evals: readonly number[];
  /**
   * Best UCI move from each position.
   * bestMovesUci[i] = best move playable from position i (i.e. before ply i+1).
   */
  bestMovesUci: readonly string[];
  /** 1-indexed ply numbers that represent critical moments. */
  criticalPlies: ReadonlySet<number>;
  /** ply → move classification (e.g. "blunder", "mistake"). */
  classifications: ReadonlyMap<number, string>;
  /** ply → annotation text shown on the board. */
  annotations: ReadonlyMap<number, string>;
  orientation: "white" | "black";
  white: string;
  black: string;
  whiteRating: number | null;
  blackRating: number | null;
  eco: string | null;
  openingName: string | null;
  result: string;
  timeControl: string | null;
}

/**
 * Build board data for a full game.
 * Arrows are only added at critical plies (blunders, mistakes, etc.).
 * Returns null if the game cannot be replayed (invalid move history).
 */
export function buildGameBoardData(params: GameBoardParams): BoardData | null {
  try {
    const replayBoard = new Chess();
    const initialFen = replayBoard.fen();
    const moves: BoardMove[] = [];

    for (let i = 0; i < params.history.length; i++) {
      const move = params.history[i]!;
      replayBoard.move(move.san);
      const fen = replayBoard.fen();
      const uci = move.from + move.to + (move.promotion ?? "");
      const ply = i + 1; // 1-indexed
      const classification = params.classifications.get(ply) ?? null;
      const arrows: BoardArrow[] = [];

      if (params.criticalPlies.has(ply)) {
        arrows.push({
          from: move.from,
          to: move.to,
          color: classToColor(classification),
          label: null,
          width: "thick",
        });
        const bestUci = params.bestMovesUci[i] ?? "";
        if (bestUci.length >= 4 && bestUci !== uci) {
          arrows.push({
            from: bestUci.slice(0, 2),
            to: bestUci.slice(2, 4),
            color: "#4caf50",
            label: "Best",
            width: "normal",
          });
        }
      }

      moves.push({
        ply,
        san: move.san,
        fen,
        uci,
        eval: params.evals[ply] ?? null,
        classification,
        annotation: params.annotations.get(ply) ?? null,
        arrows,
        clock: null,
      });
    }

    return {
      meta: { initialFen, orientation: params.orientation },
      moves,
      players: {
        white: { name: params.white, rating: params.whiteRating },
        black: { name: params.black, rating: params.blackRating },
      },
      opening:
        params.eco && params.openingName
          ? { eco: params.eco, name: params.openingName, moves: "" }
          : null,
      result: params.result,
      timeControl: params.timeControl,
    };
  } catch {
    return null;
  }
}
