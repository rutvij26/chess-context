import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock engine-router so tests don't need a real Stockfish instance
// ---------------------------------------------------------------------------

vi.mock("../engines/engine-router.js", () => ({
  getEval: vi.fn().mockResolvedValue([
    {
      depth: 16,
      score_cp: 300,
      score_mate: null,
      pv: ["e2e4", "e7e5", "g1f3"],
      multipv_rank: 1,
    },
  ]),
}));

import { extractPuzzles, type GameMeta } from "./puzzle-classifier.js";
import type { GameAnalysisRow } from "../store/analysis-store.js";
import type { MoveRecord } from "./critical-moments.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeAnalysis(
  overrides: Partial<GameAnalysisRow> = {}
): GameAnalysisRow {
  const moveRecords: MoveRecord[] = [
    {
      moveNumber: 10,
      color: "white",
      san: "Bg5",
      fenBefore: STARTING_FEN,
      fenAfter: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      evalBefore: 50,
      evalAfter: -200,
      bestMoveSan: "Nf3",
    },
  ];

  return {
    id: 1,
    player_game_id: 1,
    schema_version: "0.6",
    move_records: moveRecords,
    white_accuracy: 75,
    black_accuracy: 80,
    critical_moments: [
      {
        move_number: 10,
        color: "white",
        move_played: "Bg5",
        best_move: "Nf3",
        eval_before_cp: 50,
        eval_after_cp: -200,
        eval_drop_cp: 250,
        category: "blunder",
        explanation: "Bg5 is a blunder, losing 2.5 pawns.",
      },
    ],
    phase_breakdown: null,
    patterns_detected: null,
    analyzed_at: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractPuzzles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no analyses provided", async () => {
    const puzzles = await extractPuzzles([], [], "all", 10);
    expect(puzzles).toEqual([]);
  });

  it("extracts a puzzle from a blunder", async () => {
    const analyses = [makeAnalysis()];
    const metas: GameMeta[] = [{ game_id: "game123", player_color: "white" }];

    const puzzles = await extractPuzzles(analyses, metas, "all", 10);

    expect(puzzles.length).toBeGreaterThan(0);
    const puzzle = puzzles[0]!;
    expect(puzzle).toHaveProperty("id");
    expect(puzzle.id).toHaveLength(8);
    expect(puzzle).toHaveProperty("fen");
    expect(puzzle).toHaveProperty("color_to_move");
    expect(puzzle).toHaveProperty("solution");
    expect(Array.isArray(puzzle.solution)).toBe(true);
    expect(puzzle.solution.length).toBeGreaterThan(0);
    expect(puzzle).toHaveProperty("difficulty");
    expect(["easy", "medium", "hard"]).toContain(puzzle.difficulty);
    expect(puzzle).toHaveProperty("eval_swing_cp");
    expect(puzzle.eval_swing_cp).toBeGreaterThan(0);
    expect(puzzle).toHaveProperty("theme");
    expect(typeof puzzle.theme).toBe("string");
  });

  it("deduplicates puzzles with the same FEN", async () => {
    // Two analyses with the same fenBefore
    const analyses = [makeAnalysis(), makeAnalysis({ id: 2, player_game_id: 2 })];
    const metas: GameMeta[] = [
      { game_id: "game1", player_color: "white" },
      { game_id: "game2", player_color: "white" },
    ];

    const puzzles = await extractPuzzles(analyses, metas, "all", 10);

    // Should only appear once because FENs are identical
    const ids = puzzles.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("applies difficulty filter correctly", async () => {
    const analyses = [makeAnalysis()];
    const metas: GameMeta[] = [{ game_id: "g1", player_color: "white" }];

    // Mock returns 3-move PV → medium difficulty
    const puzzlesMedium = await extractPuzzles(analyses, metas, "medium", 10);
    for (const p of puzzlesMedium) {
      expect(p.difficulty).toBe("medium");
    }
  });

  it("returns empty when no blunders found", async () => {
    const analyses = [
      makeAnalysis({
        critical_moments: [
          {
            move_number: 5,
            color: "white",
            move_played: "h3",
            best_move: "O-O",
            eval_before_cp: 30,
            eval_after_cp: -20,
            eval_drop_cp: 50,  // only 50cp — inaccuracy, below blunder threshold (150)
            category: "inaccuracy",
            explanation: "h3 is slightly inaccurate.",
          },
        ],
      }),
    ];
    const metas: GameMeta[] = [{ game_id: "g1", player_color: "white" }];

    const puzzles = await extractPuzzles(analyses, metas, "all", 10);
    expect(puzzles).toEqual([]);
  });

  it("respects maxPuzzles cap", async () => {
    // Valid FENs representing different positions (after 1.e4, 1.d4, etc.)
    const UNIQUE_FENS = [
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
      "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1",
      "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq c3 0 1",
      "rnbqkbnr/pppppppp/8/8/5P2/8/PPPPP1PP/RNBQKBNR b KQkq f3 0 1",
      "rnbqkbnr/pppppppp/8/8/6P1/8/PPPPPP1P/RNBQKBNR b KQkq g3 0 1",
    ];

    // Create analyses with many blunders, each at a unique FEN
    const manyAnalyses = UNIQUE_FENS.map((fen, i) =>
      makeAnalysis({
        id: i + 1,
        player_game_id: i + 1,
        move_records: [
          {
            moveNumber: 10 + i,
            color: "white",
            san: "Bg5",
            fenBefore: fen,
            fenAfter: STARTING_FEN,
            evalBefore: 50,
            evalAfter: -200,
            bestMoveSan: "Nf3",
          },
        ],
        critical_moments: [
          {
            move_number: 10 + i,
            color: "white",
            move_played: "Bg5",
            best_move: "Nf3",
            eval_before_cp: 50,
            eval_after_cp: -200,
            eval_drop_cp: 250,
            category: "blunder",
            explanation: "Blunder.",
          },
        ],
      })
    );
    const metas = manyAnalyses.map((_, i) => ({ game_id: `g${i}`, player_color: "white" as const }));

    const puzzles = await extractPuzzles(manyAnalyses, metas, "all", 3);
    expect(puzzles.length).toBeLessThanOrEqual(3);
  });

  it("generates deterministic IDs from FEN", async () => {
    const analyses = [makeAnalysis()];
    const metas: GameMeta[] = [{ game_id: "g1", player_color: "white" }];

    const [run1] = await extractPuzzles(analyses, metas, "all", 10);
    const [run2] = await extractPuzzles(analyses, metas, "all", 10);

    expect(run1?.id).toBe(run2?.id);
  });
});
