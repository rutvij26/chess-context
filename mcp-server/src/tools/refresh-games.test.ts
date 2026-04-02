import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../store/db.js", () => ({
  isDbConfigured: vi.fn(),
}));

vi.mock("../store/game-store.js", () => ({
  insertGames: vi.fn(),
  getGameIdsForUser: vi.fn(),
}));

vi.mock("../store/analysis-pipeline.js", () => ({
  enqueueUnanalyzedGames: vi.fn(),
  startPipeline: vi.fn(),
}));

vi.mock("../store/analysis-store.js", () => ({
  countAnalysesForUser: vi.fn(),
}));

vi.mock("../data/chesscom-api.js", () => ({
  getRecentGames: vi.fn(),
}));

vi.mock("../data/lichess-api.js", () => ({
  getRecentGames: vi.fn(),
}));

import { handleRefreshGames } from "./refresh-games.js";
import { isDbConfigured } from "../store/db.js";
import { insertGames, getGameIdsForUser } from "../store/game-store.js";
import { enqueueUnanalyzedGames, startPipeline } from "../store/analysis-pipeline.js";
import { countAnalysesForUser } from "../store/analysis-store.js";
import { getRecentGames as chesscomGetGames } from "../data/chesscom-api.js";
import { getRecentGames as lichessGetGames } from "../data/lichess-api.js";

const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockInsertGames = vi.mocked(insertGames);
const mockGetGameIds = vi.mocked(getGameIdsForUser);
const mockEnqueue = vi.mocked(enqueueUnanalyzedGames);
const mockStartPipeline = vi.mocked(startPipeline);
const mockCountAnalyses = vi.mocked(countAnalysesForUser);
const mockChesscomGames = vi.mocked(chesscomGetGames);
const mockLichessGames = vi.mocked(lichessGetGames);

function makeChessComGame(id: string) {
  return {
    url: `https://www.chess.com/game/live/${id}`,
    pgn: `[White "alice"][Black "bob"][Result "1-0"][TimeControl "600"][Date "2024.01.01"] 1. e4 1-0`,
    end_time: 1700000000,
    time_control: "600",
    time_class: "rapid",
    rated: true,
    white: { username: "alice", rating: 1400, result: "win" },
    black: { username: "bob", rating: 1350, result: "lose" },
  };
}

function makeLichessGame(id: string) {
  return {
    id,
    pgn: `[White "alice"][Black "bob"][Result "1-0"][TimeControl "600+0"][Date "2024.01.01"][WhiteElo "1400"][BlackElo "1350"] 1. e4 1-0`,
    clock: { initial: 600, increment: 0, totalTime: 600 },
    createdAt: 1700000000000,
    status: "mate",
    winner: "white",
    players: {
      white: { user: { name: "alice" }, rating: 1400 },
      black: { user: { name: "bob" }, rating: 1350 },
    },
    opening: { eco: "B20", name: "Sicilian" },
  };
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockInsertGames.mockReset();
  mockGetGameIds.mockReset();
  mockEnqueue.mockReset();
  mockStartPipeline.mockReset();
  mockCountAnalyses.mockReset();
  mockChesscomGames.mockReset();
  mockLichessGames.mockReset();

  mockIsDbConfigured.mockReturnValue(true);
  mockInsertGames.mockResolvedValue(0);
  mockGetGameIds.mockResolvedValue(new Set(["oldgame"]));
  mockEnqueue.mockResolvedValue(3);
  mockStartPipeline.mockReturnValue(undefined);
  mockCountAnalyses.mockResolvedValue(15);
});

// ---------------------------------------------------------------------------
// handleRefreshGames
// ---------------------------------------------------------------------------

describe("handleRefreshGames", () => {
  it("returns message when DB is not configured", async () => {
    mockIsDbConfigured.mockReturnValue(false);

    const result = await handleRefreshGames({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.fetched).toBe(0);
    expect(result.message).toContain("DATABASE_URL");
  });

  it("fetches chess.com games and returns status", async () => {
    mockChesscomGames.mockResolvedValueOnce([
      makeChessComGame("new1"),
      makeChessComGame("new2"),
    ]);

    const result = await handleRefreshGames({
      username: "alice",
      platform: "chess.com",
      count: 20,
    });

    expect(result.fetched).toBe(2);
    expect(result.status).toBe("processing");
    expect(mockChesscomGames).toHaveBeenCalledWith("alice", 20);
  });

  it("fetches lichess games and returns status", async () => {
    mockLichessGames.mockResolvedValueOnce([
      makeLichessGame("abc123"),
      makeLichessGame("def456"),
    ]);

    const result = await handleRefreshGames({
      username: "alice",
      platform: "lichess",
    });

    expect(result.fetched).toBe(2);
    expect(mockLichessGames).toHaveBeenCalledWith("alice", 20);
  });

  it("counts new games vs already stored", async () => {
    const games = [makeChessComGame("new1"), makeChessComGame("oldgame")];
    mockChesscomGames.mockResolvedValueOnce(games);
    // getGameIdsForUser returns set with "oldgame"
    mockGetGameIds.mockResolvedValueOnce(new Set(["oldgame"]));

    const result = await handleRefreshGames({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.fetched).toBe(2);
  });

  it("calls enqueueUnanalyzedGames and startPipeline", async () => {
    mockChesscomGames.mockResolvedValueOnce([makeChessComGame("new1")]);

    await handleRefreshGames({
      username: "alice",
      platform: "chess.com",
    });

    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockStartPipeline).toHaveBeenCalled();
  });

  it("defaults count to 20", async () => {
    mockChesscomGames.mockResolvedValueOnce([]);

    await handleRefreshGames({
      username: "alice",
      platform: "chess.com",
    });

    expect(mockChesscomGames).toHaveBeenCalledWith("alice", 20);
  });

  it("passes count directly to API (no cap enforced in handler)", async () => {
    mockChesscomGames.mockResolvedValueOnce([]);

    await handleRefreshGames({
      username: "alice",
      platform: "chess.com",
      count: 30,
    });

    expect(mockChesscomGames).toHaveBeenCalledWith("alice", 30);
  });

  it("includes already_analyzed count based on fetched minus new_games", async () => {
    // fetched = 2, new_games = 1 → already_analyzed = 1
    mockChesscomGames.mockResolvedValueOnce([makeChessComGame("new1"), makeChessComGame("existing1")]);
    mockInsertGames.mockResolvedValueOnce(1); // only 1 new

    const result = await handleRefreshGames({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.fetched).toBe(2);
    expect(result.new_games).toBe(1);
    expect(result.already_analyzed).toBe(1);
  });

  it("returns queued_for_analysis count from enqueue", async () => {
    mockChesscomGames.mockResolvedValueOnce([makeChessComGame("new1")]);
    mockEnqueue.mockResolvedValueOnce(5);

    const result = await handleRefreshGames({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.queued_for_analysis).toBe(5);
  });

  it("handles empty game fetch gracefully", async () => {
    mockChesscomGames.mockResolvedValueOnce([]);
    mockInsertGames.mockResolvedValueOnce(0);

    const result = await handleRefreshGames({
      username: "alice",
      platform: "chess.com",
    });

    expect(result.fetched).toBe(0);
    expect(result.already_analyzed).toBe(0);
  });
});
