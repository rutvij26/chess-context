import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import type { UCIAnalysisLine } from "../types/index.js";

// ---------------------------------------------------------------------------
// Mock chess.com API (fetchGameByUrl, fetchLastGame)
// ---------------------------------------------------------------------------

vi.mock("../data/chesscom-api.js", () => ({
  fetchGameByUrl: vi.fn(),
  fetchLastGame: vi.fn(),
  getRecentGames: vi.fn(),
  getProfile: vi.fn(),
  getStats: vi.fn(),
  buildPlayerStats: vi.fn(),
  PlayerNotFoundError: class PlayerNotFoundError extends Error {},
}));

// ---------------------------------------------------------------------------
// Mock engine router — eval routing logic lives there now
// ---------------------------------------------------------------------------

vi.mock("../engines/engine-router.js", () => ({
  getEval: vi.fn(),
  waitUntilRouterReady: vi.fn().mockResolvedValue(undefined),
  initRouter: vi.fn(),
  shutdownRouter: vi.fn(),
}));

import { handleAnalyzeGame } from "./analyze-game.js";
import { getEval } from "../engines/engine-router.js";
import { fetchGameByUrl, fetchLastGame } from "../data/chesscom-api.js";

const getEvalMock = vi.mocked(getEval);
const fetchGameByUrlMock = vi.mocked(fetchGameByUrl);
const fetchLastGameMock = vi.mocked(fetchLastGame);

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
  getEvalMock.mockReset();
  fetchGameByUrlMock.mockReset();
  fetchLastGameMock.mockReset();
  // Default: engine returns equal eval for all positions
  getEvalMock.mockResolvedValue([makeEvalLine(20)]);
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
    getEvalMock.mockImplementation(async () => {
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
    getEvalMock.mockResolvedValue([makeEvalLine(20)]);

    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(result.critical_moments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// URL-based input and routing
// ---------------------------------------------------------------------------

describe("handleAnalyzeGame — URL resolution", () => {
  it("fetches a Chess.com live game via fetchGameByUrl when username is provided", async () => {
    fetchGameByUrlMock.mockResolvedValue(SHORT_PGN);

    const result = await handleAnalyzeGame({
      game_url: "https://www.chess.com/game/live/169033837793",
      username: "notsobrillantmove",
    });

    expect(fetchGameByUrlMock).toHaveBeenCalledWith(
      "https://www.chess.com/game/live/169033837793",
      "notsobrillantmove"
    );
    expect(result.game_info.platform).toBe("chess.com");
    expect(result).toHaveProperty("game_info");
  });

  it("fetches a Chess.com daily game via fetchGameByUrl when username is provided", async () => {
    fetchGameByUrlMock.mockResolvedValue(SHORT_PGN);

    await handleAnalyzeGame({
      game_url: "https://www.chess.com/game/daily/987654321",
      username: "notsobrillantmove",
    });

    expect(fetchGameByUrlMock).toHaveBeenCalledWith(
      "https://www.chess.com/game/daily/987654321",
      "notsobrillantmove"
    );
  });

  it("throws when chess.com URL is given without a username", async () => {
    await expect(
      handleAnalyzeGame({ game_url: "https://www.chess.com/game/live/169033837793" })
    ).rejects.toThrow(/username/i);
  });

  it("fetches a Lichess game by URL via axios", async () => {
    const axiosSpy = vi
      .spyOn(axios, "get")
      .mockResolvedValueOnce({ data: SHORT_PGN });

    const result = await handleAnalyzeGame({
      game_url: "https://lichess.org/abcd1234",
    });

    expect(axiosSpy).toHaveBeenCalledWith(
      expect.stringContaining("lichess.org/game/export/abcd1234"),
      expect.anything()
    );
    expect(result.game_info.platform).toBe("lichess");
    axiosSpy.mockRestore();
  });

  it("fetches a Lichess game by lichess_id via axios", async () => {
    const axiosSpy = vi
      .spyOn(axios, "get")
      .mockResolvedValueOnce({ data: SHORT_PGN });

    const result = await handleAnalyzeGame({ lichess_id: "abcd1234" });

    expect(axiosSpy).toHaveBeenCalledWith(
      expect.stringContaining("lichess.org/game/export/abcd1234"),
      expect.anything()
    );
    expect(result.game_info.platform).toBe("lichess");
    axiosSpy.mockRestore();
  });

  it("fetches last game when only username is provided", async () => {
    fetchLastGameMock.mockResolvedValue(SHORT_PGN);

    const result = await handleAnalyzeGame({ username: "notsobrillantmove" });

    expect(fetchLastGameMock).toHaveBeenCalledWith("notsobrillantmove");
    expect(result).toHaveProperty("game_info");
  });

  it("throws a clear error when no input is provided at all", async () => {
    await expect(handleAnalyzeGame({})).rejects.toThrow(/username/i);
  });

  it("throws for an unrecognised game URL", async () => {
    await expect(
      handleAnalyzeGame({ game_url: "https://unknown-site.com/game/123" })
    ).rejects.toThrow(/Unrecognised game URL/i);
  });
});

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

describe("handleAnalyzeGame — accuracy", () => {
  it("reports 100% accuracy when all moves are within 30cp of best", async () => {
    // Constant eval of +20 → all moves are "accurate" (drop=0 < 30)
    getEvalMock.mockResolvedValue([makeEvalLine(20)]);

    const result = await handleAnalyzeGame({ pgn: SHORT_PGN });
    expect(result.summary.white_accuracy).toBe(100);
    expect(result.summary.black_accuracy).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Progress callback
// ---------------------------------------------------------------------------

describe("handleAnalyzeGame — progress callback", () => {
  it("resolves normally when onProgress is not provided", async () => {
    await expect(handleAnalyzeGame({ pgn: SHORT_PGN })).resolves.toBeTruthy();
  });

  it("first call is 0/N (initial notification before any evals)", async () => {
    const calls: Array<[number, number]> = [];
    await handleAnalyzeGame({ pgn: SHORT_PGN }, (c, t) => calls.push([c, t]));
    expect(calls[0]).toEqual([0, expect.any(Number)]);
  });

  it("last call has completed === total", async () => {
    const calls: Array<[number, number]> = [];
    await handleAnalyzeGame({ pgn: SHORT_PGN }, (c, t) => calls.push([c, t]));
    const last = calls.at(-1)!;
    expect(last[0]).toBe(last[1]);
  });

  it("total reported is consistent across all calls", async () => {
    const calls: Array<[number, number]> = [];
    await handleAnalyzeGame({ pgn: SHORT_PGN }, (c, t) => calls.push([c, t]));
    const totals = calls.map(([, t]) => t);
    expect(new Set(totals).size).toBe(1);
  });

  it("does not exceed ceil(N/10) + 2 progress events for a short game", async () => {
    // SHORT_PGN has 9 positions (initial + 8 half-moves).
    // Expected: 1 initial (0/9) + 1 at completion (9/9) = 2 events.
    const calls: Array<[number, number]> = [];
    await handleAnalyzeGame({ pgn: SHORT_PGN }, (c, t) => calls.push([c, t]));
    const total = calls[0]![1];
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(total / 10) + 2);
  });
});
