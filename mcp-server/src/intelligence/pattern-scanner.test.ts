import { describe, it, expect } from "vitest";
import { detectMistakePatterns } from "./pattern-scanner.js";
import type { MoveRecord } from "./critical-moments.js";
import type { CriticalMoment } from "../types/index.js";
import type { GameMeta } from "./pattern-scanner.js";

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
    eval_before_cp: 50,
    eval_after_cp: -200,
    eval_drop_cp: 250,
    explanation: "Test",
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<MoveRecord> & {
    moveNumber: number;
    color: "white" | "black";
    evalBefore: number;
    evalAfter: number;
  }
): MoveRecord {
  return {
    san: "e4",
    fenBefore: "fen",
    fenAfter: "fen2",
    bestMoveSan: "e4",
    ...overrides,
  };
}

function makeMeta(overrides: Partial<GameMeta> = {}): GameMeta {
  return {
    opening_eco: "B20",
    opening_name: "Sicilian",
    player_color: "white",
    result: "1-0",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// blunder_cluster_time_pressure
// ---------------------------------------------------------------------------

describe("detectMistakePatterns — blunder_cluster_time_pressure", () => {
  it("returns null when fewer than 2 games have the pattern", () => {
    const moments = [
      [makeMoment({ move_number: 35, color: "white", category: "blunder" })],
      [makeMoment({ move_number: 5, color: "white", category: "blunder" })],
    ];
    const patterns = detectMistakePatterns([[], []], moments, [makeMeta(), makeMeta()], "white");
    const p = patterns.find((x) => x.pattern_type === "blunder_cluster_time_pressure");
    expect(p).toBeUndefined();
  });

  it("detects pattern when ≥2 games have more late blunders than early", () => {
    const moments = [
      [makeMoment({ move_number: 35, color: "white", category: "blunder" })],
      [makeMoment({ move_number: 40, color: "white", category: "blunder" })],
      [makeMoment({ move_number: 45, color: "white", category: "blunder" })],
    ];
    const patterns = detectMistakePatterns([[], [], []], moments, [makeMeta(), makeMeta(), makeMeta()], "white");
    const p = patterns.find((x) => x.pattern_type === "blunder_cluster_time_pressure");
    expect(p).toBeDefined();
    expect(p!.frequency).toBe(3);
  });

  it("does not count opponent blunders", () => {
    const moments = [
      [makeMoment({ move_number: 35, color: "black", category: "blunder" })],
      [makeMoment({ move_number: 40, color: "black", category: "blunder" })],
    ];
    const patterns = detectMistakePatterns([[], []], moments, [makeMeta(), makeMeta()], "white");
    const p = patterns.find((x) => x.pattern_type === "blunder_cluster_time_pressure");
    expect(p).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// opening_preparation_gap
// ---------------------------------------------------------------------------

describe("detectMistakePatterns — opening_preparation_gap", () => {
  it("returns null when fewer than 3 games with opening mistakes", () => {
    const moments = [
      [makeMoment({ move_number: 8, color: "white", category: "mistake" })],
      [makeMoment({ move_number: 10, color: "white", category: "mistake" })],
    ];
    const patterns = detectMistakePatterns([[], []], moments, [makeMeta(), makeMeta()], "white");
    const p = patterns.find((x) => x.pattern_type === "opening_preparation_gap");
    expect(p).toBeUndefined();
  });

  it("detects pattern when ≥3 games have opening mistakes", () => {
    const moments = [
      [makeMoment({ move_number: 8, color: "white", category: "mistake" })],
      [makeMoment({ move_number: 10, color: "white", category: "blunder" })],
      [makeMoment({ move_number: 12, color: "white", category: "mistake" })],
    ];
    const patterns = detectMistakePatterns([[], [], []], moments, [makeMeta(), makeMeta(), makeMeta()], "white");
    const p = patterns.find((x) => x.pattern_type === "opening_preparation_gap");
    expect(p).toBeDefined();
  });

  it("does not count moves after move 15", () => {
    const moments = [
      [makeMoment({ move_number: 16, color: "white", category: "mistake" })],
      [makeMoment({ move_number: 20, color: "white", category: "blunder" })],
      [makeMoment({ move_number: 18, color: "white", category: "mistake" })],
    ];
    const patterns = detectMistakePatterns([[], [], []], moments, [makeMeta(), makeMeta(), makeMeta()], "white");
    const p = patterns.find((x) => x.pattern_type === "opening_preparation_gap");
    expect(p).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// endgame_technique
// ---------------------------------------------------------------------------

describe("detectMistakePatterns — endgame_technique", () => {
  it("detects pattern when player had advantage in endgame but failed to win", () => {
    const records = [
      [makeRecord({ moveNumber: 35, color: "white", evalBefore: 200, evalAfter: 150 })],
      [makeRecord({ moveNumber: 32, color: "white", evalBefore: 300, evalAfter: 200 })],
    ];
    const metas = [
      makeMeta({ result: "1/2-1/2" }), // had advantage but drew
      makeMeta({ result: "0-1" }),       // had advantage but lost
    ];
    const patterns = detectMistakePatterns(records, [[], []], metas, "white");
    const p = patterns.find((x) => x.pattern_type === "endgame_technique");
    expect(p).toBeDefined();
    expect(p!.frequency).toBe(2);
  });

  it("does not flag games where player won despite having advantage", () => {
    const records = [
      [makeRecord({ moveNumber: 35, color: "white", evalBefore: 200, evalAfter: 180 })],
      [makeRecord({ moveNumber: 32, color: "white", evalBefore: 300, evalAfter: 250 })],
    ];
    const metas = [
      makeMeta({ result: "1-0" }),
      makeMeta({ result: "1-0" }),
    ];
    const patterns = detectMistakePatterns(records, [[], []], metas, "white");
    const p = patterns.find((x) => x.pattern_type === "endgame_technique");
    expect(p).toBeUndefined();
  });

  it("returns null when fewer than 2 games match", () => {
    const records = [
      [makeRecord({ moveNumber: 35, color: "white", evalBefore: 200, evalAfter: 150 })],
    ];
    const metas = [makeMeta({ result: "0-1" })];
    const patterns = detectMistakePatterns(records, [[]], metas, "white");
    const p = patterns.find((x) => x.pattern_type === "endgame_technique");
    expect(p).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hanging_pieces
// ---------------------------------------------------------------------------

describe("detectMistakePatterns — hanging_pieces", () => {
  it("detects pattern when ≥2 games have large eval drops in middlegame", () => {
    const moments = [
      [makeMoment({ move_number: 20, color: "white", category: "blunder", eval_drop_cp: 350 })],
      [makeMoment({ move_number: 25, color: "white", category: "blunder", eval_drop_cp: 400 })],
    ];
    const patterns = detectMistakePatterns([[], []], moments, [makeMeta(), makeMeta()], "white");
    const p = patterns.find((x) => x.pattern_type === "hanging_pieces");
    expect(p).toBeDefined();
    expect(p!.frequency).toBe(2);
  });

  it("does not flag moves outside middlegame range (12-30)", () => {
    const moments = [
      [makeMoment({ move_number: 5, color: "white", category: "blunder", eval_drop_cp: 400 })],
      [makeMoment({ move_number: 35, color: "white", category: "blunder", eval_drop_cp: 400 })],
    ];
    const patterns = detectMistakePatterns([[], []], moments, [makeMeta(), makeMeta()], "white");
    const p = patterns.find((x) => x.pattern_type === "hanging_pieces");
    expect(p).toBeUndefined();
  });

  it("does not flag drops below 300cp threshold", () => {
    const moments = [
      [makeMoment({ move_number: 20, color: "white", category: "blunder", eval_drop_cp: 250 })],
      [makeMoment({ move_number: 25, color: "white", category: "blunder", eval_drop_cp: 280 })],
    ];
    const patterns = detectMistakePatterns([[], []], moments, [makeMeta(), makeMeta()], "white");
    const p = patterns.find((x) => x.pattern_type === "hanging_pieces");
    expect(p).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// repeated_opening_collapse
// ---------------------------------------------------------------------------

describe("detectMistakePatterns — repeated_opening_collapse", () => {
  it("detects pattern when same ECO leads to ≥3 early disadvantages", () => {
    const moments = [
      [makeMoment({ move_number: 10, color: "white", category: "blunder", eval_after_cp: -150 })],
      [makeMoment({ move_number: 12, color: "white", category: "mistake", eval_after_cp: -200 })],
      [makeMoment({ move_number: 8, color: "white", category: "blunder", eval_after_cp: -120 })],
    ];
    const metas = [
      makeMeta({ opening_eco: "B20" }),
      makeMeta({ opening_eco: "B20" }),
      makeMeta({ opening_eco: "B20" }),
    ];
    const patterns = detectMistakePatterns([[], [], []], moments, metas, "white");
    const p = patterns.find((x) => x.pattern_type === "repeated_opening_collapse");
    expect(p).toBeDefined();
    expect(p!.frequency).toBe(3);
  });

  it("returns null when max ECO count < 3", () => {
    const moments = [
      [makeMoment({ move_number: 10, color: "white", category: "blunder", eval_after_cp: -150 })],
      [makeMoment({ move_number: 12, color: "white", category: "mistake", eval_after_cp: -200 })],
    ];
    const metas = [makeMeta({ opening_eco: "B20" }), makeMeta({ opening_eco: "B20" })];
    const patterns = detectMistakePatterns([[], []], moments, metas, "white");
    const p = patterns.find((x) => x.pattern_type === "repeated_opening_collapse");
    expect(p).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sorting
// ---------------------------------------------------------------------------

describe("detectMistakePatterns — sorting", () => {
  it("sorts patterns by frequency descending", () => {
    // 3 games with time pressure + 3 with opening mistakes + 3 with hanging pieces
    const records3 = Array(3).fill([makeRecord({ moveNumber: 35, color: "white", evalBefore: 200, evalAfter: -200 })]);
    const moments = Array(3).fill([
      makeMoment({ move_number: 35, color: "white", category: "blunder", eval_drop_cp: 400 }),
      makeMoment({ move_number: 8, color: "white", category: "mistake", eval_after_cp: -150 }),
      makeMoment({ move_number: 20, color: "white", category: "blunder", eval_drop_cp: 400 }),
    ]);
    const metas = Array(3).fill(makeMeta({ opening_eco: "B20", result: "0-1" }));
    const patterns = detectMistakePatterns(records3, moments, metas, "white");
    for (let i = 1; i < patterns.length; i++) {
      expect(patterns[i - 1]!.frequency).toBeGreaterThanOrEqual(patterns[i]!.frequency);
    }
  });
});

// ---------------------------------------------------------------------------
// empty input
// ---------------------------------------------------------------------------

describe("detectMistakePatterns — empty input", () => {
  it("returns empty array for empty input", () => {
    expect(detectMistakePatterns([], [], [], "white")).toHaveLength(0);
  });
});
