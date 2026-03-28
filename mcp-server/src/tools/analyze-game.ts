import axios from "axios";
import { Chess } from "chess.js";
import { analyzePosition as stockfishAnalyze, isReady as stockfishReady, waitUntilReady } from "../engines/stockfish.js";
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

  const { data } = await axios.get<string>(
    `https://lichess.org/game/export/${id}?evals=0&clocks=0`,
    { responseType: "text" }
  );
  return data;
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

const ANALYSIS_TIMEOUT_MS = 50_000;

export async function handleAnalyzeGame(
  input: AnalyzeGameInput
): Promise<GameAnalysis> {
  return Promise.race([
    runAnalysis(input),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Game analysis timed out after 50s. Try a shorter game or paste the PGN directly.")),
        ANALYSIS_TIMEOUT_MS
      )
    ),
  ]);
}

async function runAnalysis(input: AnalyzeGameInput): Promise<GameAnalysis> {
  try {
    await waitUntilReady(config.stockfish.readinessTimeout);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Stockfish engine is not ready.";
    throw new Error(
      `Cannot analyze game: ${msg} ` +
        "The engine needs 30–90 seconds to initialize after server startup."
    );
  }

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
  // Phase 1: cloud-eval with bounded concurrency to avoid Lichess rate-limits
  const CLOUD_CONCURRENCY = 4;
  const cloudResults: (UCIAnalysisLine[] | null)[] = new Array(positions.length).fill(null);

  for (let i = 0; i < positions.length; i += CLOUD_CONCURRENCY) {
    const batch = positions.slice(i, i + CLOUD_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (pos) => {
        const cacheKey = positionCacheKey(pos.fen, depth, 1);
        const cached = getPositionEval(cacheKey);
        if (cached) return cached;
        const lines = await getCloudEval(pos.fen, 1).catch(() => null);
        if (lines && lines.length > 0) setPositionEval(cacheKey, lines);
        return lines;
      })
    );
    batchResults.forEach((r, j) => { cloudResults[i + j] = r; });
  }

  // Phase 2: sequential Stockfish only for cloud-eval misses, at quiet depth
  const quietDepth = config.stockfish.quietDepth;
  const evals: number[] = new Array(positions.length).fill(0);
  const bestMoves: string[] = new Array(positions.length).fill("");
  let evalsCovered = 0;

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;
    let lines = cloudResults[i];

    if (!lines || lines.length === 0) {
      if (stockfishReady()) {
        lines = await stockfishAnalyze(pos.fen, { depth: quietDepth, multiPv: 1 }).catch(() => []);
      }
    }

    if (lines && lines.length > 0) {
      const line = lines[0]!;
      evals[i] = lineToEvalCp(line);
      bestMoves[i] = line.pv[0] ?? "";
      evalsCovered++;
    }
  }

  const evalCoverage = positions.length > 0
    ? Math.round((evalsCovered / positions.length) * 100)
    : 0;
  const lowCoverage = evalCoverage < 30;

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
  if (!lowCoverage && whiteAccuracy > 85) {
    patterns.push("White played with high accuracy throughout the game");
  }
  if (!lowCoverage && blackAccuracy > 85) {
    patterns.push("Black played with high accuracy throughout the game");
  }
  if (mistakeCategories.opening > 0) {
    patterns.push(`Opening phase contained ${mistakeCategories.opening} significant inaccurac${mistakeCategories.opening === 1 ? "y" : "ies"}`);
  }

  if (lowCoverage) {
    patterns.push(
      `⚠️ Low eval coverage (${evalCoverage}% of positions evaluated) — these positions are not in the Lichess cloud database and Stockfish is still warming up. Accuracy figures and critical moments may be incomplete. Try again in a minute for full analysis.`
    );
  }

  const summary: GameSummary = {
    total_moves: history.length,
    white_accuracy: lowCoverage ? 0 : whiteAccuracy,
    black_accuracy: lowCoverage ? 0 : blackAccuracy,
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
