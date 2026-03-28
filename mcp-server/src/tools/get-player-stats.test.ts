import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlayerStats } from "../types/index.js";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock("../data/chesscom-api.js", () => ({
  buildPlayerStats: vi.fn(),
}));

vi.mock("../data/lichess-api.js", () => ({
  buildPlayerStats: vi.fn(),
}));

// Cache is NOT mocked — we test real caching behaviour.
// But because the LRU cache is module-level, we clear it between tests by
// using unique usernames so tests don't interfere with each other.

import { handleGetPlayerStats } from "./get-player-stats.js";
import { buildPlayerStats as buildChessComStats } from "../data/chesscom-api.js";
import { buildPlayerStats as buildLichessStats } from "../data/lichess-api.js";

const buildChessComMock = vi.mocked(buildChessComStats);
const buildLichessMock = vi.mocked(buildLichessStats);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStats(username: string, platform: "chess.com" | "lichess" = "lichess"): PlayerStats {
  return {
    username,
    platform,
    ratings: { blitz: { current: 1500, peak: 1600, games: 100 } },
    win_rate: { overall: 50, as_white: 51, as_black: 49 },
    opening_repertoire: {
      as_white: [],
      as_black_vs_e4: [],
      as_black_vs_d4: [],
    },
    recent_form: { last_n_games: 20, wins: 10, draws: 2, losses: 8, rating_trend: "stable" },
  };
}

beforeEach(() => {
  buildChessComMock.mockReset();
  buildLichessMock.mockReset();
});

// ---------------------------------------------------------------------------
// handleGetPlayerStats
// ---------------------------------------------------------------------------

describe("handleGetPlayerStats", () => {
  it("calls chess.com API for chess.com platform", async () => {
    const stats = makeStats("alice-cc", "chess.com");
    buildChessComMock.mockResolvedValueOnce(stats);

    const result = await handleGetPlayerStats({ username: "alice-cc", platform: "chess.com" });

    expect(buildChessComMock).toHaveBeenCalledWith("alice-cc");
    expect(buildLichessMock).not.toHaveBeenCalled();
    expect(result).toEqual(stats);
  });

  it("calls lichess API for lichess platform", async () => {
    const stats = makeStats("bob-lc", "lichess");
    buildLichessMock.mockResolvedValueOnce(stats);

    const result = await handleGetPlayerStats({ username: "bob-lc", platform: "lichess" });

    expect(buildLichessMock).toHaveBeenCalledWith("bob-lc");
    expect(buildChessComMock).not.toHaveBeenCalled();
    expect(result).toEqual(stats);
  });

  it("returns cached result on second call without hitting the API again", async () => {
    const stats = makeStats("carol-cache", "lichess");
    buildLichessMock.mockResolvedValueOnce(stats);

    const first = await handleGetPlayerStats({ username: "carol-cache", platform: "lichess" });
    const second = await handleGetPlayerStats({ username: "carol-cache", platform: "lichess" });

    // API should only be called once
    expect(buildLichessMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(stats);
    expect(second).toEqual(stats);
  });

  it("returns the exact PlayerStats shape from the API", async () => {
    const stats = makeStats("dave-shape", "chess.com");
    buildChessComMock.mockResolvedValueOnce(stats);

    const result = await handleGetPlayerStats({ username: "dave-shape", platform: "chess.com" });

    expect(result).toHaveProperty("username");
    expect(result).toHaveProperty("platform");
    expect(result).toHaveProperty("ratings");
    expect(result).toHaveProperty("win_rate");
    expect(result).toHaveProperty("opening_repertoire");
    expect(result).toHaveProperty("recent_form");
  });

  it("propagates errors from the API client", async () => {
    buildLichessMock.mockRejectedValueOnce(new Error("Player not found"));

    await expect(
      handleGetPlayerStats({ username: "error-player", platform: "lichess" })
    ).rejects.toThrow("Player not found");
  });

  it("is case-insensitive for cache lookup (key is lowercased)", async () => {
    const stats = makeStats("eve-case", "lichess");
    buildLichessMock.mockResolvedValueOnce(stats);

    // First call sets cache with key "lichess:eve-case"
    await handleGetPlayerStats({ username: "eve-case", platform: "lichess" });
    // Second call with different casing should still hit cache
    await handleGetPlayerStats({ username: "EVE-CASE", platform: "lichess" });

    expect(buildLichessMock).toHaveBeenCalledTimes(1);
  });
});
