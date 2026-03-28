import type { Chess } from "chess.js";
import type { GamePhase, PawnStructure } from "../types/index.js";

// ---------------------------------------------------------------------------
// Piece values for material balance (centipawns)
// ---------------------------------------------------------------------------

const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

interface PieceCount {
  white: Record<string, number>;
  black: Record<string, number>;
  total: number;
}

export function countPieces(board: Chess): PieceCount {
  const counts: PieceCount = {
    white: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    black: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    total: 0,
  };

  for (const row of board.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const side = piece.color === "w" ? "white" : "black";
      counts[side][piece.type] = (counts[side][piece.type] ?? 0) + 1;
      counts.total++;
    }
  }

  return counts;
}

// Build pawn maps: file (0=a … 7=h) → array of ranks (0=1 … 7=8)
interface PawnMaps {
  white: number[][]; // white[file] = [rank, ...]
  black: number[][];
}

function buildPawnMaps(board: Chess): PawnMaps {
  const white: number[][] = Array.from({ length: 8 }, () => []);
  const black: number[][] = Array.from({ length: 8 }, () => []);

  const b = board.board();
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = b[rank]?.[file];
      if (!piece || piece.type !== "p") continue;
      if (piece.color === "w") {
        white[file]?.push(rank);
      } else {
        black[file]?.push(rank);
      }
    }
  }

  return { white, black };
}

// ---------------------------------------------------------------------------
// Game phase detection
// ---------------------------------------------------------------------------

/**
 * Classify the current game phase based on piece count and game progression.
 * Opening: early in the game, most pieces present.
 * Endgame: queens gone OR very few total pieces.
 * Middlegame: everything else.
 */
export function classifyPhase(board: Chess): GamePhase {
  const counts = countPieces(board);
  const history = board.history();
  const moveNumber = Math.ceil(history.length / 2);

  const hasWhiteQueen = (counts.white["q"] ?? 0) > 0;
  const hasBlackQueen = (counts.black["q"] ?? 0) > 0;
  const totalMinorMajor = counts.total - (counts.white["p"] ?? 0) - (counts.black["p"] ?? 0) - 2; // subtract kings

  // Endgame conditions
  if ((!hasWhiteQueen && !hasBlackQueen) || totalMinorMajor <= 4 || counts.total <= 8) {
    return "endgame";
  }

  // Opening: few moves made, both queens still present, most pieces undeveloped
  if (moveNumber <= 12 && hasWhiteQueen && hasBlackQueen && counts.total >= 24) {
    return "opening";
  }

  return "middlegame";
}

// ---------------------------------------------------------------------------
// Pawn structure classification
// ---------------------------------------------------------------------------

