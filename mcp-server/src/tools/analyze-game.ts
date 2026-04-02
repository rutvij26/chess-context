import axios from "axios";
import { Chess } from "chess.js";
import { waitUntilRouterReady, getEval } from "../engines/engine-router.js";
import { fetchGameByUrl, fetchLastGame } from "../data/chesscom-api.js";
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

type ProgressCallback = (completed: number, total: number) => void;

// ---------------------------------------------------------------------------
// PGN / URL resolution
// ---------------------------------------------------------------------------

async function resolvePgn(input: AnalyzeGameInput): Promise<string> {
  // 1. Raw PGN provided directly
  if (input.pgn) return input.pgn;

  // 2. Lichess game ID
  if (input.lichess_id) {
    const { data } = await axios.get<string>(
      `https://lichess.org/game/export/${input.lichess_id}?evals=0&clocks=0`,
      { responseType: "text", headers: { Accept: "application/x-chess-pgn" } }
    );
    return data;
  }

  // 3. Game URL — detect platform and fetch accordingly
  if (input.game_url) {
    const lichessMatch = input.game_url.match(/lichess\.org\/([a-zA-Z0-9]{8})/);
    if (lichessMatch) {
      const id = lichessMatch[1] as string;
      const { data } = await axios.get<string>(
        `https://lichess.org/game/export/${id}?evals=0&clocks=0`,
        { responseType: "text", headers: { Accept: "application/x-chess-pgn" } }
      );
      return data;
    }

    if (/chess\.com\/game\/(live|daily)\/\d+/.test(input.game_url)) {
      if (!input.username) {
        throw new Error(
          "To look up a Chess.com game by URL, please also provide your Chess.com username."
        );
      }
      return fetchGameByUrl(input.game_url, input.username);
    }

    throw new Error(
      `Unrecognised game URL: "${input.game_url}". ` +
        "Supported formats: https://www.chess.com/game/live/... or https://lichess.org/..."
    );
  }

  // 4. Username only — fetch last game from chess.com
  if (input.username) {
    return fetchLastGame(input.username);
  }

  // 5. Nothing provided
  throw new Error(
    "Please provide your Chess.com username so I can fetch your last game, " +
      "or supply a game URL, Lichess game ID, or PGN directly."
  );
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
  input: AnalyzeGameInput,
  onProgress?: ProgressCallback,
): Promise<GameAnalysis> {
  const { analysis } = await Promise.race([
    runAnalysis(input, onProgress),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Game analysis timed out after 50s. Try a shorter game or paste the PGN directly.")),
        ANALYSIS_TIMEOUT_MS
      )
    ),
  ]);
  return analysis;
}

async function runAnalysis(
  input: AnalyzeGameInput,
  onProgress?: ProgressCallback,
): Promise<{ analysis: GameAnalysis; moveRecords: MoveRecord[] }> {
  try {
    await waitUntilRouterReady(config.stockfish.readinessTimeout);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Engine is not ready.";
    throw new Error(`Cannot analyze game: ${msg}`);
  }

  const pgn = await resolvePgn(input);

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
    platform:
      input.lichess_id !== undefined ||
      (input.game_url !== undefined && input.game_url.includes("lichess"))
        ? "lichess"
        : "chess.com",
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

  // Evaluate all positions concurrently via the engine router.
  // Docker Stockfish handles many positions in parallel (HTTP queue); WASM pool
  // is used as fallback. Cache hits are served instantly.
  //
  // Two-pass adaptive depth:
  //   Pass 1: all positions at quietDepth (fast).
  //   Pass 2: re-evaluate positions whose eval swings > quietThreshold at
  //           criticalDepth for higher accuracy.
  const { quietDepth, criticalDepth } = config.stockfish;
  const total = positions.length;

  // Emit 0/N before the loop so the client knows the total upfront.
  onProgress?.(0, total);

  let completed = 0;
  const allLines = await Promise.all(
    positions.map((pos) =>
      getEval(pos.fen, quietDepth, 1)
        .catch((): UCIAnalysisLine[] => [])
        .then((lines) => {
          completed += 1;
          if (completed % 10 === 0 || completed === total) {
            onProgress?.(completed, total);
          }
          return lines;
        }),
    ),
  );

  // Identify critical positions: those where the eval delta between adjacent
  // positions exceeds the quiet threshold, then re-evaluate at critical depth.
  const quietThreshold = config.analysis.quietThreshold;
  const criticalIndices: number[] = [];
  for (let i = 1; i < allLines.length; i++) {
    const prevEval = allLines[i - 1]?.[0];
    const curEval = allLines[i]?.[0];
    if (!prevEval || !curEval) continue;
    const prevCp = prevEval.score_mate !== null
      ? (prevEval.score_mate > 0 ? 10000 : -10000)
      : (prevEval.score_cp ?? 0);
    const curCp = curEval.score_mate !== null
      ? (curEval.score_mate > 0 ? 10000 : -10000)
      : (curEval.score_cp ?? 0);
    if (Math.abs(curCp - prevCp) > quietThreshold) {
      criticalIndices.push(i - 1);
      criticalIndices.push(i);
    }
  }
  const uniqueCriticalIndices = [...new Set(criticalIndices)];

  if (uniqueCriticalIndices.length > 0) {
    await Promise.all(
      uniqueCriticalIndices.map(async (idx) => {
        const pos = positions[idx];
        if (!pos) return;
        const lines = await getEval(pos.fen, criticalDepth, 1).catch((): UCIAnalysisLine[] => []);
        if (lines.length > 0) {
          allLines[idx] = lines;
        }
      }),
    );
  }

  const evals: number[] = allLines.map((lines) => {
    const line = lines[0];
    return line ? lineToEvalCp(line) : 0;
  });
  const bestMoves: string[] = allLines.map((lines) => lines[0]?.pv[0] ?? "");
  const evalsCovered = allLines.filter((lines) => lines.length > 0).length;

  const evalCoverage = positions.length > 0
    ? Math.round((evalsCovered / positions.length) * 100)
    : 0;
  const lowCoverage = evalCoverage < 30;

  // Convert UCI best moves to SAN and build MoveRecords
  const moveRecords: MoveRecord[] = [];

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
    analysis: {
      game_info: gameInfo,
      summary,
      critical_moments: criticalMoments,
      patterns_detected: patterns,
    },
    moveRecords,
  };
}

// ---------------------------------------------------------------------------
// Public: full result including MoveRecord[] (used by the analysis pipeline)
// ---------------------------------------------------------------------------

export async function analyzeGameFull(
  pgn: string
): Promise<{ analysis: GameAnalysis; moveRecords: MoveRecord[] }> {
  return Promise.race([
    runAnalysis({ pgn }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Game analysis timed out after 50s.")),
        ANALYSIS_TIMEOUT_MS
      )
    ),
  ]);
}
