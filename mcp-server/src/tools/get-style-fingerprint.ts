import { getAnalysesForUser } from "../store/analysis-store.js";
import { getGamesForUser } from "../store/game-store.js";
import { isDbConfigured } from "../store/db.js";
import {
  computeStyleFingerprint,
  deriveStyleLabel,
  buildStyleDescription,
  type GameDataForStyle,
} from "../intelligence/style-analyzer.js";
import type { GetStyleFingerprintInput, GetStyleFingerprintOutput } from "../types/index.js";

export async function handleGetStyleFingerprint(
  input: GetStyleFingerprintInput
): Promise<GetStyleFingerprintOutput> {
  if (!isDbConfigured()) {
    return {
      username: input.username,
      platform: input.platform,
      games_analyzed: 0,
      fingerprint: {
        aggression: 0,
        positional_sense: 0,
        tactical_sharpness: 0,
        endgame_skill: 0,
        time_management: null,
      },
      style_label: "Unknown",
      description: "",
      note: "DATABASE_URL is not configured. Run refresh_games to set up the game store first.",
    };
  }

  const limit = input.num_games ?? 50;

  const [analyses, games] = await Promise.all([
    getAnalysesForUser(input.platform, input.username, limit),
    getGamesForUser(input.platform, input.username, limit),
  ]);

  if (analyses.length === 0) {
    return {
      username: input.username,
      platform: input.platform,
      games_analyzed: 0,
      fingerprint: {
        aggression: 0,
        positional_sense: 0,
        tactical_sharpness: 0,
        endgame_skill: 0,
        time_management: null,
      },
      style_label: "Unknown",
      description: "",
      note: `Run refresh_games({ username: "${input.username}", platform: "${input.platform}" }) first to fetch and analyze your games.`,
    };
  }

  // Build lookup map for game metadata
  const gameMap = new Map(games.map((g) => [g.id, g]));

  // Build GameDataForStyle for each analyzed game
  const gameData: GameDataForStyle[] = [];
  const pgns: string[] = [];
  const timeControls: (string | null)[] = [];

  for (const analysis of analyses) {
    const meta = gameMap.get(Number(analysis.player_game_id));
    if (!meta) continue;

    const playerColor =
      (meta.player_color === "white" || meta.player_color === "black")
        ? meta.player_color
        : "white";

    gameData.push({
      moveRecords: Array.isArray(analysis.move_records) ? analysis.move_records : [],
      criticalMoments: Array.isArray(analysis.critical_moments) ? analysis.critical_moments : [],
      pgn: meta.pgn,
      playerColor,
      result: meta.result,
    });

    pgns.push(meta.pgn);
    timeControls.push(meta.time_control);
  }

  const isLichess = input.platform === "lichess";
  const fingerprint = computeStyleFingerprint(gameData, pgns, timeControls, isLichess);
  const styleLabel = deriveStyleLabel(fingerprint);
  const description = buildStyleDescription(fingerprint, styleLabel);

  // Detect low-coverage analyses: white_accuracy=0 AND black_accuracy=0 means
  // the engine wasn't available when the game was analyzed (all evals were zero).
  const lowCoverageCount = analyses.filter(
    (a) => (a.white_accuracy === null || a.white_accuracy === 0) &&
            (a.black_accuracy === null || a.black_accuracy === 0)
  ).length;
  const allLowCoverage = lowCoverageCount === analyses.length && analyses.length > 0;

  let note: string | undefined;
  if (allLowCoverage) {
    note = `All ${analyses.length} analyzed game(s) have zero accuracy scores, indicating the engine was not available when analysis ran. Wait 30–60s after server start and run refresh_games again for accurate style scores.`;
  } else if (!isLichess && fingerprint.time_management === null) {
    note = "time_management is not available for Chess.com games (no clock data in PGN).";
  }

  return {
    username: input.username,
    platform: input.platform,
    games_analyzed: gameData.length,
    fingerprint,
    style_label: styleLabel,
    description,
    ...(note !== undefined ? { note } : {}),
  };
}
