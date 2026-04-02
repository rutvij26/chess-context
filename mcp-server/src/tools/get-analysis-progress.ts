import { isDbConfigured } from "../store/db.js";
import { getQueueStatusForUser, countAnalysesForUser } from "../store/analysis-store.js";
import { getGameIdsForUser } from "../store/game-store.js";
import type { GetAnalysisProgressInput, GetAnalysisProgressOutput } from "../types/index.js";

export async function handleGetAnalysisProgress(
  input: GetAnalysisProgressInput
): Promise<GetAnalysisProgressOutput> {
  if (!isDbConfigured()) {
    return {
      username: input.username,
      platform: input.platform,
      total_games: 0,
      analyzed: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      progress_pct: 0,
      status: "no_games",
      summary: "DATABASE_URL is not configured. Run refresh_games to set up the game store first.",
    };
  }

  const [queueRows, analyzed, storedIds] = await Promise.all([
    getQueueStatusForUser(input.platform, input.username),
    countAnalysesForUser(input.platform, input.username),
    getGameIdsForUser(input.platform, input.username),
  ]);

  const total = storedIds.length;

  if (total === 0) {
    return {
      username: input.username,
      platform: input.platform,
      total_games: 0,
      analyzed: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      progress_pct: 0,
      status: "no_games",
      summary: `No games found for ${input.username} on ${input.platform}. Run refresh_games first.`,
    };
  }

  const byStatus = Object.fromEntries(queueRows.map((r) => [r.status, r.count]));
  const pending = byStatus["pending"] ?? 0;
  const processing = byStatus["processing"] ?? 0;
  const failed = byStatus["failed"] ?? 0;

  const progress_pct = total > 0 ? Math.round((analyzed / total) * 100) : 0;

  const status: GetAnalysisProgressOutput["status"] =
    processing > 0 ? "processing"
    : pending > 0 ? "processing"
    : analyzed >= total ? "complete"
    : "idle";

  const summary =
    status === "complete"
      ? `All ${analyzed} games analyzed and ready. You can now run get_mistake_patterns or get_style_fingerprint.`
      : status === "processing"
      ? `${analyzed}/${total} games analyzed (${progress_pct}%). ${pending + processing} still in queue — check back in a moment.`
      : failed > 0
      ? `${analyzed}/${total} games analyzed. ${failed} failed — try running refresh_games again.`
      : `${analyzed}/${total} games analyzed (${progress_pct}%).`;

  return {
    username: input.username,
    platform: input.platform,
    total_games: total,
    analyzed,
    pending,
    processing,
    failed,
    progress_pct,
    status,
    summary,
  };
}