export function classifyPawnStructure(board: Chess): PawnStructure[] {
  const maps = buildPawnMaps(board);
  const structures = new Set<PawnStructure>();

  for (const color of ["white", "black"] as const) {
    const myPawns = maps[color];
    const oppPawns = maps[color === "white" ? "black" : "white"];

    for (let file = 0; file < 8; file++) {
      const ranks = myPawns[file] ?? [];
      if (ranks.length === 0) continue;

      // Doubled pawns: more than one pawn on the same file
      if (ranks.length > 1) {
        structures.add("doubled");
      }

      for (const rank of ranks) {
        const leftFile = file - 1;
        const rightFile = file + 1;

        // Isolated: no friendly pawns on adjacent files
        const hasLeft = leftFile >= 0 && (myPawns[leftFile]?.length ?? 0) > 0;
        const hasRight = rightFile < 8 && (myPawns[rightFile]?.length ?? 0) > 0;
        if (!hasLeft && !hasRight) {
          structures.add("isolated");
        }

        // Passed: no enemy pawns on same or adjacent files ahead of this pawn
        const advanceDir = color === "white" ? -1 : 1; // white advances from rank 6 toward 0 (board array flipped)
        const files = [leftFile, file, rightFile].filter((f) => f >= 0 && f < 8);
        const isPassed = files.every((f) => {
          const oppRanks = oppPawns[f] ?? [];
          return !oppRanks.some((r) =>
            color === "white" ? r < rank : r > rank
          );
        });
        if (isPassed && ranks.length === 1) {
          structures.add("passed");
        }

        // Backward: cannot be protected by adjacent friendly pawns and is not advanced
        const supportingFiles = [leftFile, rightFile].filter((f) => f >= 0 && f < 8);
        const canBeSupported = supportingFiles.some((f) => {
          const friendlyRanks = myPawns[f] ?? [];
          return friendlyRanks.some((r) =>
            color === "white" ? r === rank + 1 : r === rank - 1
          );
        });
        const isAdvanced = color === "white" ? rank <= 3 : rank >= 4;
        if (!canBeSupported && !hasLeft && !hasRight && !isAdvanced) {
          structures.add("backward");
        }

        // Chain: pawn diagonally protected by another friendly pawn
        if (
          (leftFile >= 0 && (myPawns[leftFile]?.includes(rank + (color === "white" ? 1 : -1)) ?? false)) ||
          (rightFile < 8 && (myPawns[rightFile]?.includes(rank + (color === "white" ? 1 : -1)) ?? false))
        ) {
          structures.add("chain");
        }
      }
    }
  }

  // Hanging pawns: two connected pawns on the c and d files (or d and e) with no support
  const whiteCPawns = maps.white[2]?.length ?? 0; // c-file = index 2
  const whiteDPawns = maps.white[3]?.length ?? 0;
  if (whiteCPawns > 0 && whiteDPawns > 0 && (maps.white[1]?.length ?? 0) === 0 && (maps.white[4]?.length ?? 0) === 0) {
    structures.add("hanging");
  }

  // Center structure types
  const whiteOnE4 = maps.white[4]?.includes(4) ?? false; // e4 = file 4, rank 4 (board is 0=rank8..7=rank1)
  const whiteOnD4 = maps.white[3]?.includes(4) ?? false;
  const blackOnE5 = maps.black[4]?.includes(3) ?? false;
  const blackOnD5 = maps.black[3]?.includes(3) ?? false;

  const whiteCenterPawns = (whiteOnE4 ? 1 : 0) + (whiteOnD4 ? 1 : 0);
  const blackCenterPawns = (blackOnE5 ? 1 : 0) + (blackOnD5 ? 1 : 0);

  if (whiteCenterPawns === 2 && blackCenterPawns === 2) {
    structures.add("symmetrical");
  }

  if ((whiteOnE4 && blackOnD5) || (whiteOnD4 && blackOnE5)) {
    structures.add("closed_center");
  }

  if (whiteCenterPawns === 0 && blackCenterPawns === 0) {
    structures.add("open_center");
  } else if (Math.abs(whiteCenterPawns - blackCenterPawns) >= 1) {
    structures.add("semi_open_center");
  }

  return Array.from(structures);
}

// ---------------------------------------------------------------------------
// Material balance
// ---------------------------------------------------------------------------

/**
 * Returns material balance in centipawns.
 * Positive = white is ahead, negative = black is ahead.
 */
export function getMaterialBalance(board: Chess): {
  white: number;
  black: number;
  advantage: number;
} {
  let white = 0;
  let black = 0;

  for (const row of board.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type] ?? 0;
      if (piece.color === "w") white += value;
      else black += value;
    }
  }

  return { white, black, advantage: white - black };
}

// ---------------------------------------------------------------------------
// Complexity estimate
// ---------------------------------------------------------------------------

export function estimateComplexity(
  board: Chess,
  evalSwing: number
): "low" | "medium" | "high" {
  const moveCount = board.moves().length;

  if (evalSwing > 150 || moveCount > 50) return "high";
  if (evalSwing > 60 || moveCount > 30) return "medium";
  return "low";
}
