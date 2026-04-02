import { Chess } from "chess.js";
import type { MoveRecord } from "./critical-moments.js";
import type { CriticalMoment } from "../types/index.js";
import type { StyleFingerprint } from "../types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameDataForStyle {
  moveRecords: MoveRecord[];
  criticalMoments: CriticalMoment[];
  pgn: string;
  playerColor: "white" | "black";
  result: string | null;
}

// ---------------------------------------------------------------------------
// Dimension: Aggression
// Score 0–100: pawn advances past rank 5, piece sacrifices
// ---------------------------------------------------------------------------

function scoreAggression(games: GameDataForStyle[]): number {
  if (games.length === 0) return 50;

  const scores: number[] = [];

  for (const game of games) {
    const { moveRecords, criticalMoments, pgn, playerColor } = game;
    let aggressionPoints = 0;

    // Pawn advances past rank 5 (ranks 5/6/7 for white, 4/3/2 for black)
    const board = new Chess();
    try {
      board.loadPgn(pgn);
    } catch {
      continue;
    }
    const history = board.history({ verbose: true });

    for (const move of history) {
      const isPlayerMove =
        (playerColor === "white" && move.color === "w") ||
        (playerColor === "black" && move.color === "b");

      if (!isPlayerMove) continue;
      if (move.piece !== "p") continue;

      const toRank = parseInt(move.to[1]!, 10);
      if (playerColor === "white" && toRank >= 5) aggressionPoints += (toRank - 4);
      if (playerColor === "black" && toRank <= 4) aggressionPoints += (5 - toRank);
    }

    // Piece sacrifices: large eval drop where player "chose" it (missed_win or the opponent won but the player made the move)
    const sacrifices = criticalMoments.filter(
      (m) =>
        m.color === playerColor &&
        m.eval_drop_cp >= 200 &&
        m.category !== "blunder" // sacrifices are intentional; blunders are oversights
    );
    aggressionPoints += sacrifices.length * 10;

    // Normalize by game length
    const totalMoves = history.filter(
      (m) =>
        (playerColor === "white" && m.color === "w") ||
        (playerColor === "black" && m.color === "b")
    ).length;
    if (totalMoves > 0) {
      scores.push(Math.min(100, (aggressionPoints / totalMoves) * 20));
    }
  }

  if (scores.length === 0) return 50;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// ---------------------------------------------------------------------------
// Dimension: Positional Sense
// Score 0–100: frequency of positional themes in stored move records
// ---------------------------------------------------------------------------

const POSITIONAL_THEMES = new Set([
  "knight_outpost",
  "connected_rooks",
  "bishop_pair",
  "open_file",
  "space_advantage",
  "rook_on_seventh",
]);

// Note: themes are not stored per move in MoveRecord, but are computed per position
// in analyze-position. Since MoveRecord doesn't carry theme data, we approximate
// positional sense from accuracy in non-tactical positions.
function scorePositionalSense(games: GameDataForStyle[]): number {
  if (games.length === 0) return 50;

  const scores: number[] = [];

  for (const game of games) {
    const { moveRecords, criticalMoments, playerColor } = game;

    // Positional accuracy: % of moves where player didn't make a strategic mistake
    // (inaccuracy in non-critical positions)
    const playerMoves = moveRecords.filter((r) => r.color === playerColor);
    if (playerMoves.length === 0) continue;

    const strategicMistakes = criticalMoments.filter(
      (m) =>
        m.color === playerColor &&
        (m.category === "inaccuracy" || m.category === "mistake") &&
        m.eval_drop_cp < 200 // exclude tactical blunders/sacrifices
    );

    const strategicAccuracy =
      1 - strategicMistakes.length / Math.max(1, playerMoves.length);
    scores.push(Math.round(strategicAccuracy * 100));
  }

  if (scores.length === 0) return 50;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// ---------------------------------------------------------------------------
// Dimension: Tactical Sharpness
// Score 0–100: % of tactical opportunities found
// ---------------------------------------------------------------------------

function scoreTacticalSharpness(games: GameDataForStyle[]): number {
  if (games.length === 0) return 50;

  let totalOpportunities = 0;
  let foundOpportunities = 0;

  for (const game of games) {
    const { criticalMoments, playerColor } = game;

    // Tactical opportunity: a position with a clear best move
    // Found = player's eval drop < 30cp (essentially played the best move)
    const opportunities = criticalMoments.filter(
      (m) =>
        m.color === playerColor &&
        (m.category === "brilliant" || m.category === "good" ||
         m.category === "inaccuracy" || m.category === "mistake" ||
         m.category === "blunder" || m.category === "missed_win")
    );

    const found = opportunities.filter((m) => m.eval_drop_cp < 30);

    totalOpportunities += opportunities.length;
    foundOpportunities += found.length;
  }

  if (totalOpportunities === 0) return 60;
  return Math.round((foundOpportunities / totalOpportunities) * 100);
}

// ---------------------------------------------------------------------------
// Dimension: Endgame Skill
// Score 0–100: win conversion rate in winning endgame positions
// ---------------------------------------------------------------------------

function scoreEndgameSkill(games: GameDataForStyle[]): number {
  if (games.length === 0) return 50;

  let winningEndgames = 0;
  let convertedWins = 0;

  for (const game of games) {
    const { moveRecords, playerColor, result } = game;
    const isWhite = playerColor === "white";

    // Check if player had advantage in endgame (move 30+)
    const endgameMoves = moveRecords.filter((r) => r.moveNumber >= 30);
    if (endgameMoves.length === 0) continue;

    const hadAdvantage = endgameMoves.some((r) => {
      const evalFromPlayer = isWhite ? r.evalBefore : -r.evalBefore;
      return evalFromPlayer > 150;
    });

    if (!hadAdvantage) continue;

    winningEndgames++;
    const colorWin = isWhite ? "1-0" : "0-1";
    if (result === colorWin) convertedWins++;
  }

  if (winningEndgames === 0) return 55; // not enough data
  return Math.round((convertedWins / winningEndgames) * 100);
}

// ---------------------------------------------------------------------------
// Dimension: Time Management
// Score 0–100: avg clock % at move 30 (Lichess only, null for Chess.com)
// ---------------------------------------------------------------------------

function parseClockSeconds(annotation: string): number | null {
  // Parses {[%clk 0:05:23]} → seconds
  const match = annotation.match(/\[%clk\s+(\d+):(\d+):(\d+)\]/);
  if (!match) return null;
  const h = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  const s = parseInt(match[3]!, 10);
  return h * 3600 + m * 60 + s;
}

function parseInitialTime(timeControl: string | null): number | null {
  if (!timeControl) return null;
  // e.g. "600+0" → 600 seconds
  const match = timeControl.match(/^(\d+)/);
  if (!match) return null;
  return parseInt(match[1]!, 10);
}

export function scoreTimeManagement(
  pgns: string[],
  timeControls: (string | null)[],
  isLichess: boolean
): number | null {
  if (!isLichess) return null;

  const clockPercentages: number[] = [];

  for (let i = 0; i < pgns.length; i++) {
    const pgn = pgns[i]!;
    const tc = timeControls[i] ?? null;
    const initialSecs = parseInitialTime(tc);
    if (!initialSecs || initialSecs <= 0) continue;

    // Extract clock annotations from PGN moves
    const clockAnnotations = pgn.match(/\{\[%clk[^\}]+\}\}/g) ?? [];

    // Find clock annotation around move 30 (60th half-move)
    if (clockAnnotations.length < 30) continue;
    const move30Clock = clockAnnotations[Math.min(29, clockAnnotations.length - 1)]!;
    const secs = parseClockSeconds(move30Clock);
    if (secs === null) continue;

    clockPercentages.push(Math.min(100, (secs / initialSecs) * 100));
  }

  if (clockPercentages.length === 0) return null;
  return Math.round(
    clockPercentages.reduce((a, b) => a + b, 0) / clockPercentages.length
  );
}

// ---------------------------------------------------------------------------
// Style label mapping
// ---------------------------------------------------------------------------

export function deriveStyleLabel(fp: StyleFingerprint): string {
  const { aggression, positional_sense, tactical_sharpness } = fp;

  if (aggression >= 70 && tactical_sharpness >= 70) return "Aggressive Tactician";
  if (aggression >= 70 && positional_sense >= 70) return "Dynamic Imbalance Seeker";
  if (aggression >= 70) return "Sharp Gambiteer";
  if (positional_sense >= 70 && aggression < 40) return "Solid Positional Player";
  if (aggression < 40 && tactical_sharpness < 40) return "Reactive Defender";
  return "Balanced All-Rounder";
}

export function buildStyleDescription(fp: StyleFingerprint, label: string): string {
  const lines: string[] = [];

  if (fp.aggression >= 70) {
    lines.push("You play aggressively, pushing pawns and seeking tactical complications.");
  } else if (fp.aggression < 40) {
    lines.push("You prefer solid, principled play over risky attacks.");
  } else {
    lines.push("You have a balanced attacking style — aggressive when the position calls for it.");
  }

  if (fp.tactical_sharpness >= 70) {
    lines.push("Your tactical vision is sharp and you find combinations reliably.");
  } else if (fp.tactical_sharpness < 40) {
    lines.push("Tactical patterns are an area for improvement — some combinations are missed.");
  }

  if (fp.endgame_skill >= 70) {
    lines.push("You convert winning endgames well.");
  } else if (fp.endgame_skill < 40) {
    lines.push("Endgame conversion is an area to work on — winning positions sometimes slip away.");
  }

  return lines.join(" ");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function computeStyleFingerprint(
  games: GameDataForStyle[],
  pgns: string[],
  timeControls: (string | null)[],
  isLichess: boolean
): StyleFingerprint {
  return {
    aggression: scoreAggression(games),
    positional_sense: scorePositionalSense(games),
    tactical_sharpness: scoreTacticalSharpness(games),
    endgame_skill: scoreEndgameSkill(games),
    time_management: scoreTimeManagement(pgns, timeControls, isLichess),
  };
}
