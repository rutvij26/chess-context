import { LRUCache } from "lru-cache";
import { config } from "../config.js";
import type { UCIAnalysisLine, PlayerStats } from "../types/index.js";

// ---------------------------------------------------------------------------
// Position eval cache
// Key: `${fen}:${depth}:${multiPv}`
// Value: UCIAnalysisLine[]
// No TTL — evaluation of a position at a given depth is deterministic.
// ---------------------------------------------------------------------------

const positionCache = new LRUCache<string, UCIAnalysisLine[]>({
  max: config.cache.positionMaxSize,
});

export function positionCacheKey(
  fen: string,
  depth: number,
  multiPv: number
): string {
  return `${fen}:${depth}:${multiPv}`;
}

export function getPositionEval(key: string): UCIAnalysisLine[] | undefined {
  return positionCache.get(key);
}

export function setPositionEval(key: string, lines: UCIAnalysisLine[]): void {
  positionCache.set(key, lines);
}

// ---------------------------------------------------------------------------
// Player stats cache
// Key: `${platform}:${username}`
// Value: PlayerStats with TTL
// ---------------------------------------------------------------------------

interface PlayerCacheEntry {
  stats: PlayerStats;
  fetchedAt: number;
}

const playerCache = new LRUCache<string, PlayerCacheEntry>({
  max: config.cache.playerMaxSize,
});

export function playerCacheKey(
  platform: "chess.com" | "lichess",
  username: string
): string {
  return `${platform}:${username.toLowerCase()}`;
}

export function getPlayerStats(key: string): PlayerStats | undefined {
  const entry = playerCache.get(key);
  if (!entry) return undefined;

  const age = Date.now() - entry.fetchedAt;
  if (age > config.cache.playerTtlMs) {
    playerCache.delete(key);
    return undefined;
  }

  return entry.stats;
}

export function setPlayerStats(key: string, stats: PlayerStats): void {
  playerCache.set(key, { stats, fetchedAt: Date.now() });
}
