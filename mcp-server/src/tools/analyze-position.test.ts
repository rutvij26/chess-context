import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UCIAnalysisLine } from "../types/index.js";

// ---------------------------------------------------------------------------
// Mock the engine router — eval routing logic lives there now
// ---------------------------------------------------------------------------

vi.mock("../engines/engine-router.js", () => ({
  getEval: vi.fn(),
  waitUntilRouterReady: vi.fn().mockResolvedValue(undefined),
  initRouter: vi.fn(),
  shutdownRouter: vi.fn(),
}));

import { handleAnalyzePosition } from "./analyze-position.js";
import { getEval } from "../engines/engine-router.js";

const getEvalMock = vi.mocked(getEval);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeLines(pv = "e2e4", cp = 30, depth = 18): UCIAnalysisLine[] {
  return [
    { depth, score_cp: cp, score_mate: null, pv: [pv, "e7e5", "g1f3"], multipv_rank: 1 },
  ];
}

beforeEach(() => {
  getEvalMock.mockReset();
  getEvalMock.mockResolvedValue(makeLines());
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("handleAnalyzePosition — input validation", () => {
  it("throws on an invalid FEN string", async () => {
    await expect(
      handleAnalyzePosition({ fen: "not-a-fen" })
    ).rejects.toThrow(/Invalid FEN/i);
  });

  it("does not throw for a valid FEN", async () => {
    await expect(
      handleAnalyzePosition({ fen: STARTING_FEN })
    ).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

describe("handleAnalyzePosition — output shape", () => {
  it("returns the expected top-level keys", async () => {
    const result = await handleAnalyzePosition({ fen: STARTING_FEN });
    expect(result).toHaveProperty("evaluation");
    expect(result).toHaveProperty("best_moves");
    expect(result).toHaveProperty("position_context");
  });

  it("evaluation has score_cp, score_mate, score_text, depth", async () => {
    const result = await handleAnalyzePosition({ fen: STARTING_FEN });
    expect(result.evaluation).toHaveProperty("score_cp");
    expect(result.evaluation).toHaveProperty("score_mate");
    expect(result.evaluation).toHaveProperty("score_text");
    expect(result.evaluation).toHaveProperty("depth");
  });

  it("best_moves is a non-empty array", async () => {
    const result = await handleAnalyzePosition({ fen: STARTING_FEN });
    expect(Array.isArray(result.best_moves)).toBe(true);
    expect(result.best_moves.length).toBeGreaterThan(0);
  });

  it("each top move has move_uci, move_san, eval_cp, eval_mate, continuation, explanation", async () => {
    const result = await handleAnalyzePosition({ fen: STARTING_FEN });
    const move = result.best_moves[0]!;
    expect(move).toHaveProperty("move_uci");
    expect(move).toHaveProperty("move_san");
    expect(move).toHaveProperty("eval_cp");
    expect(move).toHaveProperty("eval_mate");
    expect(move).toHaveProperty("continuation");
    expect(move).toHaveProperty("explanation");
  });

  it("position_context has phase, move_number, pawn_structures, themes, narrative", async () => {
    const result = await handleAnalyzePosition({ fen: STARTING_FEN });
    const ctx = result.position_context;
    expect(ctx).toHaveProperty("phase");
    expect(ctx).toHaveProperty("move_number");
    expect(ctx).toHaveProperty("pawn_structures");
    expect(ctx).toHaveProperty("themes");
    expect(ctx).toHaveProperty("narrative");
  });

  it("narrative is a non-empty string", async () => {
    const result = await handleAnalyzePosition({ fen: STARTING_FEN });
    expect(typeof result.position_context.narrative).toBe("string");
    expect(result.position_context.narrative.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Eval routing (via engine-router)
// ---------------------------------------------------------------------------

describe("handleAnalyzePosition — eval routing", () => {
  it("calls getEval with the provided FEN", async () => {
    await handleAnalyzePosition({ fen: STARTING_FEN });
    expect(getEvalMock).toHaveBeenCalledWith(
      STARTING_FEN,
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("calls getEval with custom depth when provided", async () => {
    await handleAnalyzePosition({ fen: STARTING_FEN, depth: 12 });
    expect(getEvalMock).toHaveBeenCalledWith(STARTING_FEN, 12, expect.any(Number));
  });

  it("throws when engine returns no lines", async () => {
    getEvalMock.mockResolvedValueOnce([]);
    await expect(handleAnalyzePosition({ fen: STARTING_FEN })).rejects.toThrow(/no analysis lines/i);
  });
});

// ---------------------------------------------------------------------------
// Score text mapping
// ---------------------------------------------------------------------------

describe("handleAnalyzePosition — score text", () => {
  it("returns 'White is winning' for score ≥300", async () => {
    getEvalMock.mockResolvedValueOnce(makeLines("e2e4", 350));
    const result = await handleAnalyzePosition({ fen: STARTING_FEN });
    expect(result.evaluation.score_text).toBe("White is winning");
  });

  it("returns 'Mate in N' when score_mate is positive", async () => {
    const fen = "7k/5P2/5K2/8/8/8/8/8 w - - 0 1";
    getEvalMock.mockResolvedValueOnce([
      { depth: 20, score_cp: null, score_mate: 2, pv: ["f7f8"], multipv_rank: 1 },
    ]);
    const result = await handleAnalyzePosition({ fen });
    expect(result.evaluation.score_text).toContain("Mate in 2");
  });

  it("returns 'Equal position' for score between -24 and +24", async () => {
    getEvalMock.mockResolvedValueOnce(makeLines("e2e4", 10));
    const result = await handleAnalyzePosition({ fen: STARTING_FEN });
    expect(result.evaluation.score_text).toBe("Equal position");
  });
});

// ---------------------------------------------------------------------------
// Phase classification
// ---------------------------------------------------------------------------

describe("handleAnalyzePosition — position classification", () => {
  it("classifies the starting position as opening", async () => {
    const result = await handleAnalyzePosition({ fen: STARTING_FEN });
    expect(result.position_context.phase).toBe("opening");
  });

  it("classifies a king+rook vs king position as endgame", async () => {
    const fen = "8/8/4k3/8/8/4K3/8/4R3 w - - 0 1";
    getEvalMock.mockResolvedValueOnce(makeLines("e1e7", 500));
    const result = await handleAnalyzePosition({ fen });
    expect(result.position_context.phase).toBe("endgame");
  });
});
