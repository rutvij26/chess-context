import type { Chess } from "chess.js";
import type { ChessTheme, GamePhase } from "../types/index.js";
import { countPieces } from "./position-classifier.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"]; // board array indices

function squareName(file: number, rank: number): string {
  return `${FILES[file] ?? "a"}${RANKS[rank] ?? "1"}`;
}

// Check if a square name is in a specific rank (1-8 as string)
function rankOf(square: string): number {
  return parseInt(square[1] ?? "1");
}

function fileOf(square: string): number {
  return FILES.indexOf(square[0] ?? "a");
}

// ---------------------------------------------------------------------------
// Individual theme detectors
// ---------------------------------------------------------------------------

function hasKingSafetyConcern(board: Chess, color: "w" | "b"): boolean {
  // Find king position
  let kingSquare = "";
  for (const row of board.board()) {
    for (const piece of row) {
      if (piece && piece.type === "k" && piece.color === color) {
        kingSquare = piece.square;
      }
    }
  }
  if (!kingSquare) return false;

  const kingFile = fileOf(kingSquare);
  const kingRank = rankOf(kingSquare);

  // Count pawns in front of king (within 1 file)
  let shieldPawns = 0;
  for (const row of board.board()) {
    for (const piece of row) {
      if (!piece || piece.type !== "p" || piece.color !== color) continue;
      const pFile = fileOf(piece.square);
      const pRank = rankOf(piece.square);
      const inFront =
        color === "w" ? pRank > kingRank : pRank < kingRank;
      if (Math.abs(pFile - kingFile) <= 1 && inFront) {
        shieldPawns++;
      }
    }
  }

  // King is exposed if few shield pawns and not in center (not endgame safety concern)
  return shieldPawns < 2;
}

function hasPawnStorm(board: Chess, color: "w" | "b"): boolean {
  // Count pawns advanced past the 5th rank for the attacking side
  let advanced = 0;
  for (const row of board.board()) {
    for (const piece of row) {
      if (!piece || piece.type !== "p" || piece.color !== color) continue;
      const rank = rankOf(piece.square);
      if (color === "w" && rank >= 5) advanced++;
      if (color === "b" && rank <= 4) advanced++;
    }
  }
  return advanced >= 2;
}

function hasBishopPair(board: Chess, color: "w" | "b"): boolean {
  let bishops = 0;
  for (const row of board.board()) {
    for (const piece of row) {
      if (piece && piece.type === "b" && piece.color === color) bishops++;
    }
  }
  return bishops >= 2;
}

function hasKnightOutpost(board: Chess, color: "w" | "b"): boolean {
  for (const row of board.board()) {
    for (const piece of row) {
      if (!piece || piece.type !== "n" || piece.color !== color) continue;
      const square = piece.square;
      const rank = rankOf(square);
      const file = fileOf(square);
      const opp = color === "w" ? "b" : "w";

      // Advanced enough to be an outpost
      const isAdvanced =
        color === "w" ? rank >= 5 : rank <= 4;
      if (!isAdvanced) continue;

      // Protected by a friendly pawn
      const protectRank = color === "w" ? rank - 1 : rank + 1;
      const leftSq = squareName(file - 1, 8 - protectRank);
      const rightSq = squareName(file + 1, 8 - protectRank);
      const leftPiece = board.get(leftSq as Parameters<typeof board.get>[0]);
      const rightPiece = board.get(rightSq as Parameters<typeof board.get>[0]);
      const isProtected =
        (leftPiece?.type === "p" && leftPiece.color === color) ||
        (rightPiece?.type === "p" && rightPiece.color === color);

      if (!isProtected) continue;

      // No enemy pawn can attack this square
      const noEnemyAttack = !board.isAttacked(
        square as Parameters<typeof board.isAttacked>[0],
        opp
      );

      if (noEnemyAttack) return true;
    }
  }
  return false;
}

function hasOpenFile(board: Chess): boolean {
  for (let f = 0; f < 8; f++) {
    let whitePawn = false;
    let blackPawn = false;

    for (const row of board.board()) {
      const piece = row[f];
      if (!piece || piece.type !== "p") continue;
      if (piece.color === "w") whitePawn = true;
      else blackPawn = true;
    }

    if (!whitePawn && !blackPawn) return true;
  }
  return false;
}

