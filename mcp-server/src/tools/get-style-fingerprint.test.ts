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

import { handleGetStyleFingerprint } from "./get-style-fingerprint.js";
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
    pgn: "[Event 'Test'][White 'alice'][Black 'bob'][Result '1-0'] 1. e4 e5 2. Nf3 Nc6 1-0",
    time_control: "600+0",
    played_at: null,
    result: "1-0",
    opening_name: "Ruy Lopez",
    opening_eco: "C65",
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
// handleGetStyleFingerprint
// ---------------------------------------------------------------------------

describe("handleGetStyleFingerprint", () => {
  it("returns zero fingerprint when DB not configured", async () => {
    mockIsDbConfigured.mockReturnValue(false);

    const result = await handleGetStyleFingerprint({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.games_analyzed).toBe(0);
    expect(result.style_label).toBe("Unknown");
    expect(result.note).toContain("DATABASE_URL");
  });

  it("returns zero fingerprint when no analyses found", async () => {
    mockGetAnalyses.mockResolvedValueOnce([]);
    mockGetGames.mockResolvedValueOnce([]);

    const result = await handleGetStyleFingerprint({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.games_analyzed).toBe(0);
    expect(result.style_label).toBe("Unknown");
    expect(result.note).toContain("refresh_games");
  });

  it("returns fingerprint with label and description when analyses exist", async () => {
    mockGetAnalyses.mockResolvedValueOnce([makeAnalysisRow()]);
    mockGetGames.mockResolvedValueOnce([makeGameRow()]);

    const result = await handleGetStyleFingerprint({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.games_analyzed).toBe(1);
    expect(typeof result.style_label).toBe("string");
    expect(result.style_label.length).toBeGreaterThan(0);
    expect(typeof result.description).toBe("string");
  });

  it("has null time_management for Chess.com", async () => {
    mockGetAnalyses.mockResolvedValueOnce([makeAnalysisRow()]);
    mockGetGames.mockResolvedValueOnce([makeGameRow()]);

    const result = await handleGetStyleFingerprint({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.fingerprint.time_management).toBeNull();
    expect(result.note).toContain("time_management");
  });

  it("does not add time_management note for Lichess", async () => {
    mockGetAnalyses.mockResolvedValueOnce([makeAnalysisRow()]);
    mockGetGames.mockResolvedValueOnce([makeGameRow({ platform: "lichess" })]);

    const result = await handleGetStyleFingerprint({
      username: "alice",
      platform: "lichess",
    });

    // No note about time_management for Lichess (even if null due to no clocks in test PGN)
    expect(result.note).toBeUndefined();
  });

  it("skips analyses whose game is not in game map", async () => {
    mockGetAnalyses.mockResolvedValueOnce([
      makeAnalysisRow({ player_game_id: 999 }), // no matching game
    ]);
    mockGetGames.mockResolvedValueOnce([makeGameRow({ id: 1 })]);

    const result = await handleGetStyleFingerprint({
      username: "alice",
      platform: "chess.com",
    });

    // Should still complete, but with 0 games processed
    expect(result.games_analyzed).toBe(0);
  });

  it("uses num_games parameter", async () => {
    mockGetAnalyses.mockResolvedValueOnce([]);
    mockGetGames.mockResolvedValueOnce([]);

    await handleGetStyleFingerprint({
      username: "alice",
      platform: "chess.com",
      num_games: 30,
    });

    expect(mockGetAnalyses).toHaveBeenCalledWith("chess.com", "alice", 30);
    expect(mockGetGames).toHaveBeenCalledWith("chess.com", "alice", 30);
  });

  it("defaults to 50 games when num_games not provided", async () => {
    mockGetAnalyses.mockResolvedValueOnce([]);
    mockGetGames.mockResolvedValueOnce([]);

    await handleGetStyleFingerprint({
      username: "alice",
      platform: "chess.com",
    });

    expect(mockGetAnalyses).toHaveBeenCalledWith("chess.com", "alice", 50);
  });

  it("fingerprint scores are all in 0-100 range", async () => {
    mockGetAnalyses.mockResolvedValueOnce([makeAnalysisRow()]);
    mockGetGames.mockResolvedValueOnce([makeGameRow()]);

    const result = await handleGetStyleFingerprint({
      username: "alice",
      platform: "chess.com",
    });

    const { aggression, positional_sense, tactical_sharpness, endgame_skill } = result.fingerprint;
    expect(aggression).toBeGreaterThanOrEqual(0);
    expect(aggression).toBeLessThanOrEqual(100);
    expect(positional_sense).toBeGreaterThanOrEqual(0);
    expect(positional_sense).toBeLessThanOrEqual(100);
    expect(tactical_sharpness).toBeGreaterThanOrEqual(0);
    expect(tactical_sharpness).toBeLessThanOrEqual(100);
    expect(endgame_skill).toBeGreaterThanOrEqual(0);
    expect(endgame_skill).toBeLessThanOrEqual(100);
  });

  it("handles invalid player_color by defaulting to white", async () => {
    mockGetAnalyses.mockResolvedValueOnce([makeAnalysisRow()]);
    mockGetGames.mockResolvedValueOnce([makeGameRow({ player_color: "unknown" })]);

    const result = await handleGetStyleFingerprint({
      username: "alice",
      platform: "chess.com",
    });

    // Should not throw; defaults to white
    expect(result.games_analyzed).toBe(1);
  });
});
