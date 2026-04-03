import { Chess } from "chess.js";
import type { OpeningGap } from "../types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameRecord {
  pgn: string;
  result: "win" | "loss" | "draw";  // from the player's perspective
}

interface PositionEntry {
  result: "win" | "loss" | "draw";
  opponentMove: string | null; // opponent's SAN move after reaching this position
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Replay a game up to the opening phase (max move 15 for each side)
 * and yield { fen, moveNumber, result, opponentMoveSan } for every position
 * where it is the player's turn AFTER the position.
 *
 * "opponentMoveSan" = the move the opponent played from this position
 * (i.e. the next move in the game after this fen was reached).
 */
function replayOpening(
  pgn: string,
  playerColor: "white" | "black",
  result: "win" | "loss" | "draw",
  maxMoveNumber = 15
): Array<{ fen: string; moveNumber: number; opponentMoveSan: string | null; result: "win" | "loss" | "draw" }> {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return [];
  }

  // Re-walk move history from start
  const history = chess.history({ verbose: true });
  chess.reset();

  const positions: Array<{ fen: string; moveNumber: number; opponentMoveSan: string | null; result: "win" | "loss" | "draw" }> = [];

  for (let i = 0; i < history.length; i++) {
    const move = history[i]!;
    const moveNumber = Math.ceil((i + 1) / 2);

    if (moveNumber > maxMoveNumber) break;

    // Record positions where it is the player's turn (before they move).
    // Skip move 1 — the starting position is not a meaningful gap.
    const turnColor = chess.turn() === "w" ? "white" : "black";
    if (turnColor === playerColor && moveNumber >= 2) {
      // The opponent's response is two half-moves ahead (player moves at i,
      // opponent responds at i+1).
      const opponentHalfMoveIdx = i + 1;
      const opponentMoveSan =
        opponentHalfMoveIdx < history.length
          ? history[opponentHalfMoveIdx]!.san
          : null;

      positions.push({
        fen: chess.fen(),
        moveNumber,
        opponentMoveSan,
        result,
      });
    }

    chess.move(move.san);
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Detect opening repertoire gaps from a list of games.
 *
 * A "gap" is a position the player reaches repeatedly where:
 *  - The opponent deviates from the most common response >= 30% of the time
 *  - The player's results are worse after those deviations
 */
export function detectOpeningGaps(
  games: GameRecord[],
  playerColor: "white" | "black",
  minOccurrences = 3
): OpeningGap[] {
  // fen → list of entries (each game visit to this position)
  const positionMap = new Map<string, { moveNumber: number; entries: PositionEntry[] }>();

  for (const game of games) {
    const positions = replayOpening(game.pgn, playerColor, game.result);

    for (const pos of positions) {
      const existing = positionMap.get(pos.fen);
      const entry: PositionEntry = {
        result: pos.result,
        opponentMove: pos.opponentMoveSan,
      };

      if (existing) {
        existing.entries.push(entry);
      } else {
        positionMap.set(pos.fen, { moveNumber: pos.moveNumber, entries: [entry] });
      }
    }
  }

  const gaps: OpeningGap[] = [];

  for (const [fen, { moveNumber, entries }] of positionMap) {
    if (entries.length < minOccurrences) continue;

    // Find the most common opponent move
    const moveCounts = new Map<string, number>();
    for (const e of entries) {
      if (e.opponentMove) {
        moveCounts.set(e.opponentMove, (moveCounts.get(e.opponentMove) ?? 0) + 1);
      }
    }

    if (moveCounts.size === 0) continue;

    // Sort moves by frequency desc
    const sortedMoves = [...moveCounts.entries()].sort((a, b) => b[1] - a[1]);
    const [mostCommonMove, mostCommonCount] = sortedMoves[0]!;

    // "Book" = most common move; deviations = everything else
    const deviationEntries = entries.filter(
      (e) => e.opponentMove !== null && e.opponentMove !== mostCommonMove
    );
    const bookEntries = entries.filter(
      (e) => e.opponentMove === mostCommonMove
    );

    const totalWithMove = entries.filter((e) => e.opponentMove !== null).length;
    const deviationRate = totalWithMove > 0
      ? Math.round((deviationEntries.length / totalWithMove) * 100)
      : 0;

    // Only flag as a gap if opponent deviates significantly.
    // Require at least 1 deviation entry (avoids divide-by-zero noise);
    // the deviationRate threshold already filters out low-signal positions.
    if (deviationRate < 25 || deviationEntries.length === 0) continue;

    const calcWinRate = (arr: PositionEntry[]) =>
      arr.length === 0
        ? 0
        : Math.round((arr.filter((e) => e.result === "win").length / arr.length) * 100);

    const calcLossRate = (arr: PositionEntry[]) =>
      arr.length === 0
        ? 0
        : Math.round((arr.filter((e) => e.result === "loss").length / arr.length) * 100);

    const deviationWinRate = calcWinRate(deviationEntries);
    const deviationLossRate = calcLossRate(deviationEntries);
    const bookWinRate = calcWinRate(bookEntries);

    // Only flag if results after deviation are worse than book lines
    if (deviationLossRate <= deviationWinRate && deviationWinRate >= bookWinRate) continue;

    // Find the most frequent non-book deviation
    const topDeviation =
      sortedMoves.find(([move]) => move !== mostCommonMove)?.[0] ?? null;

    const studySuggestion = buildStudySuggestion(
      fen,
      moveNumber,
      playerColor,
      deviationLossRate,
      topDeviation
    );

    gaps.push({
      fen,
      move_number: moveNumber,
      occurrences: entries.length,
      opponent_deviation_rate: deviationRate,
      player_win_rate: deviationWinRate,
      player_loss_rate: deviationLossRate,
      most_common_deviation: topDeviation,
      study_suggestion: studySuggestion,
    });
  }

  // Sort by impact: loss_rate × occurrences, highest first
  gaps.sort(
    (a, b) =>
      b.player_loss_rate * b.occurrences - a.player_loss_rate * a.occurrences
  );

  return gaps;
}

// ---------------------------------------------------------------------------
// Study suggestion builder
// ---------------------------------------------------------------------------

function buildStudySuggestion(
  fen: string,
  moveNumber: number,
  color: "white" | "black",
  lossRate: number,
  topDeviation: string | null
): string {
  const colorStr = color === "white" ? "White" : "Black";
  const deviationPart = topDeviation
    ? ` Opponents most often surprise you with ${topDeviation}.`
    : "";

  if (lossRate >= 60) {
    return `Critical gap at move ${moveNumber} for ${colorStr}. You lose ${lossRate}% of games when the opponent goes off-book here.${deviationPart} Study this position thoroughly — learn at least two reliable responses.`;
  }
  if (lossRate >= 40) {
    return `Significant gap at move ${moveNumber} for ${colorStr}. You lose ${lossRate}% of games after opponent deviations here.${deviationPart} Prepare one solid response to the most common surprise.`;
  }
  return `Potential gap at move ${moveNumber} for ${colorStr}.${deviationPart} Familiarize yourself with the key ideas after opponent deviations.`;
}