function hasWeakSquaresAroundKing(board: Chess, color: "w" | "b"): boolean {
  let kingSquare = "";
  for (const row of board.board()) {
    for (const piece of row) {
      if (piece && piece.type === "k" && piece.color === color) {
        kingSquare = piece.square;
      }
    }
  }
  if (!kingSquare) return false;

  const kingFile = fileOf(kingSquare);
  const kingRank = rankOf(kingSquare);
  const opp = color === "w" ? "b" : "w";

  // Count squares adjacent to king attacked by opponent but not defended by our pawns
  let weakCount = 0;
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const f = kingFile + df;
      const r = kingRank + dr;
      if (f < 0 || f >= 8 || r < 1 || r > 8) continue;
      const sq = FILES[f]! + r;
      if (board.isAttacked(sq as Parameters<typeof board.isAttacked>[0], opp)) {
        weakCount++;
      }
    }
  }
  return weakCount >= 3;
}

function hasPin(board: Chess): boolean {
  // Look for pieces that cannot move without exposing the king
  const moves = board.moves({ verbose: true });
  return moves.some((m) => (m.flags ?? "").includes("c")); // simplified proxy
}

function hasForkPotential(board: Chess): boolean {
  // Knight can attack two valuable pieces simultaneously
  const moves = board.moves({ verbose: true });
  const knightMoves = moves.filter((m) => m.piece === "n");

  for (const move of knightMoves) {
    // After the knight moves, check if it attacks multiple valuable pieces
    // Use a simpler heuristic:
    // If there are 2+ opponent pieces within knight range of the destination
    const to = move.to;
    const toFile = fileOf(to);
    const toRank = rankOf(to);
    const knightOffsets = [
      [2, 1], [2, -1], [-2, 1], [-2, -1],
      [1, 2], [1, -2], [-1, 2], [-1, -2],
    ];
    const opp = move.color === "w" ? "b" : "w";
    let targets = 0;

    for (const [df, dr] of knightOffsets) {
      if (df === undefined || dr === undefined) continue;
      const f = toFile + df;
      const r = toRank + (dr ?? 0);
      if (f < 0 || f >= 8 || r < 1 || r > 8) continue;
      const sq = FILES[f]! + r;
      const piece = board.get(sq as Parameters<typeof board.get>[0]);
      if (piece && piece.color === opp && piece.type !== "p") targets++;
    }
    if (targets >= 2) return true;
  }
  return false;
}

function hasBackRankWeakness(board: Chess, color: "w" | "b"): boolean {
  const backRank = color === "w" ? 1 : 8;
  let kingOnBack = false;
  let escapePawns = 0;

  for (const row of board.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const r = rankOf(piece.square);
      if (piece.type === "k" && piece.color === color && r === backRank) {
        kingOnBack = true;
      }
      if (piece.type === "p" && piece.color === color) {
        const f = fileOf(piece.square);
        let kingFile = -1;
        for (const row2 of board.board()) {
          for (const p2 of row2) {
            if (p2?.type === "k" && p2.color === color) {
              kingFile = fileOf(p2.square);
            }
          }
        }
        if (Math.abs(f - kingFile) <= 1) escapePawns++;
      }
    }
  }

  return kingOnBack && escapePawns === 0;
}

function hasOppositeColoredBishops(board: Chess): boolean {
  const bishops: { color: string; squareColor: "light" | "dark" }[] = [];

  for (const row of board.board()) {
    for (const piece of row) {
      if (!piece || piece.type !== "b") continue;
      const f = fileOf(piece.square);
      const r = rankOf(piece.square);
      const squareColor = (f + r) % 2 === 0 ? "dark" : "light";
      bishops.push({ color: piece.color, squareColor });
    }
  }

  const whiteBishops = bishops.filter((b) => b.color === "w");
  const blackBishops = bishops.filter((b) => b.color === "b");

  return (
    whiteBishops.length === 1 &&
    blackBishops.length === 1 &&
    whiteBishops[0]?.squareColor !== blackBishops[0]?.squareColor
  );
}

function hasRookOnSeventh(board: Chess, color: "w" | "b"): boolean {
  const seventhRank = color === "w" ? 7 : 2;
  for (const row of board.board()) {
    for (const piece of row) {
      if (piece && piece.type === "r" && piece.color === color) {
        if (rankOf(piece.square) === seventhRank) return true;
      }
    }
  }
  return false;
}

