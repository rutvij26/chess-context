import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { UCIAnalysisLine, PlayerStats } from "../types/index.js";

// ---------------------------------------------------------------------------
// We re-import the module functions each time to test a clean state.
// Vitest module isolation re-runs the module per test file so the LRU caches
// start empty for this file's test suite.
// ---------------------------------------------------------------------------

import {
  positionCacheKey,
  getPositionEval,
  setPositionEval,
  playerCacheKey,
  getPlayerStats,
  setPlayerStats,
} from "./index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeLines(depth = 18): UCIAnalysisLine[] {
  return [
    { depth, score_cp: 30, score_mate: null, pv: ["e2e4"], multipv_rank: 1 },
    { depth, score_cp: 25, score_mate: null, pv: ["d2d4"], multipv_rank: 2 },
  ];
}

function makePlayerStats(username = "testplayer"): PlayerStats {
  return {
    username,
    platform: "lichess",
    ratings: {
      blitz: { current: 1500, peak: 1600, games: 200 },
    },
    win_rate: { overall: 50, as_white: 52, as_black: 48 },
    opening_repertoire: {
      as_white: [],
      as_black_vs_e4: [],
      as_black_vs_d4: [],
    },
    recent_form: {
      last_n_games: 20,
      wins: 10,
      draws: 2,
      losses: 8,
      rating_trend: "stable",
    },
  };
}

// ---------------------------------------------------------------------------
// positionCacheKey
// ---------------------------------------------------------------------------

describe("positionCacheKey", () => {
  it("returns a string in the expected format", () => {
    const key = positionCacheKey(FEN, 18, 3);
    expect(key).toBe(`${FEN}:18:3`);
  });

  it("produces different keys for different depths", () => {
    const k1 = positionCacheKey(FEN, 12, 3);
    const k2 = positionCacheKey(FEN, 18, 3);
    expect(k1).not.toBe(k2);
  });

  it("produces different keys for different multiPv values", () => {
    const k1 = positionCacheKey(FEN, 18, 1);
    const k2 = positionCacheKey(FEN, 18, 3);
    expect(k1).not.toBe(k2);
  });

  it("produces different keys for different FENs", () => {
    const fen2 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const k1 = positionCacheKey(FEN, 18, 3);
    const k2 = positionCacheKey(fen2, 18, 3);
    expect(k1).not.toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// Position cache (LRU, no TTL)
// ---------------------------------------------------------------------------

describe("position eval cache", () => {
  it("returns undefined for a cache miss", () => {
    const key = positionCacheKey("nonexistent-fen", 18, 3);
    expect(getPositionEval(key)).toBeUndefined();
  });

  it("returns stored lines after set", () => {
    const key = positionCacheKey(FEN, 18, 3);
    const lines = makeLines();
    setPositionEval(key, lines);
    expect(getPositionEval(key)).toEqual(lines);
  });

  it("returns the exact same array reference", () => {
    const key = positionCacheKey(FEN, 20, 1);
    const lines = makeLines(20);
    setPositionEval(key, lines);
    expect(getPositionEval(key)).toBe(lines);
  });

  it("stores multiple different keys independently", () => {
    const key1 = positionCacheKey(FEN, 12, 1);
    const key2 = positionCacheKey(FEN, 18, 3);
    const lines1 = makeLines(12);
    const lines2 = makeLines(18);
    setPositionEval(key1, lines1);
    setPositionEval(key2, lines2);
    expect(getPositionEval(key1)).toEqual(lines1);
    expect(getPositionEval(key2)).toEqual(lines2);
  });

  it("overwrites a previous value with the same key", () => {
    const key = positionCacheKey(FEN, 18, 2);
    const original = makeLines(18);
    const updated = makeLines(20);
    setPositionEval(key, original);
    setPositionEval(key, updated);
    expect(getPositionEval(key)).toEqual(updated);
  });
});

// ---------------------------------------------------------------------------
// playerCacheKey
// ---------------------------------------------------------------------------

describe("playerCacheKey", () => {
  it("returns a string combining platform and username", () => {
    const key = playerCacheKey("lichess", "Magnus");
    expect(key).toBe("lichess:magnus");
  });

  it("lowercases the username", () => {
    const k1 = playerCacheKey("chess.com", "HIKARU");
    const k2 = playerCacheKey("chess.com", "hikaru");
    expect(k1).toBe(k2);
  });

  it("produces different keys for different platforms", () => {
    const k1 = playerCacheKey("chess.com", "alice");
    const k2 = playerCacheKey("lichess", "alice");
    expect(k1).not.toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// Player stats cache (TTL-aware)
// ---------------------------------------------------------------------------

describe("player stats cache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for a cache miss", () => {
    const key = playerCacheKey("lichess", "nobody-special-xyz");
    expect(getPlayerStats(key)).toBeUndefined();
  });

  it("returns stored stats immediately after set", () => {
    const key = playerCacheKey("lichess", "alice");
    const stats = makePlayerStats("alice");
    setPlayerStats(key, stats);
    expect(getPlayerStats(key)).toEqual(stats);
  });

  it("returns undefined after the TTL has expired", () => {
    vi.useFakeTimers();
    const key = playerCacheKey("lichess", "bob-ttl-test");
    const stats = makePlayerStats("bob-ttl-test");
    setPlayerStats(key, stats);

    // Advance clock past the 5-minute TTL
    vi.advanceTimersByTime(6 * 60 * 1000);

    expect(getPlayerStats(key)).toBeUndefined();
  });

  it("still returns stats just before TTL expires", () => {
    vi.useFakeTimers();
    const key = playerCacheKey("lichess", "carol-ttl-test");
    const stats = makePlayerStats("carol-ttl-test");
    setPlayerStats(key, stats);

    // 4 minutes — still within TTL
    vi.advanceTimersByTime(4 * 60 * 1000);

    expect(getPlayerStats(key)).toEqual(stats);
  });

  it("returns updated stats when set twice", () => {
    const key = playerCacheKey("chess.com", "dave");
    const statsV1 = makePlayerStats("dave");
    const statsV2: PlayerStats = {
      ...statsV1,
      win_rate: { overall: 60, as_white: 62, as_black: 58 },
    };
    setPlayerStats(key, statsV1);
    setPlayerStats(key, statsV2);
    expect(getPlayerStats(key)).toEqual(statsV2);
  });
});
