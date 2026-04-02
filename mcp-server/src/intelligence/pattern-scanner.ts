import type { MistakePattern } from "../types/index.js";
import type { MoveRecord } from "./critical-moments.js";
import type { CriticalMoment } from "../types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameMeta {
  opening_eco: string | null;
  opening_name: string | null;
  player_color: string | null;
  result: string | null;
}

// ---------------------------------------------------------------------------
// Pattern detection helpers
// ---------------------------------------------------------------------------

/**
 * Blunders concentrated in moves 30–50 — proxy for time pressure (low clock).
 */
function detectBlunderClusterTimePressure(
  allMoments: CriticalMoment[][],
  color: "white" | "black"
): MistakePattern | null {
  let gamesWithPattern = 0;
  let totalBlunders = 0;
  let exampleIdx: number | undefined;

  for (let i = 0; i < allMoments.length; i++) {
    const moments = allMoments[i]!;
    const lateBlunders = moments.filter(
      (m) => m.color === color && m.category === "blunder" && m.move_number >= 30 && m.move_number <= 50
    );
    const earlyBlunders = moments.filter(
      (m) => m.color === color && m.category === "blunder" && m.move_number < 30
    );

    if (lateBlunders.length > earlyBlunders.length && lateBlunders.length >= 1) {
      gamesWithPattern++;
      totalBlunders += lateBlunders.length;
      if (exampleIdx === undefined) exampleIdx = i;
    }
  }

  if (gamesWithPattern < 2) return null;

  return {
    pattern_type: "blunder_cluster_time_pressure",
    frequency: gamesWithPattern,
    phase: "middlegame",
    description:
      `You blundered ${totalBlunders} times across ${gamesWithPattern} games in moves 30–50, ` +
      "typically when the clock is low. Your accuracy drops significantly under time pressure.",
    ...(exampleIdx !== undefined ? { example_game_index: exampleIdx } : {}),
    suggested_study:
      "Practice time management — make faster, simpler moves when low on time. " +
      "Solve 1-minute tactical puzzles to speed up threat detection.",
  };
}

/**
 * Consistent advantage loss in the opening phase (moves 1–15).
 */
function detectOpeningPreparationGap(
  allMoments: CriticalMoment[][],
  gameMetas: GameMeta[],
  color: "white" | "black"
): MistakePattern | null {
  // Group by ECO code
  const ecoGroups = new Map<string, { count: number; losses: number; exampleIdx: number }>();

  for (let i = 0; i < allMoments.length; i++) {
    const moments = allMoments[i]!;
    const meta = gameMetas[i];
    const eco = meta?.opening_eco ?? "unknown";

    const openingMistakes = moments.filter(
      (m) => m.color === color && m.move_number <= 15 &&
        (m.category === "blunder" || m.category === "mistake")
    );

    if (openingMistakes.length > 0) {
      const existing = ecoGroups.get(eco);
      if (existing) {
        existing.count++;
        existing.losses++;
      } else {
        ecoGroups.set(eco, { count: 1, losses: 1, exampleIdx: i });
      }
    }
  }

  // Find ECO codes with ≥ 3 opening mistakes
  let maxLosses = 0;
  let worstEco = "";
  let exampleIdx: number | undefined;

  for (const [eco, data] of ecoGroups) {
    if (data.losses > maxLosses) {
      maxLosses = data.losses;
      worstEco = eco;
      exampleIdx = data.exampleIdx;
    }
  }

  const totalGamesWithOpeningMistakes = [...ecoGroups.values()].reduce((s, v) => s + v.losses, 0);

  if (totalGamesWithOpeningMistakes < 3) return null;

  const ecoLabel = worstEco !== "unknown" ? ` (${worstEco})` : "";

  return {
    pattern_type: "opening_preparation_gap",
    frequency: totalGamesWithOpeningMistakes,
    phase: "opening",
    description:
      `You consistently lose opening advantage — ${totalGamesWithOpeningMistakes} games had mistakes ` +
      `in the first 15 moves${ecoLabel}. Your preparation runs out early and you begin improvising.`,
    ...(exampleIdx !== undefined ? { example_game_index: exampleIdx } : {}),
    suggested_study:
      "Study the first 10–15 moves of your main openings with an opening book or database. " +
      "Focus on understanding plans, not memorizing moves.",
  };
}

/**
 * Winning or drawn endgame positions converted incorrectly.
 */
function detectEndgameTechniqueIssue(
  allMoments: CriticalMoment[][],
  allMoveRecords: MoveRecord[][],
  gameMetas: GameMeta[],
  color: "white" | "black"
): MistakePattern | null {
  let gamesWithPattern = 0;
  let exampleIdx: number | undefined;

  for (let i = 0; i < allMoveRecords.length; i++) {
    const records = allMoveRecords[i]!;
    const meta = gameMetas[i];
    if (!meta) continue;

    // Check if player was winning in endgame (eval > +150cp at move 30+)
    const isTargetColor = color === "white";
    const endgameRecords = records.filter((r) => r.moveNumber >= 30);

    if (endgameRecords.length === 0) continue;

    // Player had advantage in endgame
    const hadAdvantage = endgameRecords.some((r) => {
      const eval_ = isTargetColor ? r.evalBefore : -r.evalBefore;
      return eval_ > 150;
    });

    if (!hadAdvantage) continue;

    // But result was not a win
    const colorWin = color === "white" ? "1-0" : "0-1";
    const didNotWin = meta.result !== colorWin;

    if (didNotWin) {
      gamesWithPattern++;
      if (exampleIdx === undefined) exampleIdx = i;
    }
  }

  if (gamesWithPattern < 2) return null;

  return {
    pattern_type: "endgame_technique",
    frequency: gamesWithPattern,
    phase: "endgame",
    description:
      `You had a winning or dominant endgame position in ${gamesWithPattern} games but failed to convert. ` +
      "Endgame technique needs attention — advantageous positions are slipping away.",
    ...(exampleIdx !== undefined ? { example_game_index: exampleIdx } : {}),
    suggested_study:
      "Study fundamental endgames: king and pawn, rook endgames, and bishop vs knight. " +
      "Silman's Endgame Course or Karsten Müller's videos are excellent resources.",
  };
}