function hasConnectedRooks(board: Chess, color: "w" | "b"): boolean {
  const rooks: string[] = [];
  for (const row of board.board()) {
    for (const piece of row) {
      if (piece && piece.type === "r" && piece.color === color) {
        rooks.push(piece.square);
      }
    }
  }

  if (rooks.length < 2) return false;

  const [r1, r2] = rooks;
  if (!r1 || !r2) return false;

  // Check if on same rank or file with no pieces between them
  const f1 = fileOf(r1), r1rank = rankOf(r1);
  const f2 = fileOf(r2), r2rank = rankOf(r2);

  if (r1rank === r2rank) {
    // Same rank — check for pieces between
    const minF = Math.min(f1, f2);
    const maxF = Math.max(f1, f2);
    for (let f = minF + 1; f < maxF; f++) {
      if (board.get((FILES[f]! + r1rank) as Parameters<typeof board.get>[0])) {
        return false;
      }
    }
    return true;
  }

  if (f1 === f2) {
    const minR = Math.min(r1rank, r2rank);
    const maxR = Math.max(r1rank, r2rank);
    for (let r = minR + 1; r < maxR; r++) {
      if (board.get((FILES[f1]! + r) as Parameters<typeof board.get>[0])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

function hasMaterialImbalance(board: Chess): boolean {
  const counts = countPieces(board);
  // Significant if one side has a piece type the other doesn't
  const types = ["n", "b", "r", "q"] as const;
  for (const t of types) {
    const diff = Math.abs((counts.white[t] ?? 0) - (counts.black[t] ?? 0));
    if (diff >= 1) {
      // Check if it's compensated by other pieces (rough heuristic)
      let whiteMat = 0, blackMat = 0;
      for (const pt of types) {
        whiteMat += (counts.white[pt] ?? 0) * (PIECE_VALUES[pt] ?? 0);
        blackMat += (counts.black[pt] ?? 0) * (PIECE_VALUES[pt] ?? 0);
      }
      if (Math.abs(whiteMat - blackMat) < 200) return true; // imbalance without clear material lead
    }
  }
  return false;
}

const PIECE_VALUES: Record<string, number> = { n: 320, b: 330, r: 500, q: 900 };

function hasSpaceAdvantage(board: Chess, color: "w" | "b"): boolean {
  // Count squares controlled past the 4th rank
  let controlled = 0;
  const moves = board.moves({ verbose: true });
  for (const m of moves) {
    if (m.color !== color) continue;
    const r = rankOf(m.to);
    if ((color === "w" && r >= 5) || (color === "b" && r <= 4)) {
      controlled++;
    }
  }
  return controlled >= 10;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function tagThemes(board: Chess, phase: GamePhase): ChessTheme[] {
  const themes: ChessTheme[] = [];

  if (hasKingSafetyConcern(board, "w") || hasKingSafetyConcern(board, "b")) {
    themes.push("king_safety");
  }
  if (hasPawnStorm(board, "w") || hasPawnStorm(board, "b")) {
    themes.push("pawn_storm");
  }
  if (hasSpaceAdvantage(board, "w") || hasSpaceAdvantage(board, "b")) {
    themes.push("space_advantage");
  }
  if (hasBishopPair(board, "w") || hasBishopPair(board, "b")) {
    themes.push("bishop_pair");
  }
  if (hasKnightOutpost(board, "w") || hasKnightOutpost(board, "b")) {
    themes.push("knight_outpost");
  }
  if (hasOpenFile(board)) {
    themes.push("open_file");
  }
  if (hasWeakSquaresAroundKing(board, "w") || hasWeakSquaresAroundKing(board, "b")) {
    themes.push("weak_squares");
  }
  if (hasForkPotential(board)) {
    themes.push("fork_potential");
  }
  if (hasBackRankWeakness(board, "w") || hasBackRankWeakness(board, "b")) {
    themes.push("back_rank");
  }
  if (hasOppositeColoredBishops(board)) {
    themes.push("opposite_colored_bishops");
  }
  if (hasRookOnSeventh(board, "w") || hasRookOnSeventh(board, "b")) {
    themes.push("rook_on_seventh");
  }
  if (hasConnectedRooks(board, "w") || hasConnectedRooks(board, "b")) {
    themes.push("connected_rooks");
  }
  if (hasMaterialImbalance(board)) {
    themes.push("material_imbalance");
  }

  // piece_activity: lots of legal moves = active position
  const moveCount = board.moves().length;
  if (moveCount > 35) {
    themes.push("piece_activity");
  }

  // pin: check if current side has pieces pinned (any legal moves constrained)
  // Use board.inCheck() as a proxy + is the king attacked
  if (board.isAttacked(
    (() => {
      for (const row of board.board()) {
        for (const p of row) {
          if (p?.type === "k" && p.color === board.turn()) return p.square as Parameters<typeof board.isAttacked>[0];
        }
      }
      return "e1" as Parameters<typeof board.isAttacked>[0];
    })(),
    board.turn() === "w" ? "b" : "w"
  )) {
    themes.push("pin");
  }

  return themes;
}
