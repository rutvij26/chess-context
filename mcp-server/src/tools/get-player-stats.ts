import { getPlayerStats, setPlayerStats, playerCacheKey } from "../cache/index.js";
import { buildPlayerStats as buildChessComStats } from "../data/chesscom-api.js";
import { buildPlayerStats as buildLichessStats } from "../data/lichess-api.js";
import type { GetPlayerStatsInput, PlayerStats } from "../types/index.js";

export async function handleGetPlayerStats(
  input: GetPlayerStatsInput
): Promise<PlayerStats> {
  const cacheKey = playerCacheKey(input.platform, input.username);
  const cached = getPlayerStats(cacheKey);
  if (cached) return cached;

  let stats: PlayerStats;

  if (input.platform === "chess.com") {
    stats = await buildChessComStats(input.username);
  } else {
    stats = await buildLichessStats(input.username);
  }

  setPlayerStats(cacheKey, stats);
  return stats;
}
