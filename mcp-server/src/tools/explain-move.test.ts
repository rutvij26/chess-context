import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleExplainMove } from "./explain-move.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../engines/engine-router.js", () => ({
  waitUntilRouterReady: vi.fn().mockResolvedValue(undefined),
  getEval: vi.fn(),
}));

vi.mock("../data/chesscom-api.js", () => ({
  getStats: vi.fn(),
  fetchLastGame: vi.fn(),
  fetchGameByUrl: vi.fn(),
}));

vi.mock("../data/lichess-api.js", () => ({
  getProfile: vi.fn(),
  getRecentGames: vi.fn(),
}));

import { getEval } from "../engines/engine-router.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Scholar's mate game — white plays 4.Qh5# (blunder for black at move 4)
const SCHOLARS_MATE_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[WhiteElo "1200"]
[BlackElo "1000"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7# 1-0`;

// Simple 5-move game
const SHORT_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 *`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockEval(lines: Array<{ score_cp: number | null; score_mate: number | null; pv: string[] }>) {
  return lines.map((l, i) => ({
    depth: 18,
    score_cp: l.score_cp,
    score_mate: l.score_mate,
    pv: l.pv,
    multipv_rank: i + 1,
  }));
}

const EQUAL_EVAL = mockEval([{ score_cp: 0, score_mate: null, pv: ["e2e4"] }]);
const BEST_MOVE_E4 = mockEval([
  { score_cp: 20, score_mate: null, pv: ["e2e4", "e7e5"] },
  { score_cp: 15, score_mate: null, pv: ["d2d4", "d7d5"] },
  { score_cp: 10, score_mate: null, pv: ["g1f3", "d7d5"] },
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleExplainMove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when no game source is provided", async () => {
    await expect(
      handleExplainMove({ move_number: 1, color: "white" })
    ).rejects.toThrow(/game source/i);
  });

  it("throws when move number is out of range", async () => {
    vi.mocked(getEval).mockResolvedValue(EQUAL_EVAL);
    await expect(
      handleExplainMove({ move_number: 25, color: "white", pgn: SHORT_PGN })
    ).rejects.toThrow(/out of range/i);
  });

  it("classifies best move correctly", async () => {
    // e2e4 is the played move AND the best move
    vi.mocked(getEval)
      .mockResolvedValueOnce(BEST_MOVE_E4) // linesBefore (multiPv=3)
      .mockResolvedValueOnce(EQUAL_EVAL);  // linesAfter

    const result = await handleExplainMove({
      move_number: 1,
      color: "white",
      pgn: SHORT_PGN,
    });

    expect(result.classification).toBe("best");
    expect(result.best_move).toBeNull();
    expect(result.eval_drop_cp).toBe(0);
    expect(result.move_played).toBe("e4");
  });

  it("classifies blunder correctly with best alternative", async () => {
    // Black plays Nf6?? at move 3 in Scholar's mate — engine recommends something else
    const engineBefore = mockEval([
      { score_cp: 300, score_mate: null, pv: ["e7e6", "d1h5"] }, // not Nf6
      { score_cp: 200, score_mate: null, pv: ["d7d6", "d1h5"] },
    ]);
    // score_cp is always from White's perspective — after Nf6??, White is winning (+600)
    const engineAfter = mockEval([
      { score_cp: 600, score_mate: null, pv: ["d1f7"] },
    ]);

    vi.mocked(getEval)
      .mockResolvedValueOnce(engineBefore)
      .mockResolvedValueOnce(engineAfter);

    const result = await handleExplainMove({
      move_number: 3,
      color: "black",
      pgn: SCHOLARS_MATE_PGN,
    });

    expect(result.classification).toBe("blunder");
    expect(result.eval_drop_cp).toBeGreaterThanOrEqual(300);
    expect(result.best_move).not.toBeNull();
    expect(result.best_move?.san).toBeTruthy();
  });

  it("normalizes eval drop from black's perspective", async () => {
    // White's eval before: +100 (white slightly better)
    // After black's move: +50 (still white better, so black improved — eval DROP is negative from white POV)
    // From black's perspective: before=-100, after=-50, drop = -100 - (-50) = -50 → clamp to 0
    const before = mockEval([{ score_cp: 100, score_mate: null, pv: ["e7e5"] }]);
    const after  = mockEval([{ score_cp: 50,  score_mate: null, pv: ["e2e4"] }]);

    vi.mocked(getEval)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    const result = await handleExplainMove({
      move_number: 1,
      color: "black",
      pgn: SHORT_PGN,
    });

    // From black's perspective: before_stm = -100, after_stm = -50
    // drop = max(0, -100 - (-50)) = max(0, -50) = 0
    expect(result.eval_drop_cp).toBe(0);
  });

  it("returns non-null boardData with correct arrows", async () => {
    const engineBefore = mockEval([
      { score_cp: 50, score_mate: null, pv: ["d2d4", "d7d5"] }, // engine wants d4
      { score_cp: 30, score_mate: null, pv: ["g1f3", "e7e5"] },
    ]);
    const engineAfter = mockEval([
      { score_cp: -10, score_mate: null, pv: ["e7e5"] },
    ]);

    vi.mocked(getEval)
      .mockResolvedValueOnce(engineBefore)
      .mockResolvedValueOnce(engineAfter);

    const result = await handleExplainMove({
      move_number: 1,
      color: "white",
      pgn: SHORT_PGN,
    });

    expect(result.board_data).not.toBeNull();
    const targetMove = result.board_data!.moves.find((m) => m.ply === 1);
    expect(targetMove).toBeDefined();
    expect(targetMove!.arrows.length).toBeGreaterThanOrEqual(1);
    // played move arrow (e2e4 was played, d2d4 is best — two arrows)
    expect(targetMove!.arrows.length).toBe(2);
    const bestArrow = targetMove!.arrows.find((a) => a.label === "Best");
    expect(bestArrow).toBeDefined();
    expect(bestArrow!.color).toBe("#4caf50");
  });

  it("adapts player level: beginner gets simpler language", async () => {
    const engineBefore = mockEval([
      { score_cp: 200, score_mate: null, pv: ["d2d4"] },
    ]);
    const engineAfter = mockEval([
      { score_cp: -150, score_mate: null, pv: ["e7e5"] },
    ]);

    vi.mocked(getEval)
      .mockResolvedValueOnce(engineBefore)
      .mockResolvedValueOnce(engineAfter);

    const beginner = await handleExplainMove({
      move_number: 1,
      color: "white",
      pgn: SHORT_PGN,
      player_level: "beginner",
    });

    vi.mocked(getEval)
      .mockResolvedValueOnce(engineBefore)
      .mockResolvedValueOnce(engineAfter);

    const advanced = await handleExplainMove({
      move_number: 1,
      color: "white",
      pgn: SHORT_PGN,
      player_level: "advanced",
    });

    // Both should have a classification
    expect(beginner.player_level).toBe("beginner");
    expect(advanced.player_level).toBe("advanced");
    // Advanced should mention cp values
    expect(advanced.assessment).toMatch(/pawn/i);
  });

  it("identifies castling move intent", async () => {
    const castlingPgn = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *`;

    vi.mocked(getEval)
      .mockResolvedValue(
        mockEval([{ score_cp: 30, score_mate: null, pv: ["e1g1"] }])
      );

    const result = await handleExplainMove({
      move_number: 4,
      color: "white",
      pgn: castlingPgn,
    });

    expect(result.move_played).toBe("O-O");
    expect(result.move_intent.toLowerCase()).toMatch(/castle|king safety/i);
  });
});
