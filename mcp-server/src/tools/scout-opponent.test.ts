import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlayerStats } from "../types/index.js";

// ---------------------------------------------------------------------------
// Mock get-player-stats so we don't touch cache or API in these tests
// ---------------------------------------------------------------------------

vi.mock("./get-player-stats.js", () => ({
  handleGetPlayerStats: vi.fn(),
}));

import { handleScoutOpponent } from "./scout-opponent.js";
import { handleGetPlayerStats } from "./get-player-stats.js";

const getStatsMock = vi.mocked(handleGetPlayerStats);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  const base: PlayerStats = {
    username: "opponent",
    platform: "lichess",
    ratings: { blitz: { current: 1500, peak: 1600, games: 200 } },
    win_rate: { overall: 50, as_white: 51, as_black: 49 },
    opening_repertoire: {
      as_white: [
        { opening: "King's Pawn", frequency: 60, win_rate: 55, sample_size: 30 },
      ],
      as_black_vs_e4: [
        { opening: "Sicilian Defense", frequency: 70, win_rate: 52, sample_size: 20 },
      ],
      as_black_vs_d4: [
        { opening: "Queen's Gambit Declined", frequency: 80, win_rate: 48, sample_size: 15 },
      ],
    },
    recent_form: { last_n_games: 20, wins: 10, draws: 2, losses: 8, rating_trend: "stable" },
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  getStatsMock.mockReset();
});

// ---------------------------------------------------------------------------
// handleScoutOpponent — structure
// ---------------------------------------------------------------------------

describe("handleScoutOpponent — output shape", () => {
  it("returns a ScoutReport with all required fields", async () => {
    getStatsMock.mockResolvedValueOnce(makeStats());

    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });

    expect(result).toHaveProperty("opponent_profile");
    expect(result).toHaveProperty("expected_openings");
    expect(result).toHaveProperty("strengths");
    expect(result).toHaveProperty("weaknesses");
    expect(result).toHaveProperty("strategic_recommendation");
    expect(result).toHaveProperty("opening_suggestion");
  });

  it("passes the opponent username and platform to handleGetPlayerStats", async () => {
    getStatsMock.mockResolvedValueOnce(makeStats());

    await handleScoutOpponent({
      opponent_username: "someplayer",
      platform: "chess.com",
      your_color: "black",
    });

    expect(getStatsMock).toHaveBeenCalledWith({
      username: "someplayer",
      platform: "chess.com",
    });
  });

  it("expected_openings is an array", async () => {
    getStatsMock.mockResolvedValueOnce(makeStats());
    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });
    expect(Array.isArray(result.expected_openings)).toBe(true);
  });

  it("strengths is a non-empty array", async () => {
    getStatsMock.mockResolvedValueOnce(makeStats());
    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });
    expect(Array.isArray(result.strengths)).toBe(true);
    expect(result.strengths.length).toBeGreaterThan(0);
  });

  it("weaknesses is a non-empty array", async () => {
    getStatsMock.mockResolvedValueOnce(makeStats());
    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });
    expect(Array.isArray(result.weaknesses)).toBe(true);
    expect(result.weaknesses.length).toBeGreaterThan(0);
  });

  it("strategic_recommendation is a non-empty string", async () => {
    getStatsMock.mockResolvedValueOnce(makeStats());
    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });
    expect(typeof result.strategic_recommendation).toBe("string");
    expect(result.strategic_recommendation.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Expected openings — color logic
// ---------------------------------------------------------------------------

describe("handleScoutOpponent — opening repertoire selection", () => {
  it("uses opponent's black repertoire when you play white", async () => {
    const stats = makeStats();
    getStatsMock.mockResolvedValueOnce(stats);

    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });

    // Opponent plays black — we should see their black openings
    const openingNames = result.expected_openings.map((o) => o.opening);
    // Sicilian and QGD are in as_black_vs_e4 / as_black_vs_d4
    expect(
      openingNames.some(
        (n) => n === "Sicilian Defense" || n === "Queen's Gambit Declined"
      )
    ).toBe(true);
  });

  it("uses opponent's white repertoire when you play black", async () => {
    const stats = makeStats();
    getStatsMock.mockResolvedValueOnce(stats);

    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "black",
    });

    // Opponent plays white — we should see their white openings
    const openingNames = result.expected_openings.map((o) => o.opening);
    expect(openingNames.some((n) => n === "King's Pawn")).toBe(true);
  });

  it("filters out openings with sample_size < 2", async () => {
    const stats = makeStats({
      opening_repertoire: {
        as_white: [],
        as_black_vs_e4: [
          { opening: "Caro-Kann", frequency: 80, win_rate: 50, sample_size: 1 },
        ],
        as_black_vs_d4: [],
      },
    });
    getStatsMock.mockResolvedValueOnce(stats);

    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });

    // sample_size=1 should be filtered out
    expect(result.expected_openings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Strengths / weaknesses detection
// ---------------------------------------------------------------------------

describe("handleScoutOpponent — strengths/weaknesses", () => {
  it("detects high overall win rate as a strength", async () => {
    getStatsMock.mockResolvedValueOnce(
      makeStats({ win_rate: { overall: 60, as_white: 62, as_black: 58 } })
    );

    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });

    expect(result.strengths.some((s) => s.includes("win rate"))).toBe(true);
  });

  it("detects poor black win rate as a weakness", async () => {
    getStatsMock.mockResolvedValueOnce(
      makeStats({ win_rate: { overall: 50, as_white: 55, as_black: 40 } })
    );

    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });

    expect(result.weaknesses.some((w) => w.includes("Black"))).toBe(true);
  });

  it("detects falling form as a weakness", async () => {
    getStatsMock.mockResolvedValueOnce(
      makeStats({
        recent_form: {
          last_n_games: 20,
          wins: 5,
          draws: 2,
          losses: 13,
          rating_trend: "falling",
        },
      })
    );

    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });

    expect(result.weaknesses.some((w) => w.toLowerCase().includes("form"))).toBe(true);
  });

  it("detects rising form as a strength", async () => {
    getStatsMock.mockResolvedValueOnce(
      makeStats({
        recent_form: {
          last_n_games: 20,
          wins: 15,
          draws: 2,
          losses: 3,
          rating_trend: "rising",
        },
      })
    );

    const result = await handleScoutOpponent({
      opponent_username: "opponent",
      platform: "lichess",
      your_color: "white",
    });

    expect(result.strengths.some((s) => s.toLowerCase().includes("form"))).toBe(true);
  });
});
