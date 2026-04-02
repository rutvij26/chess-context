import { getAnalysesForUser } from "../store/analysis-store.js";
import { getGamesForUser } from "../store/game-store.js";
import { isDbConfigured } from "../store/db.js";
import { detectMistakePatterns } from "../intelligence/pattern-scanner.js";
import type { GetMistakePatternsInput, GetMistakePatternsOutput } from "../types/index.js";

export async function handleGetMistakePatterns(
  input: GetMistakePatternsInput
): Promise<GetMistakePatternsOutput> {
  if (!isDbConfigured()) {
    return {
      username: input.username,
      games_analyzed: 0,
      games_available: 0,
      patterns: [],
      overall_summary: "",
      note: "DATABASE_URL is not configured. Run refresh_games to set up the game store first.",
    };
  }

  const limit = input.num_games ?? 20;

  // Fetch stored analyses
  const analyses = await getAnalysesForUser(input.platform, input.username, limit);
  const games = await getGamesForUser(input.platform, input.username, limit);

  if (analyses.length === 0) {
    return {
      username: input.username,
      games_analyzed: 0,
      games_available: 0,
      patterns: [],
      overall_summary: "No analyzed games found.",
      note: `Run refresh_games({ username: "${input.username}", platform: "${input.platform}" }) first to fetch and analyze your games.`,
    };
  }

  // Build GameMeta from player_games table, keyed by player_game_id
  const gameMap = new Map(games.map((g) => [g.id, g]));

  // Filter analyses by time_control if requested
  const filteredAnalyses = input.time_control
    ? analyses.filter((a) => {
        const meta = gameMap.get(Number(a.player_game_id));
        return meta?.time_control?.toLowerCase().includes(input.time_control!) ?? false;
      })
    : analyses;

  if (filteredAnalyses.length === 0) {
    return {
      username: input.username,
      games_analyzed: 0,
      games_available: analyses.length,
      patterns: [],
      overall_summary: `No analyzed games found for time control: ${input.time_control ?? "any"}.`,
    };
  }

  // Determine player color from most frequent color in stored games
  const whiteCounts = filteredAnalyses.filter(
    (a) => gameMap.get(Number(a.player_game_id))?.player_color === "white"
  ).length;
  const color = whiteCounts >= filteredAnalyses.length / 2 ? "white" : "black";

  // Extract move records and critical moments
  const allMoveRecords = filteredAnalyses.map((a) => Array.isArray(a.move_records) ? a.move_records : []);
  const allMoments = filteredAnalyses.map((a) => Array.isArray(a.critical_moments) ? a.critical_moments : []);
  const gameMetas = filteredAnalyses.map((a) => {
    const meta = gameMap.get(Number(a.player_game_id));
    return {
      opening_eco: meta?.opening_eco ?? null,
      opening_name: meta?.opening_name ?? null,
      player_color: meta?.player_color ?? null,
      result: meta?.result ?? null,
    };
  });

  const patterns = detectMistakePatterns(allMoveRecords, allMoments, gameMetas, color);

  const totalBlunders = allMoments.flat().filter(
    (m) => m.color === color && m.category === "blunder"
  ).length;
  const totalMistakes = allMoments.flat().filter(
    (m) => m.color === color && m.category === "mistake"
  ).length;

  const summary =
    patterns.length === 0
      ? `Analyzed ${filteredAnalyses.length} games. No recurring patterns detected — your mistakes appear varied rather than systematic. Keep playing and run again after more games.`
      : `Analyzed ${filteredAnalyses.length} games: ${totalBlunders} blunder${totalBlunders !== 1 ? "s" : ""} and ${totalMistakes} mistake${totalMistakes !== 1 ? "s" : ""} detected. Found ${patterns.length} recurring pattern${patterns.length !== 1 ? "s" : ""} — the top priority is "${patterns[0]!.pattern_type.replace(/_/g, " ")}".`;

  return {
    username: input.username,
    games_analyzed: filteredAnalyses.length,
    games_available: analyses.length,
    patterns,
    overall_summary: summary,
  };
}
