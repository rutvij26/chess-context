import { handleGetPlayerStats } from "./get-player-stats.js";
import type {
  ScoutOpponentInput,
  ScoutReport,
  PlayerStats,
  ExpectedOpening,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildExpectedOpenings(
  stats: PlayerStats,
  yourColor: "white" | "black"
): ExpectedOpening[] {
  // If you're white, opponent plays black — look at their black repertoire
  // If you're black, opponent plays white — look at their white repertoire
  const repertoire =
    yourColor === "white"
      ? [
          ...stats.opening_repertoire.as_black_vs_e4,
          ...stats.opening_repertoire.as_black_vs_d4,
        ]
      : stats.opening_repertoire.as_white;

  return repertoire
    .filter((o) => o.sample_size >= 2)
    .map((o) => ({
      opening: o.opening,
      frequency_percent: o.frequency,
      win_rate: o.win_rate,
      trend: "stable" as const, // Would need historical data to compute trend
    }))
    .sort((a, b) => b.frequency_percent - a.frequency_percent)
    .slice(0, 5);
}

function detectStrengths(stats: PlayerStats): string[] {
  const strengths: string[] = [];

  // Consistently high win rate
  if (stats.win_rate.overall >= 55) {
    strengths.push(`Strong overall win rate (${stats.win_rate.overall}%)`);
  }

  // Better as one color
  if (stats.win_rate.as_white >= 58) {
    strengths.push(`Strong results as White (${stats.win_rate.as_white}% win rate)`);
  }
  if (stats.win_rate.as_black >= 52) {
    strengths.push(`Solid results as Black (${stats.win_rate.as_black}% win rate)`);
  }

  // Rising form
  if (stats.recent_form.rating_trend === "rising") {
    strengths.push(
      `Currently in good form — ${stats.recent_form.wins}W/${stats.recent_form.draws}D/${stats.recent_form.losses}L in last ${stats.recent_form.last_n_games} games`
    );
  }

  // Dominant opening in repertoire
  const dominantWhiteOpening = stats.opening_repertoire.as_white[0];
  if (dominantWhiteOpening && dominantWhiteOpening.win_rate >= 58 && dominantWhiteOpening.sample_size >= 5) {
    strengths.push(
      `High win rate with ${dominantWhiteOpening.opening} as White (${dominantWhiteOpening.win_rate}%)`
    );
  }

  if (strengths.length === 0) {
    strengths.push("No dominant strengths detected from available data");
  }

  return strengths;
}

function detectWeaknesses(stats: PlayerStats): string[] {
  const weaknesses: string[] = [];

  // Weaker as one color
  if (stats.win_rate.as_black < 45) {
    weaknesses.push(
      `Struggles as Black — only ${stats.win_rate.as_black}% win rate`
    );
  }
  if (stats.win_rate.as_white < 48) {
    weaknesses.push(
      `Below-average results as White — only ${stats.win_rate.as_white}% win rate`
    );
  }

  // Falling form
  if (stats.recent_form.rating_trend === "falling") {
    weaknesses.push(
      `Recent form is poor — ${stats.recent_form.wins}W/${stats.recent_form.draws}D/${stats.recent_form.losses}L in last ${stats.recent_form.last_n_games} games`
    );
  }

  // Low-win-rate openings they play frequently
  const allOpenings = [
    ...stats.opening_repertoire.as_white,
    ...stats.opening_repertoire.as_black_vs_e4,
    ...stats.opening_repertoire.as_black_vs_d4,
  ];
  const problematicOpening = allOpenings.find(
    (o) => o.win_rate < 40 && o.sample_size >= 4 && o.frequency >= 15
  );
  if (problematicOpening) {
    weaknesses.push(
      `Poor results with ${problematicOpening.opening} (${problematicOpening.win_rate}% win rate in ${problematicOpening.sample_size} games)`
    );
  }

  if (weaknesses.length === 0) {
    weaknesses.push("No significant weaknesses detected from available data");
  }

  return weaknesses;
}

function buildStrategicRecommendation(
  stats: PlayerStats,
  yourColor: "white" | "black",
  expectedOpenings: ExpectedOpening[]
): string {
  const recommendations: string[] = [];

  // If they have a dominant opening, prepare specifically for it
  const topOpening = expectedOpenings[0];
  if (topOpening && topOpening.frequency_percent >= 50) {
    recommendations.push(
      `Prepare specifically for their most frequent opening (${topOpening.opening}, played ${topOpening.frequency_percent}% of games).`
    );
  }

  // Exploit color weaknesses
  if (yourColor === "black" && stats.win_rate.as_white < 52) {
    recommendations.push(
      "Your opponent is not particularly strong as White — play solidly and wait for their mistakes."
    );
  }
  if (yourColor === "white" && stats.win_rate.as_black < 48) {
    recommendations.push(
      "Your opponent struggles as Black — play actively and aim for an initiative early."
    );
  }

  // Exploit falling form
  if (stats.recent_form.rating_trend === "falling") {
    recommendations.push(
      "They are in poor recent form — play confidently and create complications."
    );
  }

  // Generic advice if nothing specific
  if (recommendations.length === 0) {
    recommendations.push(
      "Your opponent appears well-rounded. Focus on your own preparation rather than specific exploitation."
    );
  }

  return recommendations.join(" ");
}

function buildOpeningSuggestion(
  stats: PlayerStats,
  yourColor: "white" | "black",
  expectedOpenings: ExpectedOpening[]
): string {
  if (yourColor === "white") {
    // Look at opponent's black repertoire to suggest what to avoid or target
    const topBlackOpening = expectedOpenings[0];
    if (!topBlackOpening) {
      return "No strong opening preference detected for your opponent as Black. Play your usual repertoire.";
    }

    const lowWin = topBlackOpening.win_rate < 45;
    if (lowWin) {
      return `Consider steering toward ${topBlackOpening.opening} lines where your opponent has a ${topBlackOpening.win_rate}% win rate — they may be uncomfortable there.`;
    }
    return `Your opponent frequently plays ${topBlackOpening.opening} as Black (${topBlackOpening.win_rate}% win rate). Consider a sideline or anti-system if you want to avoid their preparation.`;
  } else {
    // Opponent plays white — look at their white repertoire
    const topWhiteOpening = stats.opening_repertoire.as_white[0];
    if (!topWhiteOpening) {
      return "No dominant first move detected for your opponent. Prepare your main black repertoire.";
    }
    return `Your opponent most often plays ${topWhiteOpening.opening} as White. Prepare your response to this system carefully.`;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleScoutOpponent(
  input: ScoutOpponentInput
): Promise<ScoutReport> {
  const stats = await handleGetPlayerStats({
    username: input.opponent_username,
    platform: input.platform,
  });

  const expectedOpenings = buildExpectedOpenings(stats, input.your_color);
  const strengths = detectStrengths(stats);
  const weaknesses = detectWeaknesses(stats);
  const strategicRecommendation = buildStrategicRecommendation(
    stats,
    input.your_color,
    expectedOpenings
  );
  const openingSuggestion = buildOpeningSuggestion(
    stats,
    input.your_color,
    expectedOpenings
  );

  return {
    opponent_profile: stats,
    expected_openings: expectedOpenings,
    strengths,
    weaknesses,
    strategic_recommendation: strategicRecommendation,
    opening_suggestion: openingSuggestion,
  };
}
