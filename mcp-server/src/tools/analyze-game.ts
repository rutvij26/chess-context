import { Chess } from "chess.js";
import { analyzePosition as stockfishAnalyze } from "../engines/stockfish.js";
import { getCloudEval } from "../engines/lichess-eval.js";
import { getPositionEval, setPositionEval, positionCacheKey } from "../cache/index.js";
import {
  detectCriticalMoments,
  computeAccuracy,
  categoriseMistakesByPhase,
  type MoveRecord,
} from "../intelligence/critical-moments.js";
import { classifyPhase } from "../intelligence/position-classifier.js";
import { config } from "../config.js";
import type {
  AnalyzeGameInput,
  GameAnalysis,
  GameInfo,
  GameSummary,
  UCIAnalysisLine,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// PGN / URL resolution
// ---------------------------------------------------------------------------

async function resolvePgn(input: AnalyzeGameInput): Promise<string> {
  if (input.pgn) return input.pgn;

  let id: string | null = null;

  if (input.lichess_id) {
    id = input.lichess_id;
  } else if (input.game_url) {
    const lichessMatch = input.game_url.match(/lichess\.org\/([a-zA-Z0-9]{8})/);
    if (lichessMatch) {
      id = lichessMatch[1] ?? null;
    }
    // Chess.com games are in the archive, not directly accessible by ID in PGN format
    // For Chess.com URLs we'd need the archive — fall back to an error for MVP
    if (!id) {
      throw new Error(
        "Chess.com game URLs are not yet supported for direct import. " +
          "Please paste the PGN directly (Game → Share → Copy PGN)."
      );
    }
  }

  if (!id) throw new Error("No PGN source provided.");

  const response = await fetch(`https://lichess.org/game/export/${id}?evals=0&clocks=0`);
  if (!response.ok) {
    throw new Error(`Failed to fetch game from Lichess: ${response.status}`);
  }
  return await response.text();
}

// ---------------------------------------------------------------------------
// PGN header parsing
// ---------------------------------------------------------------------------

function extractHeader(pgn: string, tag: string): string {
  const match = pgn.match(new RegExp(`\\[${tag} "([^"]+)"\\]`));
  return match?.[1] ?? "Unknown";
}

// ---------------------------------------------------------------------------
// Eval helpers
// ---------------------------------------------------------------------------

async function getEvalWithAdaptiveDepth(
  fen: string,
  prevEval: number | null,
  depth: number,
  isFirstOrLast: boolean
): Promise<{ lines: UCIAnalysisLine[]; usedCloud: boolean }> {
  // Adaptive depth: use quiet depth for positions that haven't changed much
  let targetDepth = depth;
  if (!isFirstOrLast && prevEval !== null) {
    // Will be updated after we get the eval
  }

  const multiPv = 1;
  const cacheKey = positionCacheKey(fen, targetDepth, multiPv);
  const cached = getPositionEval(cacheKey);
  if (cached) return { lines: cached, usedCloud: false };

  // Try cloud eval
  const cloudLines = await getCloudEval(fen, multiPv);
  if (cloudLines && cloudLines.length > 0) {
    setPositionEval(cacheKey, cloudLines);
    return { lines: cloudLines, usedCloud: true };
  }

  // Local Stockfish with adaptive depth
  const lines = await stockfishAnalyze(fen, { depth: targetDepth, multiPv });
  if (lines.length > 0) setPositionEval(cacheKey, lines);
  return { lines, usedCloud: false };
}

function lineToEvalCp(line: UCIAnalysisLine): number {
  if (line.score_mate !== null) {
    return line.score_mate > 0 ? 10000 : -10000;
  }
  return line.score_cp ?? 0;
}

// ---------------------------------------------------------------------------
// Game summary helpers
// ---------------------------------------------------------------------------

function formatMoveRange(start: number, end: number): string {
  if (start === end) return `${start}`;
  return `${start}-${end}`;
}

function buildPhaseBreakdown(
  moves: MoveRecord[]
): GameSummary["phase_breakdown"] {
  const openingMoves = moves.filter((m) => m.moveNumber <= 12);
  const endgameMoves = moves.filter((m) => m.moveNumber >= 30);
  const middlegameMoves = moves.filter(
    (m) => m.moveNumber > 12 && m.moveNumber < 30
  );

  const lastOpeningMove = openingMoves.at(-1)?.moveNumber ?? 12;
  const firstMidgameMove = middlegameMoves[0]?.moveNumber ?? 13;
  const lastMidgameMove = middlegameMoves.at(-1)?.moveNumber ?? 29;
  const firstEndgameMove = endgameMoves[0]?.moveNumber;

  const openingEvals = openingMoves.map((m) => m.evalAfter);
  const openingSwing = openingEvals.length > 0
    ? Math.max(...openingEvals) - Math.min(...openingEvals)
    : 0;

  return {
    opening: {
      moves: formatMoveRange(1, lastOpeningMove),
      assessment:
        openingSwing < 50
          ? "Balanced opening, both sides played solidly"
          : openingSwing < 150
          ? "Some inaccuracies in the opening"
          : "Significant advantage gained in the opening phase",
    },
    middlegame: {
      moves: formatMoveRange(firstMidgameMove, lastMidgameMove),
      assessment: middlegameMoves.length === 0
        ? "No middlegame phase detected"
        : "Middlegame featured the key strategic battle",
    },
    endgame: firstEndgameMove
      ? {
          moves: `${firstEndgameMove}-${moves.at(-1)?.moveNumber ?? firstEndgameMove}`,
          assessment: "Endgame phase",
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleAnalyzeGame(
  input: AnalyzeGameInput
): Promise<GameAnalysis> {
  const pgn = await resolvePgn(input);
  const depth = input.depth ?? config.stockfish.defaultDepth;

  // Parse PGN
  const board = new Chess();
  try {
    board.loadPgn(pgn);
  } catch {
    throw new Error("Failed to parse PGN. Please ensure the PGN is valid.");
  }

  const gameInfo: GameInfo = {
    white: extractHeader(pgn, "White"),
    black: extractHeader(pgn, "Black"),
    result: extractHeader(pgn, "Result"),
    opening: extractHeader(pgn, "Opening"),
    time_control: extractHeader(pgn, "TimeControl"),
    date: extractHeader(pgn, "Date"),
    platform: input.lichess_id ?? input.game_url?.includes("lichess") ? "lichess" : "chess.com",
  };

  // Replay game collecting FENs
  const replayBoard = new Chess();
  const history = board.history({ verbose: true });
  const positions: Array<{ fen: string; san: string; moveNumber: number; color: "white" | "black" }> = [];

  positions.push({
    fen: replayBoard.fen(),
    san: "",
    moveNumber: 0,
    color: "white",
  });

  for (const move of history) {
    replayBoard.move(move.san);
    positions.push({
      fen: replayBoard.fen(),
      san: move.san,
      moveNumber: Math.ceil(positions.length / 2),
      color: move.color === "w" ? "white" : "black",
    });
  }

  // Analyse each position
  const evals: number[] = new Array(positions.length).fill(0);
  const bestMoves: string[] = new Array(positions.length).fill("");

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;
    const isEdge = i === 0 || i === positions.length - 1;
    const prevEval = i > 0 ? (evals[i - 1] ?? null) : null;

    const { lines } = await getEvalWithAdaptiveDepth(
      pos.fen,
      prevEval,
      depth,
      isEdge
    );

    if (lines.length > 0) {
      const line = lines[0]!;
      evals[i] = lineToEvalCp(line);
      bestMoves[i] = line.pv[0] ?? "";
    }
  }

  // Convert UCI best moves to SAN and build MoveRecords
  const moveRecords: MoveRecord[] = [];
  const sanBoard = new Chess();

  for (let i = 1; i < positions.length; i++) {
    const pos = positions[i]!;
    if (!pos.san) continue;

    // Convert best move UCI → SAN using the position before the move
    const prevFen = positions[i - 1]!.fen;
    const fenBoard = new Chess(prevFen);
    const bestUci = bestMoves[i - 1] ?? "";
    let bestSan = bestUci;
    if (bestUci.length >= 4) {
      try {
        const from = bestUci.slice(0, 2);
        const to = bestUci.slice(2, 4);
        const promotion = bestUci.length === 5 ? bestUci[4] : undefined;
        const r = fenBoard.move({ from, to, ...(promotion ? { promotion } : {}) });
        bestSan = r.san;
      } catch {
        bestSan = bestUci;
      }
    }

    moveRecords.push({
      moveNumber: pos.moveNumber,
      color: pos.color,
      san: pos.san,
      fenBefore: prevFen,
      fenAfter: pos.fen,
      evalBefore: evals[i - 1] ?? 0,
      evalAfter: evals[i] ?? 0,
      bestMoveSan: bestSan,
    });
  }

  // Detect critical moments
  const criticalMoments = detectCriticalMoments(moveRecords);
  const whiteAccuracy = computeAccuracy(moveRecords, "white");
  const blackAccuracy = computeAccuracy(moveRecords, "black");
  const mistakeCategories = categoriseMistakesByPhase(criticalMoments);

  // Detect patterns (simple text observations)
  const patterns: string[] = [];
  if (criticalMoments.filter((m) => m.category === "blunder" && m.color === "white").length > 1) {
    patterns.push("White made multiple blunders — likely time pressure or tactical oversight");
  }
  if (criticalMoments.filter((m) => m.category === "blunder" && m.color === "black").length > 1) {
    patterns.push("Black made multiple blunders");
  }
  if (whiteAccuracy > 85) {
    patterns.push("White played with high accuracy throughout the game");
  }
  if (blackAccuracy > 85) {
    patterns.push("Black played with high accuracy throughout the game");
  }
  if (mistakeCategories.opening > 0) {
    patterns.push(`Opening phase contained ${mistakeCategories.opening} significant inaccurac${mistakeCategories.opening === 1 ? "y" : "ies"}`);
  }

  const summary: GameSummary = {
    total_moves: history.length,
    white_accuracy: whiteAccuracy,
    black_accuracy: blackAccuracy,
    phase_breakdown: buildPhaseBreakdown(moveRecords),
    mistake_categories: mistakeCategories,
  };

  return {
    game_info: gameInfo,
    summary,
    critical_moments: criticalMoments,
    patterns_detected: patterns,
  };
}
