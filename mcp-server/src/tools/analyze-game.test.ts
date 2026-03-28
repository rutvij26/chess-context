import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import type { UCIAnalysisLine } from "../types/index.js";

// ---------------------------------------------------------------------------
// Mock all I/O dependencies
// ---------------------------------------------------------------------------

vi.mock("../engines/stockfish.js", () => ({
  analyzePosition: vi.fn(),
  isReady: vi.fn().mockReturnValue(true),
}));

vi.mock("../engines/lichess-eval.js", () => ({
  getCloudEval: vi.fn(),
}));

// Mock cache to prevent cross-test contamination
vi.mock("../cache/index.js", () => ({
  getPositionEval: vi.fn().mockReturnValue(undefined),
  setPositionEval: vi.fn(),
  positionCacheKey: vi.fn((fen: string, depth: number, multiPv: number) => `${fen}:${depth}:${multiPv}`),
  getPlayerStats: vi.fn(),
  setPlayerStats: vi.fn(),
  playerCacheKey: vi.fn(),
}));

import { handleAnalyzeGame } from "./analyze-game.js";
import { analyzePosition as stockfishAnalyze } from "../engines/stockfish.js";
import { getCloudEval } from "../engines/lichess-eval.js";

const stockfishMock = vi.mocked(stockfishAnalyze);
const cloudMock = vi.mocked(getCloudEval);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A short but real PGN — 8 moves, king-pawn opening
const SHORT_PGN = `[Event "Test"]
[Site "?"]
[Date "2024.01.01"]
[White "Player1"]
[Black "Player2"]
[Result "1-0"]
[Opening "King's Pawn Game"]
[TimeControl "600"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0`;

function makeEvalLine(cp: number): UCIAnalysisLine {
  return {
    depth: 18,
    score_cp: cp,
    score_mate: null,
    pv: ["e2e4"],
    multipv_rank: 1,
  };
}

beforeEach(() => {
  stockfishMock.mockReset();
  cloudMock.mockReset();
  // Default: cloud miss, Stockfish returns equal eval
  cloudMock.mockResolvedValue(null);
  stockfishMock.mockResolvedValue([makeEvalLine(20)]);
});

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

describe("handleAnalyzeGame — PGN input", () => {
  it("parses a valid PGN without throwing", async () => {
    await expect(handleAnalyzeGame({ pgn: SHORT_PGN })).resolves.toBeTruthy();
  });

  it("throws on invalid PGN", async () => {
    await expect(
      handleAnalyzeGame({ pgn: "not pgn at all !!!" })
    ).rejects.toThrow(/Failed to parse PGN/i);
  });
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

describe("handleAnalyzeGame — output shape", () => {
  it("returns game_info, summary, critical_moments, patterns_detected", async () => {
    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(result).toHaveProperty("game_info");
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("critical_moments");
    expect(result).toHaveProperty("patterns_detected");
  });

  it("game_info includes white, black, result, opening", async () => {
    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(result.game_info.white).toBe("Player1");
    expect(result.game_info.black).toBe("Player2");
    expect(result.game_info.result).toBe("1-0");
    expect(result.game_info.opening).toBe("King's Pawn Game");
  });

  it("summary.total_moves equals the number of half-moves", async () => {
    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    // SHORT_PGN has 4 full moves = 8 half-moves
    expect(result.summary.total_moves).toBe(8);
  });

  it("summary.white_accuracy is between 0 and 100", async () => {
    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(result.summary.white_accuracy).toBeGreaterThanOrEqual(0);
    expect(result.summary.white_accuracy).toBeLessThanOrEqual(100);
  });

  it("summary.black_accuracy is between 0 and 100", async () => {
    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(result.summary.black_accuracy).toBeGreaterThanOrEqual(0);
    expect(result.summary.black_accuracy).toBeLessThanOrEqual(100);
  });

  it("critical_moments is an array", async () => {
    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(Array.isArray(result.critical_moments)).toBe(true);
  });

  it("patterns_detected is an array", async () => {
    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(Array.isArray(result.patterns_detected)).toBe(true);
  });

  it("phase_breakdown has opening, middlegame, and optional endgame", async () => {
    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(result.summary.phase_breakdown).toHaveProperty("opening");
    expect(result.summary.phase_breakdown).toHaveProperty("middlegame");
    expect(result.summary.phase_breakdown).toHaveProperty("endgame");
  });
});

// ---------------------------------------------------------------------------
// Critical moments detection in a game
// ---------------------------------------------------------------------------

describe("handleAnalyzeGame — critical moments", () => {
  it("detects a blunder when a move causes a 200cp+ drop", async () => {
    // Positions 0-3: eval=20 (equal). Position 4 (after move 4 by white): eval=-250.
    // This means white's 2nd move (move 3 in 0-indexed half-moves, move 2 full-moves)
    // caused a 270cp drop (20 → -250 from white's perspective).
    let callCount = 0;
    cloudMock.mockImplementation(async () => {
      callCount++;
      // Position 4 (0-indexed): eval swings to -250cp for white
      if (callCount === 4) {
        return [{ depth: 18, score_cp: -250, score_mate: null, pv: ["e2e4"], multipv_rank: 1 }];
      }
      return [makeEvalLine(20)];
    });

    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    const blunders = result.critical_moments.filter((m) => m.category === "blunder");
    expect(blunders.length).toBeGreaterThanOrEqual(1);
  });

  it("returns no critical moments when all moves are accurate", async () => {
    // Constant eval = no drops → no critical moments
    cloudMock.mockResolvedValue([makeEvalLine(20)]);

    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(result.critical_moments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// URL-based input
// ---------------------------------------------------------------------------

describe("handleAnalyzeGame — URL resolution", () => {
  it("throws for a Chess.com URL (not yet supported)", async () => {
    await expect(
      handleAnalyzeGame({ game_url: "https://www.chess.com/game/live/12345" })
    ).rejects.toThrow(/Chess.com/i);
  });

  it("attempts to fetch a Lichess game by ID from a URL", async () => {
    const axiosSpy = vi.spyOn(axios, "get").mockRejectedValueOnce(
      Object.assign(new Error("404"), { response: { status: 404 } })
    );

    await expect(
      handleAnalyzeGame({ game_url: "https://lichess.org/abcd1234" })
    ).rejects.toThrow();

    // Verify it called axios with the Lichess export endpoint
    expect(axiosSpy).toHaveBeenCalledWith(
      expect.stringContaining("lichess.org/game/export/abcd1234"),
      expect.anything()
    );
    axiosSpy.mockRestore();
  });

  it("throws when no PGN source is provided", async () => {
    // @ts-expect-error intentional missing input
    await expect(handleAnalyzeGame({})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

describe("handleAnalyzeGame — accuracy", () => {
  it("reports 100% accuracy when all moves are within 30cp of best", async () => {
    // Constant eval of +20 → all moves are "accurate" (drop=0 < 30)
    cloudMock.mockResolvedValue([makeEvalLine(20)]);

    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(result.summary.white_accuracy).toBe(100);
    expect(result.summary.black_accuracy).toBe(100);
  });
});
