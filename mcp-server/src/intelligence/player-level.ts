import type { PlayerLevel, PhaseGrade } from "../types/index.js";
import type { CriticalMoment, GameAnalysis } from "../types/index.js";

// ---------------------------------------------------------------------------
// Level detection
// ---------------------------------------------------------------------------

export function detectPlayerLevel(rating: number): PlayerLevel {
  if (rating < 1000) return "beginner";
  if (rating <= 1800) return "club";
  return "advanced";
}

// ---------------------------------------------------------------------------
// Accuracy → grade mapping
// ---------------------------------------------------------------------------

export function accuracyToGrade(accuracy: number): PhaseGrade {
  if (accuracy >= 90) return "A";
  if (accuracy >= 80) return "B";
  if (accuracy >= 70) return "C";
  if (accuracy >= 60) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// Phase accuracy estimation
// ---------------------------------------------------------------------------

/** Estimate opening accuracy from critical moments in moves 1-12. */
export function openingAccuracy(
  moments: CriticalMoment[],
  totalMoves: number,
  color: "white" | "black"
): number {
  const openingMoments = moments.filter(
    (m) => m.color === color && m.move_number <= 12
  );
  const openingTotal = Math.max(1, Math.min(12, Math.ceil(totalMoves / 2)));
  if (openingMoments.length === 0) return 95;
  // Each blunder/mistake reduces accuracy
  const penaltySum = openingMoments.reduce((sum, m) => {
    if (m.category === "blunder") return sum + 30;
    if (m.category === "mistake") return sum + 15;
    if (m.category === "inaccuracy") return sum + 5;
    return sum;
  }, 0);
  return Math.max(0, 100 - penaltySum / openingTotal * 10);
}

/** Estimate middlegame accuracy from critical moments in moves 13-30. */
export function middlegameAccuracy(
  moments: CriticalMoment[],
  totalMoves: number,
  color: "white" | "black"
): number {
  const mgMoments = moments.filter(
    (m) => m.color === color && m.move_number > 12 && m.move_number < 30
  );
  const mgTotal = Math.max(1, Math.min(18, Math.ceil(totalMoves / 2)));
  if (mgMoments.length === 0) return 90;
  const penaltySum = mgMoments.reduce((sum, m) => {
    if (m.category === "blunder") return sum + 25;
    if (m.category === "mistake") return sum + 12;
    if (m.category === "inaccuracy") return sum + 4;
    return sum;
  }, 0);
  return Math.max(0, 100 - penaltySum / mgTotal * 8);
}

/** Estimate endgame accuracy from critical moments at move 30+. */
export function endgameAccuracy(
  moments: CriticalMoment[],
  totalMoves: number,
  color: "white" | "black"
): number | null {
  if (totalMoves < 30) return null;
  const egMoments = moments.filter(
    (m) => m.color === color && m.move_number >= 30
  );
  if (egMoments.length === 0) return 90;
  const penaltySum = egMoments.reduce((sum, m) => {
    if (m.category === "blunder") return sum + 25;
    if (m.category === "mistake") return sum + 12;
    if (m.category === "inaccuracy") return sum + 4;
    return sum;
  }, 0);
  const egTotal = Math.max(1, totalMoves - 30);
  return Math.max(0, 100 - penaltySum / egTotal * 8);
}

// ---------------------------------------------------------------------------
// Study recommendations (template-based)
// ---------------------------------------------------------------------------

export function buildStudyRecommendations(
  analysis: GameAnalysis,
  color: "white" | "black",
  level: PlayerLevel
): string[] {
  const recs: string[] = [];
  const moments = analysis.critical_moments.filter((m) => m.color === color);
  const cats = analysis.summary.mistake_categories;

  if (cats.opening > 0) {
    recs.push(
      level === "beginner"
        ? "Study basic opening principles: control the center, develop knights and bishops early."
        : level === "club"
        ? "Review your opening preparation — you lost ground in the first 12 moves."
        : "Analyze your opening preparation with a database — you deviated from best play early."
    );
  }

  const blunders = moments.filter((m) => m.category === "blunder");
  if (blunders.length > 0) {
    recs.push(
      level === "beginner"
        ? "Before every move, check if your pieces are safe and if your opponent has any threats."
        : level === "club"
        ? "Practice tactics puzzles to avoid missing simple threats — you had a blunder this game."
        : `Train pattern recognition for ${blunders[0]?.explanation.split(" ")[0] ?? "tactical"} patterns.`
    );
  }

  const endgameMistakes = moments.filter((m) => m.move_number >= 30);
  if (endgameMistakes.length > 0 && analysis.summary.total_moves >= 30) {
    recs.push(
      level === "beginner"
        ? "Practice basic endgames: king and pawn vs king is a great starting point."
        : level === "club"
        ? "Study rook and pawn endgame technique — accuracy dropped in the endgame phase."
        : "Review endgame conversion technique — precision is critical in technical positions."
    );
  }

  return recs.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Narrative adaptation by level
// ---------------------------------------------------------------------------

export function filterMomentsForLevel(
  moments: CriticalMoment[],
  level: PlayerLevel
): CriticalMoment[] {
  if (level === "beginner") {
    // Only show blunders — beginners don't need subtle inaccuracies
    return moments.filter(
      (m) => m.category === "blunder" || m.category === "missed_win"
    );
  }
  if (level === "club") {
    // Show mistakes and above
    return moments.filter(
      (m) =>
        m.category === "blunder" ||
        m.category === "mistake" ||
        m.category === "missed_win"
    );
  }
  // Advanced: show everything
  return moments;
}
