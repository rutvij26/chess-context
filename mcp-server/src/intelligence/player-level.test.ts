import { describe, it, expect } from "vitest";
import {
  detectPlayerLevel,
  accuracyToGrade,
  openingAccuracy,
  middlegameAccuracy,
  endgameAccuracy,
  buildStudyRecommendations,
  filterMomentsForLevel,
} from "./player-level.js";
import type { CriticalMoment, GameAnalysis } from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMoment(
  overrides: Partial<CriticalMoment> & {
    move_number: number;
    color: "white" | "black";
    category: CriticalMoment["category"];
  }
): CriticalMoment {
  return {
    move_played: "e4",
    best_move: "e4",
    eval_before_cp: 0,
    eval_after_cp: 0,
    eval_drop_cp: 0,
    explanation: "Test move",
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<GameAnalysis> = {}): GameAnalysis {
  return {
    game_info: {
      white: "alice",
      black: "bob",
      result: "1-0",
      opening: "Sicilian Defense",
      time_control: "600+0",
      date: "2024.01.01",
      platform: "lichess",
    },
    summary: {
      total_moves: 40,
      white_accuracy: 85,
      black_accuracy: 72,
      phase_breakdown: {
        opening: { moves: "1-12", assessment: "Solid opening" },
        middlegame: { moves: "13-30", assessment: "Tactical middlegame" },
        endgame: { moves: "31-40", assessment: "Clean conversion" },
      },
      mistake_categories: { tactical: 1, strategic: 0, opening: 0, endgame: 0 },
    },
    critical_moments: [],
    patterns_detected: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectPlayerLevel
// ---------------------------------------------------------------------------

describe("detectPlayerLevel", () => {
  it("returns beginner for rating below 1000", () => {
    expect(detectPlayerLevel(999)).toBe("beginner");
    expect(detectPlayerLevel(0)).toBe("beginner");
    expect(detectPlayerLevel(500)).toBe("beginner");
  });

  it("returns beginner at boundary 999", () => {
    expect(detectPlayerLevel(999)).toBe("beginner");
  });

  it("returns club at boundary 1000", () => {
    expect(detectPlayerLevel(1000)).toBe("club");
  });

  it("returns club for rating between 1000 and 1800", () => {
    expect(detectPlayerLevel(1400)).toBe("club");
    expect(detectPlayerLevel(1800)).toBe("club");
  });

  it("returns advanced for rating above 1800", () => {
    expect(detectPlayerLevel(1801)).toBe("advanced");
    expect(detectPlayerLevel(2500)).toBe("advanced");
  });
});

// ---------------------------------------------------------------------------
// accuracyToGrade
// ---------------------------------------------------------------------------

describe("accuracyToGrade", () => {
  it("returns A for 90+", () => {
    expect(accuracyToGrade(90)).toBe("A");
    expect(accuracyToGrade(100)).toBe("A");
  });

  it("returns B for 80–89", () => {
    expect(accuracyToGrade(80)).toBe("B");
    expect(accuracyToGrade(89)).toBe("B");
  });

  it("returns C for 70–79", () => {
    expect(accuracyToGrade(70)).toBe("C");
    expect(accuracyToGrade(79)).toBe("C");
  });

  it("returns D for 60–69", () => {
    expect(accuracyToGrade(60)).toBe("D");
    expect(accuracyToGrade(69)).toBe("D");
  });

  it("returns F below 60", () => {
    expect(accuracyToGrade(59)).toBe("F");
    expect(accuracyToGrade(0)).toBe("F");
  });
});

// ---------------------------------------------------------------------------
// openingAccuracy
// ---------------------------------------------------------------------------

describe("openingAccuracy", () => {
  it("returns 95 when no opening moments", () => {
    expect(openingAccuracy([], 30, "white")).toBe(95);
  });

  it("reduces accuracy for blunders in moves 1-12", () => {
    const moments = [
      makeMoment({ move_number: 5, color: "white", category: "blunder" }),
    ];
    const acc = openingAccuracy(moments, 30, "white");
    expect(acc).toBeLessThan(95);
    expect(acc).toBeGreaterThanOrEqual(0);
  });

  it("does not count opponent moments", () => {
    const moments = [
      makeMoment({ move_number: 5, color: "black", category: "blunder" }),
    ];
    expect(openingAccuracy(moments, 30, "white")).toBe(95);
  });

  it("does not count moves after move 12", () => {
    const moments = [
      makeMoment({ move_number: 13, color: "white", category: "blunder" }),
    ];
    expect(openingAccuracy(moments, 30, "white")).toBe(95);
  });

  it("penalises mistakes less than blunders", () => {
    const blunderMoments = [
      makeMoment({ move_number: 5, color: "white", category: "blunder" }),
    ];
    const mistakeMoments = [
      makeMoment({ move_number: 5, color: "white", category: "mistake" }),
    ];
    const blunderAcc = openingAccuracy(blunderMoments, 30, "white");
    const mistakeAcc = openingAccuracy(mistakeMoments, 30, "white");
    expect(blunderAcc).toBeLessThan(mistakeAcc);
  });
});

// ---------------------------------------------------------------------------
// middlegameAccuracy
// ---------------------------------------------------------------------------

describe("middlegameAccuracy", () => {
  it("returns 90 when no middlegame moments", () => {
    expect(middlegameAccuracy([], 40, "white")).toBe(90);
  });

  it("reduces accuracy for blunders in moves 13-29", () => {
    const moments = [
      makeMoment({ move_number: 20, color: "white", category: "blunder" }),
    ];
    const acc = middlegameAccuracy(moments, 40, "white");
    expect(acc).toBeLessThan(90);
  });

  it("does not count moves in opening range", () => {
    const moments = [
      makeMoment({ move_number: 12, color: "white", category: "blunder" }),
    ];
    expect(middlegameAccuracy(moments, 40, "white")).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// endgameAccuracy
// ---------------------------------------------------------------------------

describe("endgameAccuracy", () => {
  it("returns null for short games under 30 moves", () => {
    expect(endgameAccuracy([], 29, "white")).toBeNull();
  });

  it("returns 90 when no endgame moments", () => {
    expect(endgameAccuracy([], 40, "white")).toBe(90);
  });

  it("reduces accuracy for blunders in move 30+", () => {
    // Two blunders in a short endgame (30 moves total → egTotal=1) triggers large penalty
    const moments = [
      makeMoment({ move_number: 30, color: "white", category: "blunder" }),
      makeMoment({ move_number: 31, color: "white", category: "blunder" }),
    ];
    const acc = endgameAccuracy(moments, 31, "white");
    expect(acc).not.toBeNull();
    expect(acc!).toBeLessThan(90);
  });
});

// ---------------------------------------------------------------------------
// buildStudyRecommendations
// ---------------------------------------------------------------------------

describe("buildStudyRecommendations", () => {
  it("returns empty array when no errors", () => {
    const analysis = makeAnalysis();
    const recs = buildStudyRecommendations(analysis, "white", "club");
    expect(recs).toHaveLength(0);
  });

  it("recommends opening study when opening category > 0", () => {
    const analysis = makeAnalysis({
      summary: {
        total_moves: 40,
        white_accuracy: 80,
        black_accuracy: 70,
        phase_breakdown: {
          opening: { moves: "1-12", assessment: "" },
          middlegame: { moves: "13-30", assessment: "" },
        },
        mistake_categories: { tactical: 0, strategic: 0, opening: 1, endgame: 0 },
      },
    });
    const recs = buildStudyRecommendations(analysis, "white", "club");
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]).toContain("opening");
  });

  it("recommends beginner opening advice for beginners", () => {
    const analysis = makeAnalysis({
      summary: {
        total_moves: 40,
        white_accuracy: 60,
        black_accuracy: 60,
        phase_breakdown: {
          opening: { moves: "1-12", assessment: "" },
          middlegame: { moves: "13-30", assessment: "" },
        },
        mistake_categories: { tactical: 0, strategic: 0, opening: 1, endgame: 0 },
      },
    });
    const recs = buildStudyRecommendations(analysis, "white", "beginner");
    expect(recs[0]).toContain("center");
  });

  it("includes blunder recommendation when blunders present", () => {
    const analysis = makeAnalysis({
      critical_moments: [
        makeMoment({ move_number: 20, color: "white", category: "blunder", explanation: "Nd4 blunder" }),
      ],
      summary: {
        total_moves: 40,
        white_accuracy: 70,
        black_accuracy: 70,
        phase_breakdown: {
          opening: { moves: "1-12", assessment: "" },
          middlegame: { moves: "13-30", assessment: "" },
        },
        mistake_categories: { tactical: 1, strategic: 0, opening: 0, endgame: 0 },
      },
    });
    const recs = buildStudyRecommendations(analysis, "white", "club");
    expect(recs.some((r) => r.toLowerCase().includes("tactic"))).toBe(true);
  });

  it("caps recommendations at 3", () => {
    const analysis = makeAnalysis({
      critical_moments: [
        makeMoment({ move_number: 5, color: "white", category: "blunder" }),
        makeMoment({ move_number: 35, color: "white", category: "mistake" }),
      ],
      summary: {
        total_moves: 40,
        white_accuracy: 50,
        black_accuracy: 70,
        phase_breakdown: {
          opening: { moves: "1-12", assessment: "" },
          middlegame: { moves: "13-30", assessment: "" },
          endgame: { moves: "31-40", assessment: "" },
        },
        mistake_categories: { tactical: 1, strategic: 0, opening: 1, endgame: 1 },
      },
    });
    const recs = buildStudyRecommendations(analysis, "white", "club");
    expect(recs.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// filterMomentsForLevel
// ---------------------------------------------------------------------------

describe("filterMomentsForLevel", () => {
  const moments: CriticalMoment[] = [
    makeMoment({ move_number: 5, color: "white", category: "brilliant" }),
    makeMoment({ move_number: 10, color: "white", category: "inaccuracy" }),
    makeMoment({ move_number: 15, color: "white", category: "mistake" }),
    makeMoment({ move_number: 20, color: "white", category: "blunder" }),
    makeMoment({ move_number: 25, color: "white", category: "missed_win" }),
  ];

  it("beginner: only shows blunders and missed wins", () => {
    const filtered = filterMomentsForLevel(moments, "beginner");
    expect(filtered.every((m) => m.category === "blunder" || m.category === "missed_win")).toBe(true);
    expect(filtered.length).toBe(2);
  });

  it("club: shows mistakes, blunders, and missed wins", () => {
    const filtered = filterMomentsForLevel(moments, "club");
    expect(filtered.every((m) => ["blunder", "mistake", "missed_win"].includes(m.category))).toBe(true);
    expect(filtered.length).toBe(3);
  });

  it("advanced: shows all moments", () => {
    const filtered = filterMomentsForLevel(moments, "advanced");
    expect(filtered).toHaveLength(moments.length);
  });
});