/**
 * Repeated material loss (hanging pieces) — large eval drops in middlegame.
 */
function detectHangingPieces(
  allMoments: CriticalMoment[][],
  color: "white" | "black"
): MistakePattern | null {
  let gamesWithPattern = 0;
  let totalHangers = 0;
  let exampleIdx: number | undefined;

  for (let i = 0; i < allMoments.length; i++) {
    const moments = allMoments[i]!;
    const hangings = moments.filter(
      (m) =>
        m.color === color &&
        m.eval_drop_cp >= 300 &&
        m.move_number > 12 &&
        m.move_number < 30
    );

    if (hangings.length >= 1) {
      gamesWithPattern++;
      totalHangers += hangings.length;
      if (exampleIdx === undefined) exampleIdx = i;
    }
  }

  if (gamesWithPattern < 2) return null;

  return {
    pattern_type: "hanging_pieces",
    frequency: gamesWithPattern,
    phase: "middlegame",
    description:
      `You left pieces en prise or hanging in ${gamesWithPattern} games (${totalHangers} total instances), ` +
      "losing significant material in the middlegame. This is a consistent oversight pattern.",
    ...(exampleIdx !== undefined ? { example_game_index: exampleIdx } : {}),
    suggested_study:
      "Before every move, do a quick safety check: scan all your pieces and ask 'is each piece defended?' " +
      "Practice hanging piece puzzles (1-move tactics) to build this habit.",
  };
}

/**
 * Same opening repeatedly leading to poor positions.
 */
function detectRepeatedOpeningCollapse(
  allMoments: CriticalMoment[][],
  gameMetas: GameMeta[],
  color: "white" | "black"
): MistakePattern | null {
  const ecoProblems = new Map<string, { count: number; exampleIdx: number }>();

  for (let i = 0; i < allMoments.length; i++) {
    const moments = allMoments[i]!;
    const meta = gameMetas[i];
    const eco = meta?.opening_eco;
    if (!eco) continue;

    // Opening collapsed: eval below -100cp for target color by move 15
    const earlyDisadvantage = moments.some(
      (m) =>
        m.color === color &&
        m.move_number <= 15 &&
        (m.category === "blunder" || m.category === "mistake") &&
        m.eval_after_cp < -100 * (color === "white" ? 1 : -1)
    );

    if (earlyDisadvantage) {
      const existing = ecoProblems.get(eco);
      if (existing) {
        existing.count++;
      } else {
        ecoProblems.set(eco, { count: 1, exampleIdx: i });
      }
    }
  }

  // Find worst ECO
  let maxCount = 0;
  let worstEco = "";
  let exampleIdx: number | undefined;

  for (const [eco, data] of ecoProblems) {
    if (data.count > maxCount) {
      maxCount = data.count;
      worstEco = eco;
      exampleIdx = data.exampleIdx;
    }
  }

  if (maxCount < 3) return null;

  return {
    pattern_type: "repeated_opening_collapse",
    frequency: maxCount,
    phase: "opening",
    description:
      `The ${worstEco} opening has led to losing positions in ${maxCount} games. ` +
      "You're repeatedly entering this line unprepared and consistently ending up in trouble by move 15.",
    ...(exampleIdx !== undefined ? { example_game_index: exampleIdx } : {}),
    suggested_study:
      `Study the critical lines in your ${worstEco} games specifically. ` +
      "Consider switching to a different opening if the preparation burden is too high.",
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function detectMistakePatterns(
  allMoveRecords: MoveRecord[][],
  allMoments: CriticalMoment[][],
  gameMetas: GameMeta[],
  color: "white" | "black"
): MistakePattern[] {
  const patterns: MistakePattern[] = [];

  const p1 = detectBlunderClusterTimePressure(allMoments, color);
  if (p1) patterns.push(p1);

  const p2 = detectOpeningPreparationGap(allMoments, gameMetas, color);
  if (p2) patterns.push(p2);

  const p3 = detectEndgameTechniqueIssue(allMoments, allMoveRecords, gameMetas, color);
  if (p3) patterns.push(p3);

  const p4 = detectHangingPieces(allMoments, color);
  if (p4) patterns.push(p4);

  const p5 = detectRepeatedOpeningCollapse(allMoments, gameMetas, color);
  if (p5) patterns.push(p5);

  // Sort by frequency descending
  return patterns.sort((a, b) => b.frequency - a.frequency);
}
