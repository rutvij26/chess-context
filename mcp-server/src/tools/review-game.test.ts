import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GameAnalysis } from "../types/index.js";
import type { PlayerStats } from "../types/index.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./analyze-game.js", () => ({
  handleAnalyzeGame: vi.fn(),
}));

vi.mock("../data/chesscom-api.js", () => ({
  buildPlayerStats: vi.fn(),
}));

vi.mock("../data/lichess-api.js", () => ({
  buildPlayerStats: vi.fn(),
}));

import { handleReviewGame } from "./review-game.js";
import { handleAnalyzeGame } from "./analyze-game.js";
import { buildPlayerStats as chesscomStats } from "../data/chesscom-api.js";
import { buildPlayerStats as lichessStats } from "../data/lichess-api.js";

const mockAnalyzeGame = vi.mocked(handleAnalyzeGame);
const mockChesscomStats = vi.mocked(chesscomStats);
const mockLichessStats = vi.mocked(lichessStats);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAnalysis(overrides: Partial<GameAnalysis> = {}): GameAnalysis {
  return {
    game_info: {
      white: "alice",
      black: "bob",
      result: "1-0",
      opening: "Sicilian Defense",
      time_control: "600+0",
      date: "2024.01.01",
      platform: "chess.com",
    },
    summary: {
      total_moves: 40,
      white_accuracy: 85,
      black_accuracy: 72,
      phase_breakdown: {
        opening: { moves: "1-12", assessment: "Solid opening" },
        middlegame: { moves: "13-30", assessment: "Good middlegame" },
        endgame: { moves: "31-40", assessment: "Clean endgame" },
      },
      mistake_categories: { tactical: 1, strategic: 0, opening: 0, endgame: 0 },
    },
    critical_moments: [],
    patterns_detected: [],
    ...overrides,
  };
}

function makeStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    username: "alice",
    platform: "chess.com",
    ratings: { blitz: { current: 1400, peak: 1500, games: 100 } },
    win_rate: { overall: 50, as_white: 51, as_black: 49 },
    opening_repertoire: { as_white: [], as_black_vs_e4: [], as_black_vs_d4: [] },
    recent_form: { last_n_games: 20, wins: 10, draws: 2, losses: 8, rating_trend: "stable" },
    ...overrides,
  };
}

beforeEach(() => {
  mockAnalyzeGame.mockReset();
  mockChesscomStats.mockReset();
  mockLichessStats.mockReset();
});

// ---------------------------------------------------------------------------
// handleReviewGame
// ---------------------------------------------------------------------------

