import { handleAnalyzeGame } from "./analyze-game.js";
import { buildPlayerStats as chesscomStats } from "../data/chesscom-api.js";
import { buildPlayerStats as lichessStats } from "../data/lichess-api.js";
import {
  detectPlayerLevel,
  accuracyToGrade,
  openingAccuracy,
  middlegameAccuracy,
  endgameAccuracy,
  buildStudyRecommendations,
  filterMomentsForLevel,
} from "../intelligence/player-level.js";
import type {
  ReviewGameInput,
  ReviewGameOutput,
  PlayerLevel,
  PhaseGrade,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectColor(
  analysis: Awaited<ReturnType<typeof handleAnalyzeGame>>,
  username: string
): "white" | "black" {
  const usernameLC = username.toLowerCase();
  if (analysis.game_info.white.toLowerCase() === usernameLC) return "white";
  if (analysis.game_info.black.toLowerCase() === usernameLC) return "black";
  // Default to white if username doesn't match either player
  return "white";
}

function detectResult(
  result: string,
  color: "white" | "black"
): "win" | "loss" | "draw" {
  if (result === "1/2-1/2") return "draw";
  if (result === "1-0") return color === "white" ? "win" : "loss";
  if (result === "0-1") return color === "black" ? "win" : "loss";
  return "draw";
}

async function fetchPlayerRating(
  username: string,
  platform: "chess.com" | "lichess"
): Promise<number | null> {
  try {
    const stats =
      platform === "chess.com"
        ? await chesscomStats(username)
        : await lichessStats(username);

    // Use the best available rating (prefer rapid > blitz > bullet)
    return (
      stats.ratings.rapid?.current ??
      stats.ratings.blitz?.current ??
      stats.ratings.bullet?.current ??
      stats.ratings.classical?.current ??
      null
    );
  } catch {
    return null;
  }
}

function buildNarrative(
  analysis: Awaited<ReturnType<typeof handleAnalyzeGame>>,
  color: "white" | "black",
  result: "win" | "loss" | "draw",
  level: PlayerLevel
): string {
  const { game_info, summary, critical_moments } = analysis;
  const blunders = critical_moments.filter(
    (m) => m.color === color && m.category === "blunder"
  ).length;
  const opponentColor = color === "white" ? "black" : "white";
  const playerAccuracy =
    color === "white" ? summary.white_accuracy : summary.black_accuracy;

  const resultStr =
    result === "win" ? "won" : result === "loss" ? "lost" : "drew";

  const opener =
    game_info.opening !== "Unknown" && game_info.opening !== "?"
      ? level === "beginner"
        ? `You played ${game_info.opening}.`
        : `${game_info.opening}.`
      : "The game began.";

  const accuracyStr =
    playerAccuracy > 0
      ? ` Your accuracy was ${playerAccuracy.toFixed(1)}%.`
      : "";

  const blunderStr =
    blunders > 0
      ? level === "beginner"
        ? ` Watch out — you made ${blunders} blunder${blunders > 1 ? "s" : ""} that gave away material or a decisive advantage.`
        : ` You made ${blunders} blunder${blunders > 1 ? "s" : ""}.`
      : "";

  const opponentBlunders = critical_moments.filter(
    (m) => m.color === opponentColor && m.category === "blunder"
  ).length;

  const opponentStr =
    opponentBlunders > 0
      ? ` Your opponent made ${opponentBlunders} blunder${opponentBlunders > 1 ? "s" : ""}.`
      : "";

  return `${opener} You ${resultStr} this game.${accuracyStr}${blunderStr}${opponentStr}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleReviewGame(
  input: ReviewGameInput
): Promise<ReviewGameOutput> {
  // Run game analysis
  const analysis = await handleAnalyzeGame({
    pgn: input.pgn,
    game_url: input.game_url,
    lichess_id: input.lichess_id,
    username:
      input.platform === "chess.com" ? input.player_username : undefined,
  });

  const color = detectColor(analysis, input.player_username);
  const result = detectResult(analysis.game_info.result, color);

  // Fetch player rating for level detection (non-blocking, fallback to club if unavailable)
  const rating = await fetchPlayerRating(input.player_username, input.platform);
  const level: PlayerLevel = rating !== null ? detectPlayerLevel(rating) : "club";

  const playerAccuracy =
    color === "white"
      ? analysis.summary.white_accuracy
      : analysis.summary.black_accuracy;

  // Phase performance
  const totalMoves = analysis.summary.total_moves;
  const moments = analysis.critical_moments;

  const opAccuracy = openingAccuracy(moments, totalMoves, color);
  const mgAccuracy = middlegameAccuracy(moments, totalMoves, color);
  const egAccuracyVal = endgameAccuracy(moments, totalMoves, color);

  type PhasePerf = { assessment: string; grade: PhaseGrade };
  const phasePerformance: ReviewGameOutput["phase_performance"] = {
    opening: {
      assessment: analysis.summary.phase_breakdown.opening.assessment,
      grade: accuracyToGrade(opAccuracy),
    },
    middlegame: {
      assessment: analysis.summary.phase_breakdown.middlegame.assessment,
      grade: accuracyToGrade(mgAccuracy),
    },
  };

  if (egAccuracyVal !== null && analysis.summary.phase_breakdown.endgame) {
    const egPhase: PhasePerf = {
      assessment: analysis.summary.phase_breakdown.endgame.assessment,
      grade: accuracyToGrade(egAccuracyVal),
    };
    phasePerformance.endgame = egPhase;
  }

  // Turning point: largest eval drop for the player's color
  const playerMoments = filterMomentsForLevel(
    moments.filter((m) => m.color === color),
    level
  );
  const turningPoint =
    playerMoments.length > 0
      ? playerMoments.reduce((worst, m) =>
          m.eval_drop_cp > worst.eval_drop_cp ? m : worst
        )
      : null;

  const turningPointOut = turningPoint
    ? {
        move_number: turningPoint.move_number,
        description: turningPoint.explanation,
        eval_swing_cp: turningPoint.eval_drop_cp,
      }
    : null;

  // Study recommendations
  const studyRecs = buildStudyRecommendations(analysis, color, level);

  // Narrative
  const narrative = buildNarrative(analysis, color, result, level);

  // Board data: use the game board from analysis but orient to the player's color.
  const boardData = analysis.board_data
    ? { ...analysis.board_data, meta: { ...analysis.board_data.meta, orientation: color } }
    : null;

  return {
    player: input.player_username,
    player_level: level,
    result,
    accuracy: playerAccuracy,
    turning_point: turningPointOut,
    phase_performance: phasePerformance,
    study_recommendations: studyRecs,
    narrative,
    board_data: boardData,
  };
}
