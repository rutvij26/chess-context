import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock lichess-api so tests run without network
// ---------------------------------------------------------------------------

vi.mock("../data/lichess-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/lichess-api.js")>();
  return {
    ...actual,
    getLichessOpeningExplorer: vi.fn().mockResolvedValue({
      opening: { eco: "B20", name: "Sicilian Defense" },
      white: 4000,
      draws: 2000,
      black: 4000,
      moves: [
        { uci: "b1c3", san: "Nc3", white: 1200, draws: 700, black: 1100, averageRating: 2400 },
        { uci: "g1f3", san: "Nf3", white: 1100, draws: 600, black: 1000, averageRating: 2450 },
        { uci: "d2d4", san: "d4",  white: 900,  draws: 400, black: 700,  averageRating: 2380 },
      ],
    }),
  };
});

import { handleGetOpeningTheory } from "./get-opening-theory.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleGetOpeningTheory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error note when neither fen nor opening_name is provided", async () => {
    const result = await handleGetOpeningTheory({});
    expect(result.note).toBeDefined();
    expect(result.opening_name).toBe("Unknown");
  });

  it("returns opening theory for a FEN", async () => {
    const result = await handleGetOpeningTheory({
      fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
    });

    expect(result.opening_name).toBe("Sicilian Defense");
    expect(result.eco).toBe("B20");
    expect(Array.isArray(result.key_ideas)).toBe(true);
    expect(result.key_ideas.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(result.main_continuations)).toBe(true);
    expect(result.main_continuations.length).toBeGreaterThan(0);
    expect(result.win_stats.white_wins + result.win_stats.draws + result.win_stats.black_wins).toBeCloseTo(100, 0);
    expect(typeof result.historical_context).toBe("string");
    expect(result.historical_context.length).toBeGreaterThan(0);
    expect(typeof result.narrative).toBe("string");
    expect(typeof result.lichess_explorer_url).toBe("string");
    expect(result.lichess_explorer_url.length).toBeGreaterThan(0);
  });

  it("looks up a FEN for a known opening name", async () => {
    const result = await handleGetOpeningTheory({
      opening_name: "Sicilian Defense",
    });
    expect(result.opening_name).toBe("Sicilian Defense");
    expect(result.eco).toBe("B20");
  });

  it("adapts narrative for beginner level", async () => {
    const result = await handleGetOpeningTheory({
      opening_name: "Sicilian Defense",
      player_level: "beginner",
    });
    expect(result.narrative).toMatch(/beginner/i);
  });

  it("adapts narrative for advanced level", async () => {
    const result = await handleGetOpeningTheory({
      opening_name: "Sicilian Defense",
      player_level: "advanced",
    });
    expect(result.narrative).toMatch(/advanced/i);
  });

  it("includes lichess explorer URL", async () => {
    const result = await handleGetOpeningTheory({
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    });
    expect(result.lichess_explorer_url).toContain("lichess.org");
  });

  it("returns win stats that sum to 100%", async () => {
    const result = await handleGetOpeningTheory({
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    });
    const total = result.win_stats.white_wins + result.win_stats.draws + result.win_stats.black_wins;
    // Allow ±2 due to rounding
    expect(total).toBeGreaterThanOrEqual(98);
    expect(total).toBeLessThanOrEqual(102);
  });

  it("handles Lichess API error gracefully", async () => {
    const { getLichessOpeningExplorer } = await import("../data/lichess-api.js");
    vi.mocked(getLichessOpeningExplorer).mockRejectedValueOnce(new Error("Network error"));

    const result = await handleGetOpeningTheory({
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    });
    expect(result.note).toBeDefined();
    expect(result.note).toContain("Network error");
  });
});