describe("handleReviewGame", () => {
  it("returns correct result for a winning player", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis());
    mockChesscomStats.mockResolvedValueOnce(makeStats());

    const result = await handleReviewGame({
      pgn: "[White \"alice\"][Black \"bob\"][Result \"1-0\"] 1.e4 1-0",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(result.player).toBe("alice");
    expect(result.result).toBe("win");
    expect(result.player_level).toBe("club");
  });

  it("detects black player correctly", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis({ game_info: { white: "alice", black: "bob", result: "0-1", opening: "Sicilian", time_control: "600+0", date: "2024.01.01", platform: "chess.com" } }));
    mockChesscomStats.mockResolvedValueOnce(makeStats({ username: "bob" }));

    const result = await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "bob",
      platform: "chess.com",
    });

    expect(result.player).toBe("bob");
    expect(result.result).toBe("win");
  });

  it("returns draw result for drawn game", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis({
      game_info: { white: "alice", black: "bob", result: "1/2-1/2", opening: "Ruy Lopez", time_control: "600+0", date: "2024.01.01", platform: "chess.com" },
    }));
    mockChesscomStats.mockResolvedValueOnce(makeStats());

    const result = await handleReviewGame({
      pgn: "1.e4 1/2-1/2",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(result.result).toBe("draw");
  });

  it("falls back to club level when stats fetch fails", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis());
    mockChesscomStats.mockRejectedValueOnce(new Error("Network error"));

    const result = await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(result.player_level).toBe("club");
  });

  it("detects beginner level for low-rated player", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis());
    mockChesscomStats.mockResolvedValueOnce(makeStats({
      ratings: { blitz: { current: 700, peak: 800, games: 50 } },
    }));

    const result = await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(result.player_level).toBe("beginner");
  });

  it("detects advanced level for high-rated player", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis({
      summary: {
        total_moves: 40,
        white_accuracy: 92,
        black_accuracy: 89,
        phase_breakdown: {
          opening: { moves: "1-12", assessment: "" },
          middlegame: { moves: "13-30", assessment: "" },
          endgame: { moves: "31-40", assessment: "" },
        },
        mistake_categories: { tactical: 0, strategic: 0, opening: 0, endgame: 0 },
      },
    }));
    mockChesscomStats.mockResolvedValueOnce(makeStats({
      ratings: { rapid: { current: 2000, peak: 2100, games: 200 } },
    }));

    const result = await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(result.player_level).toBe("advanced");
  });

  it("returns turning point from critical moments", async () => {
    const analysis = makeAnalysis({
      critical_moments: [
        {
          move_number: 22,
          color: "white",
          move_played: "Nd4",
          best_move: "f5",
          eval_before_cp: 50,
          eval_after_cp: -200,
          eval_drop_cp: 280,
          category: "blunder",
          explanation: "Nd4 was a blunder",
        },
        {
          move_number: 30,
          color: "white",
          move_played: "g4",
          best_move: "h4",
          eval_before_cp: -100,
          eval_after_cp: -200,
          eval_drop_cp: 100,
          category: "mistake",
          explanation: "g4 was a mistake",
        },
      ],
    });
    mockAnalyzeGame.mockResolvedValueOnce(analysis);
    mockChesscomStats.mockResolvedValueOnce(makeStats());

    const result = await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(result.turning_point).not.toBeNull();
    expect(result.turning_point!.eval_swing_cp).toBe(280);
    expect(result.turning_point!.move_number).toBe(22);
  });

  it("returns null turning point when no critical moments", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis({ critical_moments: [] }));
    mockChesscomStats.mockResolvedValueOnce(makeStats());

    const result = await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(result.turning_point).toBeNull();
  });

  it("returns phase performance with grades", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis());
    mockChesscomStats.mockResolvedValueOnce(makeStats());

    const result = await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(result.phase_performance.opening).toBeDefined();
    expect(result.phase_performance.middlegame).toBeDefined();
    expect(["A", "B", "C", "D", "F"]).toContain(result.phase_performance.opening.grade);
  });

  it("includes endgame phase only for games with 30+ moves", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis({ summary: { total_moves: 40, white_accuracy: 85, black_accuracy: 70, phase_breakdown: { opening: { moves: "1-12", assessment: "" }, middlegame: { moves: "13-30", assessment: "" }, endgame: { moves: "31-40", assessment: "Fine" } }, mistake_categories: { tactical: 0, strategic: 0, opening: 0, endgame: 0 } } }));
    mockChesscomStats.mockResolvedValueOnce(makeStats());

    const result = await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(result.phase_performance.endgame).toBeDefined();
  });

  it("uses lichess stats for lichess platform", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis({ game_info: { white: "alice", black: "bob", result: "1-0", opening: "Ruy Lopez", time_control: "600+0", date: "2024.01.01", platform: "lichess" } }));
    mockLichessStats.mockResolvedValueOnce(makeStats({ platform: "lichess" }));

    await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "alice",
      platform: "lichess",
    });

    expect(mockLichessStats).toHaveBeenCalledWith("alice");
    expect(mockChesscomStats).not.toHaveBeenCalled();
  });

  it("includes narrative in output", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis());
    mockChesscomStats.mockResolvedValueOnce(makeStats());

    const result = await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(typeof result.narrative).toBe("string");
    expect(result.narrative.length).toBeGreaterThan(0);
  });

  it("accuracy reflects player color", async () => {
    mockAnalyzeGame.mockResolvedValueOnce(makeAnalysis({ summary: { total_moves: 40, white_accuracy: 85, black_accuracy: 72, phase_breakdown: { opening: { moves: "1-12", assessment: "" }, middlegame: { moves: "13-30", assessment: "" } }, mistake_categories: { tactical: 0, strategic: 0, opening: 0, endgame: 0 } } }));
    mockChesscomStats.mockResolvedValueOnce(makeStats());

    const result = await handleReviewGame({
      pgn: "1.e4 1-0",
      player_username: "alice",
      platform: "chess.com",
    });

    expect(result.accuracy).toBe(85); // alice plays white
  });
});
