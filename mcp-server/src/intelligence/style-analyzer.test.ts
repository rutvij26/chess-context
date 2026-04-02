import { describe, it, expect } from "vitest";
import {
  computeStyleFingerprint,
  deriveStyleLabel,
  buildStyleDescription,
  scoreTimeManagement,
  type GameDataForStyle,
} from "./style-analyzer.js";
import type { MoveRecord } from "./critical-moments.js";
import type { CriticalMoment } from "../types/index.js";

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

const SIMPLE_PGN = `[Event "Test"]
[Site "localhost"]
[Date "2024.01.01"]
[White "alice"]
[Black "bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 1-0`;

// ---------------------------------------------------------------------------
// scoreTimeManagement
// ---------------------------------------------------------------------------

describe("scoreTimeManagement", () => {
  it("returns null for Chess.com (not Lichess)", () => {
    expect(scoreTimeManagement([SIMPLE_PGN], ["600+0"], false)).toBeNull();
  });

  it("returns null when no clock annotations", () => {
    expect(scoreTimeManagement([SIMPLE_PGN], ["600+0"], true)).toBeNull();
  });

  it("returns null when time control is missing", () => {
    const pgnWithClocks = SIMPLE_PGN.replace(
      "1. e4",
      "1. e4 {[%clk 0:09:50]}"
    );
    expect(scoreTimeManagement([pgnWithClocks], [null], true)).toBeNull();
  });

  it("parses Lichess-style clock annotations and returns a percentage", () => {
    // Build a PGN with enough clock annotations (≥30) using Lichess format: { [%clk H:MM:SS] }
    let pgn = `[Event "Test"][White "a"][Black "b"][Result "1-0"]\n`;
    for (let i = 1; i <= 20; i++) {
      pgn += `${i}. e4 { [%clk 0:08:00] } e5 { [%clk 0:09:00] } `;
    }
    pgn += "1-0";
    const result = scoreTimeManagement([pgn], ["600+0"], true);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(0);
    expect(result!).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// deriveStyleLabel
// ---------------------------------------------------------------------------

describe("deriveStyleLabel", () => {
  it("returns Aggressive Tactician for high aggression + high tactical sharpness", () => {
    expect(deriveStyleLabel({ aggression: 75, positional_sense: 50, tactical_sharpness: 75, endgame_skill: 50, time_management: null })).toBe("Aggressive Tactician");
  });

  it("returns Dynamic Imbalance Seeker for high aggression + high positional sense", () => {
    expect(deriveStyleLabel({ aggression: 75, positional_sense: 75, tactical_sharpness: 50, endgame_skill: 50, time_management: null })).toBe("Dynamic Imbalance Seeker");
  });

  it("returns Sharp Gambiteer for high aggression only", () => {
    expect(deriveStyleLabel({ aggression: 75, positional_sense: 50, tactical_sharpness: 50, endgame_skill: 50, time_management: null })).toBe("Sharp Gambiteer");
  });

  it("returns Solid Positional Player for high positional + low aggression", () => {
    expect(deriveStyleLabel({ aggression: 30, positional_sense: 75, tactical_sharpness: 50, endgame_skill: 50, time_management: null })).toBe("Solid Positional Player");
  });

  it("returns Reactive Defender for low aggression + low tactical sharpness", () => {
    expect(deriveStyleLabel({ aggression: 30, positional_sense: 50, tactical_sharpness: 30, endgame_skill: 50, time_management: null })).toBe("Reactive Defender");
  });

  it("returns Balanced All-Rounder for mid scores", () => {
    expect(deriveStyleLabel({ aggression: 55, positional_sense: 55, tactical_sharpness: 55, endgame_skill: 55, time_management: null })).toBe("Balanced All-Rounder");
  });
});

// ---------------------------------------------------------------------------
// buildStyleDescription
// ---------------------------------------------------------------------------

describe("buildStyleDescription", () => {
  it("mentions aggressive play when aggression >= 70", () => {
    const fp = { aggression: 75, positional_sense: 50, tactical_sharpness: 50, endgame_skill: 50, time_management: null };
    const desc = buildStyleDescription(fp, "Sharp Gambiteer");
    expect(desc).toMatch(/aggressively/i);
  });

  it("mentions solid play when aggression < 40", () => {
    const fp = { aggression: 30, positional_sense: 75, tactical_sharpness: 50, endgame_skill: 50, time_management: null };
    const desc = buildStyleDescription(fp, "Solid Positional Player");
    expect(desc).toMatch(/solid/i);
  });

  it("mentions tactical sharpness when tactical_sharpness >= 70", () => {
    const fp = { aggression: 50, positional_sense: 50, tactical_sharpness: 75, endgame_skill: 50, time_management: null };
    const desc = buildStyleDescription(fp, "Balanced All-Rounder");
    expect(desc).toMatch(/tactical/i);
  });

  it("mentions endgame improvement when endgame_skill < 40", () => {
    const fp = { aggression: 50, positional_sense: 50, tactical_sharpness: 50, endgame_skill: 30, time_management: null };
    const desc = buildStyleDescription(fp, "Balanced All-Rounder");
    expect(desc).toMatch(/endgame/i);
  });

  it("mentions endgame conversion when endgame_skill >= 70", () => {
    const fp = { aggression: 50, positional_sense: 50, tactical_sharpness: 50, endgame_skill: 75, time_management: null };
    const desc = buildStyleDescription(fp, "Balanced All-Rounder");
    expect(desc).toMatch(/endgame/i);
  });
});

// ---------------------------------------------------------------------------
// computeStyleFingerprint
// ---------------------------------------------------------------------------

describe("computeStyleFingerprint", () => {
  it("returns defaults for all dimensions on empty input", () => {
    const fp = computeStyleFingerprint([], [], [], false);
    expect(fp.aggression).toBe(50);       // scoreAggression default
    expect(fp.positional_sense).toBe(50); // scorePositionalSense default
    expect(fp.tactical_sharpness).toBe(50); // scoreTacticalSharpness: empty games → 50
    expect(fp.endgame_skill).toBe(50);    // scoreEndgameSkill: empty games → 50
  });

  it("returns null time_management for Chess.com", () => {
    const fp = computeStyleFingerprint([], [], [], false);
    expect(fp.time_management).toBeNull();
  });

  it("scores aggression from pawn advances using real PGN", () => {
    const gameData: GameDataForStyle[] = [
      {
        moveRecords: [],
        criticalMoments: [],
        pgn: SIMPLE_PGN,
        playerColor: "white",
        result: "1-0",
      },
    ];
    const fp = computeStyleFingerprint(gameData, [SIMPLE_PGN], ["600+0"], false);
    // With pawn advances, aggression should be > 0
    expect(fp.aggression).toBeGreaterThanOrEqual(0);
    expect(fp.aggression).toBeLessThanOrEqual(100);
  });

  it("scores tactical sharpness from critical moments", () => {
    const moments: CriticalMoment[] = [
      makeMoment({ move_number: 15, color: "white", category: "good", eval_drop_cp: 10 }),
      makeMoment({ move_number: 20, color: "white", category: "blunder", eval_drop_cp: 300 }),
    ];
    const gameData: GameDataForStyle[] = [
      {
        moveRecords: [],
        criticalMoments: moments,
        pgn: SIMPLE_PGN,
        playerColor: "white",
        result: "1-0",
      },
    ];
    const fp = computeStyleFingerprint(gameData, [SIMPLE_PGN], ["600+0"], false);
    // 1 found out of 2 opportunities = 50%
    expect(fp.tactical_sharpness).toBe(50);
  });

  it("scores endgame skill from win conversion", () => {
    const records = [
      makeRecord({ moveNumber: 35, color: "white", evalBefore: 200, evalAfter: 180 }),
    ];
    const gameData: GameDataForStyle[] = [
      {
        moveRecords: records,
        criticalMoments: [],
        pgn: SIMPLE_PGN,
        playerColor: "white",
        result: "1-0", // had advantage and won
      },
    ];
    const fp = computeStyleFingerprint(gameData, [SIMPLE_PGN], ["600+0"], false);
    expect(fp.endgame_skill).toBe(100); // 1/1 conversion
  });

  it("scores endgame skill as 0 when failing to convert", () => {
    const records = [
      makeRecord({ moveNumber: 35, color: "white", evalBefore: 200, evalAfter: 180 }),
    ];
    const gameData: GameDataForStyle[] = [
      {
        moveRecords: records,
        criticalMoments: [],
        pgn: SIMPLE_PGN,
        playerColor: "white",
        result: "0-1", // had advantage but lost
      },
    ];
    const fp = computeStyleFingerprint(gameData, [SIMPLE_PGN], ["600+0"], false);
    expect(fp.endgame_skill).toBe(0);
  });

  it("all scores are in 0-100 range", () => {
    const gameData: GameDataForStyle[] = [
      {
        moveRecords: [makeRecord({ moveNumber: 20, color: "white", evalBefore: 50, evalAfter: 30 })],
        criticalMoments: [makeMoment({ move_number: 15, color: "white", category: "blunder", eval_drop_cp: 250 })],
        pgn: SIMPLE_PGN,
        playerColor: "white",
        result: "1-0",
      },
    ];
    const fp = computeStyleFingerprint(gameData, [SIMPLE_PGN], ["600+0"], false);
    expect(fp.aggression).toBeGreaterThanOrEqual(0);
    expect(fp.aggression).toBeLessThanOrEqual(100);
    expect(fp.positional_sense).toBeGreaterThanOrEqual(0);
    expect(fp.positional_sense).toBeLessThanOrEqual(100);
    expect(fp.tactical_sharpness).toBeGreaterThanOrEqual(0);
    expect(fp.tactical_sharpness).toBeLessThanOrEqual(100);
    expect(fp.endgame_skill).toBeGreaterThanOrEqual(0);
    expect(fp.endgame_skill).toBeLessThanOrEqual(100);
  });
});
