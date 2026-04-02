import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../store/analysis-store.js", () => ({
  getAnalysesForUser: vi.fn(),
}));

vi.mock("../store/game-store.js", () => ({
  getGamesForUser: vi.fn(),
}));

vi.mock("../store/db.js", () => ({
  isDbConfigured: vi.fn(),
}));

import { handleGetMistakePatterns } from "./get-mistake-patterns.js";
import { getAnalysesForUser } from "../store/analysis-store.js";
import { getGamesForUser } from "../store/game-store.js";
import { isDbConfigured } from "../store/db.js";

const mockGetAnalyses = vi.mocked(getAnalysesForUser);
const mockGetGames = vi.mocked(getGamesForUser);
const mockIsDbConfigured = vi.mocked(isDbConfigured);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGameRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    platform: "chess.com" as const,
    username: "alice",
    game_id: "game1",
    pgn: "1.e4 e5 1-0",
    time_control: "600+0",
    played_at: null,
    result: "1-0",
    opening_name: "Sicilian",
    opening_eco: "B20",
    player_color: "white" as const,
    opponent: "bob",
    player_rating: 1400,
    opponent_rating: 1350,
    fetched_at: new Date(),
    ...overrides,
  };
}

function makeAnalysisRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    player_game_id: 1,
    schema_version: "0.6",
    move_records: [],
    white_accuracy: 85,
    black_accuracy: 72,
    critical_moments: [],
    phase_breakdown: null,
    patterns_detected: [],
    analyzed_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  mockGetAnalyses.mockReset();
  mockGetGames.mockReset();
  mockIsDbConfigured.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// handleGetMistakePatterns
// ---------------------------------------------------------------------------

describe("handleGetMistakePatterns", () => {
  it("returns note when DB is not configured", async () => {
    mockIsDbConfigured.mockReturnValue(false);

    const result = await handleGetMistakePatterns({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.games_analyzed).toBe(0);
    expect(result.note).toContain("DATABASE_URL");
  });

  it("returns note when no analyses found", async () => {
    mockGetAnalyses.mockResolvedValueOnce([]);
    mockGetGames.mockResolvedValueOnce([]);

    const result = await handleGetMistakePatterns({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.games_analyzed).toBe(0);
    expect(result.note).toContain("refresh_games");
  });

  it("returns patterns when analyses exist", async () => {
    mockGetAnalyses.mockResolvedValueOnce([makeAnalysisRow()]);
    mockGetGames.mockResolvedValueOnce([makeGameRow()]);

    const result = await handleGetMistakePatterns({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.games_analyzed).toBe(1);
    expect(result.patterns).toBeDefined();
    expect(Array.isArray(result.patterns)).toBe(true);
  });

  it("includes overall_summary", async () => {
    mockGetAnalyses.mockResolvedValueOnce([makeAnalysisRow()]);
    mockGetGames.mockResolvedValueOnce([makeGameRow()]);

    const result = await handleGetMistakePatterns({
      username: "alice",
      platform: "chess.com",
    });

    expect(typeof result.overall_summary).toBe("string");
    expect(result.overall_summary.length).toBeGreaterThan(0);
  });

  it("filters by time control when provided", async () => {
    const analyses = [
      makeAnalysisRow({ player_game_id: 1 }),
      makeAnalysisRow({ id: 2, player_game_id: 2 }),
    ];
    // time_control filter uses String.includes(), so use platform-style values that contain the word
    const games = [
      makeGameRow({ id: 1, time_control: "blitz" }),  // Lichess speed field
      makeGameRow({ id: 2, time_control: "rapid" }),
    ];
    mockGetAnalyses.mockResolvedValueOnce(analyses);
    mockGetGames.mockResolvedValueOnce(games);

    const result = await handleGetMistakePatterns({
      username: "alice",
      platform: "lichess",
      time_control: "blitz",
    });

    // Only 1 game has time_control containing "blitz"
    expect(result.games_analyzed).toBe(1);
    expect(result.games_available).toBe(2);
  });

  it("returns empty patterns with note when time_control filter matches no games", async () => {
    mockGetAnalyses.mockResolvedValueOnce([makeAnalysisRow()]);
    mockGetGames.mockResolvedValueOnce([makeGameRow({ time_control: "600+0" })]);

    const result = await handleGetMistakePatterns({
      username: "alice",
      platform: "chess.com",
      time_control: "blitz",
    });

    expect(result.games_analyzed).toBe(0);
    expect(result.patterns).toHaveLength(0);
  });

  it("uses color from game metadata when available", async () => {
    mockGetAnalyses.mockResolvedValueOnce([makeAnalysisRow({ player_game_id: 1 })]);
    mockGetGames.mockResolvedValueOnce([makeGameRow({ player_color: "black" })]);

    const result = await handleGetMistakePatterns({
      username: "alice",
      platform: "chess.com",
    });

    // Should complete without error (color determination from metadata)
    expect(result.games_analyzed).toBe(1);
  });

  it("uses num_games parameter to limit analyses", async () => {
    mockGetAnalyses.mockResolvedValueOnce([makeAnalysisRow()]);
    mockGetGames.mockResolvedValueOnce([makeGameRow()]);

    await handleGetMistakePatterns({
      username: "alice",
      platform: "chess.com",
      num_games: 10,
    });

    expect(mockGetAnalyses).toHaveBeenCalledWith("chess.com", "alice", 10);
  });

  it("defaults to 20 games when num_games not provided", async () => {
    mockGetAnalyses.mockResolvedValueOnce([]);
    mockGetGames.mockResolvedValueOnce([]);

    await handleGetMistakePatterns({
      username: "alice",
      platform: "chess.com",
    });

    expect(mockGetAnalyses).toHaveBeenCalledWith("chess.com", "alice", 20);
  });
});
