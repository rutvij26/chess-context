import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock data so factories can reference them
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const MOCK_CHESSCOM_GAMES = [
    {
      pgn: `[Result "1-0"]\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0`,
      white: { username: "testuser" },
      black: { username: "opponent1" },
      url: "https://www.chess.com/game/live/1",
      time_control: "600",
      end_time: 1700000000,
    },
    {
      pgn: `[Result "0-1"]\n1. e4 e5 2. Nf3 Nc6 3. Bb5 d5 4. exd5 Qxd5 0-1`,
      white: { username: "testuser" },
      black: { username: "opponent2" },
      url: "https://www.chess.com/game/live/2",
      time_control: "600",
      end_time: 1700000100,
    },
  ];

  const MOCK_LICHESS_GAMES = [
    {
      id: "lichess1",
      rated: true,
      variant: "standard",
      speed: "rapid",
      perf: "rapid",
      createdAt: 1700000000,
      lastMoveAt: 1700003600,
      status: "mate",
      players: {
        white: { user: { id: "testuser", name: "testuser" }, rating: 1500 },
        black: { user: { id: "opp1", name: "opp1" }, rating: 1480 },
      },
      opening: { eco: "C60", name: "Ruy Lopez", ply: 6 },
      moves: "e4 e5 Nf3 Nc6 Bb5 a6",
      winner: "white",
    },
  ];

  return { MOCK_CHESSCOM_GAMES, MOCK_LICHESS_GAMES };
});

vi.mock("../data/chesscom-api.js", () => ({
  getRecentGames: vi.fn().mockResolvedValue(mocks.MOCK_CHESSCOM_GAMES),
  PlayerNotFoundError: class PlayerNotFoundError extends Error {},
}));

vi.mock("../data/lichess-api.js", () => ({
  getRecentGames: vi.fn().mockResolvedValue(mocks.MOCK_LICHESS_GAMES),
  PlayerNotFoundError: class PlayerNotFoundError extends Error {},
}));

import { handleFindOpeningGaps } from "./find-opening-gaps.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleFindOpeningGaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a valid structure for chess.com", async () => {
    const result = await handleFindOpeningGaps({
      username: "testuser",
      platform: "chess.com",
      color: "white",
    });

    expect(result.username).toBe("testuser");
    expect(result.platform).toBe("chess.com");
    expect(result.color).toBe("white");
    expect(typeof result.games_analyzed).toBe("number");
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(typeof result.summary).toBe("string");
  });

  it("returns a valid structure for lichess", async () => {
    const result = await handleFindOpeningGaps({
      username: "testuser",
      platform: "lichess",
      color: "white",
    });

    expect(result.username).toBe("testuser");
    expect(result.platform).toBe("lichess");
    expect(Array.isArray(result.gaps)).toBe(true);
  });

  it("only analyzes games of the specified color", async () => {
    const result = await handleFindOpeningGaps({
      username: "testuser",
      platform: "chess.com",
      color: "black",
    });

    // testuser always plays white in mock games, so 0 black games
    expect(result.games_analyzed).toBe(0);
  });

  it("handles API errors gracefully", async () => {
    const { getRecentGames } = await import("../data/chesscom-api.js");
    vi.mocked(getRecentGames).mockRejectedValueOnce(new Error("API error"));

    const result = await handleFindOpeningGaps({
      username: "testuser",
      platform: "chess.com",
      color: "white",
    });

    expect(result.gaps).toEqual([]);
    expect(result.summary).toContain("API error");
  });

  it("returns empty gaps when not enough games", async () => {
    const result = await handleFindOpeningGaps({
      username: "testuser",
      platform: "chess.com",
      color: "white",
      min_occurrences: 10, // higher than available games
    });

    expect(result.gaps).toEqual([]);
  });

  it("gap objects have required fields when gaps are found", async () => {
    const result = await handleFindOpeningGaps({
      username: "testuser",
      platform: "chess.com",
      color: "white",
      min_occurrences: 2,
    });

    for (const gap of result.gaps) {
      expect(typeof gap.fen).toBe("string");
      expect(typeof gap.move_number).toBe("number");
      expect(typeof gap.occurrences).toBe("number");
      expect(gap.occurrences).toBeGreaterThanOrEqual(2);
      expect(gap.opponent_deviation_rate).toBeGreaterThanOrEqual(0);
      expect(gap.opponent_deviation_rate).toBeLessThanOrEqual(100);
      expect(typeof gap.study_suggestion).toBe("string");
    }
  });

  it("includes a meaningful summary", async () => {
    const result = await handleFindOpeningGaps({
      username: "testuser",
      platform: "chess.com",
      color: "white",
    });

    expect(result.summary.length).toBeGreaterThan(10);
    expect(result.summary).toMatch(/testuser/);
  });
});
