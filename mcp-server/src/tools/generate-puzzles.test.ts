import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../store/db.js", () => ({
  isDbConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock("../store/analysis-store.js", () => ({
  getAnalysesForUser: vi.fn(),
}));

vi.mock("../store/game-store.js", () => ({
  getGamesForUser: vi.fn().mockResolvedValue([
    { id: 1, game_id: "game1", player_color: "white", player_game_id: 1 },
  ]),
}));

vi.mock("../engines/engine-router.js", () => ({
  waitUntilRouterReady: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../intelligence/puzzle-classifier.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../intelligence/puzzle-classifier.js")>();
  return {
    ...actual,
    extractPuzzles: vi.fn().mockResolvedValue([
      {
        id: "abc12345",
        fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
        color_to_move: "white" as const,
        solution: ["Nf3", "Nc6", "Bb5"],
        difficulty: "medium" as const,
        eval_swing_cp: 300,
        theme: "fork",
        source_game_id: "game1",
        source_move_number: 10,
      },
    ]),
  };
});

import { handleGeneratePuzzles } from "./generate-puzzles.js";
import { isDbConfigured } from "../store/db.js";
import { getAnalysesForUser } from "../store/analysis-store.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleGeneratePuzzles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDbConfigured).mockReturnValue(true);
  });

  it("returns error note when DB not configured", async () => {
    vi.mocked(isDbConfigured).mockReturnValue(false);

    const result = await handleGeneratePuzzles({
      username: "testuser",
      platform: "lichess",
    });

    expect(result.puzzles).toEqual([]);
    expect(result.note).toBeDefined();
    expect(result.note).toContain("DATABASE_URL");
  });

  it("returns error note when no analyzed games found", async () => {
    vi.mocked(getAnalysesForUser).mockResolvedValue([]);

    const result = await handleGeneratePuzzles({
      username: "testuser",
      platform: "lichess",
    });

    expect(result.puzzles).toEqual([]);
    expect(result.note).toBeDefined();
    expect(result.note).toContain("refresh_games");
  });

  it("returns puzzles when analyses exist", async () => {
    vi.mocked(getAnalysesForUser).mockResolvedValue([
      {
        id: 1,
        player_game_id: 1,
        schema_version: "0.6",
        move_records: [],
        white_accuracy: 80,
        black_accuracy: 75,
        critical_moments: [],
        phase_breakdown: null,
        patterns_detected: null,
        analyzed_at: new Date(),
      },
    ]);

    const result = await handleGeneratePuzzles({
      username: "testuser",
      platform: "lichess",
    });

    expect(result.username).toBe("testuser");
    expect(Array.isArray(result.puzzles)).toBe(true);
    expect(result.games_scanned).toBeGreaterThan(0);
  });

  it("puzzle objects have all required fields", async () => {
    vi.mocked(getAnalysesForUser).mockResolvedValue([
      {
        id: 1,
        player_game_id: 1,
        schema_version: "0.6",
        move_records: [],
        white_accuracy: 80,
        black_accuracy: 75,
        critical_moments: [],
        phase_breakdown: null,
        patterns_detected: null,
        analyzed_at: new Date(),
      },
    ]);

    const result = await handleGeneratePuzzles({
      username: "testuser",
      platform: "lichess",
    });

    for (const puzzle of result.puzzles) {
      expect(puzzle).toHaveProperty("id");
      expect(puzzle.id).toHaveLength(8);
      expect(puzzle).toHaveProperty("fen");
      expect(puzzle).toHaveProperty("color_to_move");
      expect(["white", "black"]).toContain(puzzle.color_to_move);
      expect(puzzle).toHaveProperty("solution");
      expect(Array.isArray(puzzle.solution)).toBe(true);
      expect(puzzle).toHaveProperty("difficulty");
      expect(["easy", "medium", "hard"]).toContain(puzzle.difficulty);
      expect(puzzle).toHaveProperty("eval_swing_cp");
      expect(puzzle).toHaveProperty("theme");
    }
  });

  it("passes difficulty filter through to extractPuzzles", async () => {
    vi.mocked(getAnalysesForUser).mockResolvedValue([
      {
        id: 1,
        player_game_id: 1,
        schema_version: "0.6",
        move_records: [],
        white_accuracy: 80,
        black_accuracy: 75,
        critical_moments: [],
        phase_breakdown: null,
        patterns_detected: null,
        analyzed_at: new Date(),
      },
    ]);

    const { extractPuzzles } = await import("../intelligence/puzzle-classifier.js");

    await handleGeneratePuzzles({
      username: "testuser",
      platform: "lichess",
      difficulty: "hard",
    });

    expect(vi.mocked(extractPuzzles)).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      "hard",
      15
    );
  });

  it("filters by puzzle type after extraction", async () => {
    vi.mocked(getAnalysesForUser).mockResolvedValue([
      {
        id: 1,
        player_game_id: 1,
        schema_version: "0.6",
        move_records: [],
        white_accuracy: 80,
        black_accuracy: 75,
        critical_moments: [],
        phase_breakdown: null,
        patterns_detected: null,
        analyzed_at: new Date(),
      },
    ]);

    const result = await handleGeneratePuzzles({
      username: "testuser",
      platform: "lichess",
      puzzle_type: "tactical",
    });

    // "fork" theme is tactical — mock returns fork, so should pass filter
    expect(result.puzzles.length).toBeGreaterThan(0);
  });
});
