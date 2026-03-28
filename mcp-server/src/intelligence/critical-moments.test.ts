import { describe, it, expect } from "vitest";
import {
  detectCriticalMoments,
  computeAccuracy,
  categoriseMistakesByPhase,
  type MoveRecord,
} from "./critical-moments.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMove(
  overrides: Partial<MoveRecord> & {
    moveNumber: number;
    color: "white" | "black";
    evalBefore: number;
    evalAfter: number;
  }
): MoveRecord {
  return {
    san: "e4",
    fenBefore: "start",
    fenAfter: "after",
    bestMoveSan: "e4",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectCriticalMoments
// ---------------------------------------------------------------------------

describe("detectCriticalMoments", () => {
  it("returns empty array when no significant eval drops", () => {
    const moves: MoveRecord[] = [
      makeMove({ moveNumber: 1, color: "white", evalBefore: 0, evalAfter: 30 }),
      makeMove({ moveNumber: 1, color: "black", evalBefore: -30, evalAfter: -20 }),
    ];
    expect(detectCriticalMoments(moves)).toHaveLength(0);
  });

  it("classifies a 200cp+ drop as a blunder", () => {
    const moves: MoveRecord[] = [
      makeMove({
        moveNumber: 10,
        color: "white",
        san: "Bg5",
        bestMoveSan: "Nf3",
        evalBefore: 50,
        evalAfter: -180, // drops 230cp from white's perspective
      }),
    ];
    const moments = detectCriticalMoments(moves);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.category).toBe("blunder");
    expect(moments[0]!.move_played).toBe("Bg5");
    expect(moments[0]!.best_move).toBe("Nf3");
  });

  it("classifies a 100-199cp drop as a mistake", () => {
    const moves: MoveRecord[] = [
      makeMove({
        moveNumber: 15,
        color: "black",
        san: "Nd4",
        bestMoveSan: "f5",
        evalBefore: -40, // from white's POV, black to move → -40 means black is ahead
        evalAfter: 80,   // drops 120cp for black (before was -40 from white, after is +80)
      }),
    ];
    const moments = detectCriticalMoments(moves);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.category).toBe("mistake");
  });

  it("classifies a 50-99cp drop as an inaccuracy", () => {
    const moves: MoveRecord[] = [
      makeMove({
        moveNumber: 8,
        color: "white",
        san: "h3",
        bestMoveSan: "O-O",
        evalBefore: 30,
        evalAfter: -30, // 60cp swing → inaccuracy
      }),
    ];
    const moments = detectCriticalMoments(moves);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.category).toBe("inaccuracy");
  });

  it("classifies a missed_win when advantage drops from winning to losing", () => {
    const moves: MoveRecord[] = [
      makeMove({
        moveNumber: 25,
        color: "white",
        san: "Qd2",
        bestMoveSan: "Rxf7",
        evalBefore: 350,  // was winning (+3.5) — hadWinning = true
        evalAfter: -80,   // now losing (−0.8) — isNowLosing = true (≤ −50)
      }),
    ];
    const moments = detectCriticalMoments(moves);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.category).toBe("missed_win");
  });

  it("does not flag moves below the inaccuracy threshold (< 50cp)", () => {
    const moves: MoveRecord[] = [
      makeMove({
        moveNumber: 5,
        color: "white",
        evalBefore: 20,
        evalAfter: -20, // 40cp swing — below threshold
      }),
    ];
    expect(detectCriticalMoments(moves)).toHaveLength(0);
  });

  it("detects multiple critical moments in a game", () => {
    const moves: MoveRecord[] = [
      makeMove({ moveNumber: 5, color: "white", evalBefore: 0, evalAfter: 20 }),
      makeMove({ moveNumber: 10, color: "white", san: "blunder1", bestMoveSan: "Nf3", evalBefore: 30, evalAfter: -200 }),
      makeMove({ moveNumber: 10, color: "black", evalBefore: -200, evalAfter: -190 }),
      makeMove({ moveNumber: 20, color: "black", san: "blunder2", bestMoveSan: "Rxe5", evalBefore: -190, evalAfter: 100 }),
    ];
    const moments = detectCriticalMoments(moves);
    expect(moments.length).toBeGreaterThanOrEqual(2);
  });

  it("includes move_number and color in output", () => {
    const moves: MoveRecord[] = [
      makeMove({
        moveNumber: 12,
        color: "black",
        san: "Kf8",
        bestMoveSan: "O-O",
        evalBefore: -20,
        evalAfter: 200,
      }),
    ];
    const moments = detectCriticalMoments(moves);
    expect(moments[0]!.move_number).toBe(12);
    expect(moments[0]!.color).toBe("black");
  });

  it("includes a non-empty explanation", () => {
    const moves: MoveRecord[] = [
      makeMove({
        moveNumber: 5,
        color: "white",
        san: "Bg5",
        bestMoveSan: "d4",
        evalBefore: 30,
        evalAfter: -200,
      }),
    ];
    const [moment] = detectCriticalMoments(moves);
    expect(moment!.explanation.length).toBeGreaterThan(10);
    expect(moment!.explanation).toContain("Bg5");
  });
});

// ---------------------------------------------------------------------------
// computeAccuracy
// ---------------------------------------------------------------------------

describe("computeAccuracy", () => {
  it("returns 100 when all moves are within 30cp of best", () => {
    const moves: MoveRecord[] = [
      makeMove({ moveNumber: 1, color: "white", evalBefore: 0, evalAfter: 25 }),
      makeMove({ moveNumber: 2, color: "white", evalBefore: 25, evalAfter: 40 }),
    ];
    expect(computeAccuracy(moves, "white")).toBe(100);
  });

  it("returns 50 when half the moves are inaccurate", () => {
    const moves: MoveRecord[] = [
      makeMove({ moveNumber: 1, color: "white", evalBefore: 0, evalAfter: 25 }),    // accurate
      makeMove({ moveNumber: 2, color: "white", evalBefore: 25, evalAfter: -45 }), // drop 70cp → inaccurate
    ];
    expect(computeAccuracy(moves, "white")).toBe(50);
  });

  it("only considers moves by the specified color", () => {
    const moves: MoveRecord[] = [
      makeMove({ moveNumber: 1, color: "white", evalBefore: 0, evalAfter: 20 }),
      // Black blunders: was ahead 100cp, now white is ahead 200cp (300cp swing for black)
      makeMove({ moveNumber: 1, color: "black", evalBefore: -100, evalAfter: 200 }),
    ];
    // White accuracy should be 100, black 0 (300cp drop from black's perspective)
    expect(computeAccuracy(moves, "white")).toBe(100);
    expect(computeAccuracy(moves, "black")).toBe(0);
  });

  it("returns 100 when there are no moves for the specified color", () => {
    const moves: MoveRecord[] = [
      makeMove({ moveNumber: 1, color: "white", evalBefore: 0, evalAfter: 20 }),
    ];
    expect(computeAccuracy(moves, "black")).toBe(100);
  });

  it("returns a value between 0 and 100", () => {
    const moves: MoveRecord[] = [
      makeMove({ moveNumber: 1, color: "white", evalBefore: 100, evalAfter: -200 }),
      makeMove({ moveNumber: 2, color: "white", evalBefore: 0, evalAfter: 20 }),
      makeMove({ moveNumber: 3, color: "white", evalBefore: 20, evalAfter: 30 }),
    ];
    const accuracy = computeAccuracy(moves, "white");
    expect(accuracy).toBeGreaterThanOrEqual(0);
    expect(accuracy).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// categoriseMistakesByPhase
// ---------------------------------------------------------------------------

describe("categoriseMistakesByPhase", () => {
  it("categorises early game mistakes as opening", () => {
    const moments = detectCriticalMoments([
      makeMove({
        moveNumber: 5,
        color: "white",
        san: "Bg5",
        bestMoveSan: "Nf3",
        evalBefore: 30,
        evalAfter: -200,
      }),
    ]);
    const categories = categoriseMistakesByPhase(moments);
    expect(categories.opening).toBe(1);
    expect(categories.tactical).toBe(0);
  });

  it("categorises late game mistakes as endgame", () => {
    const moments = detectCriticalMoments([
      makeMove({
        moveNumber: 38,
        color: "white",
        san: "Ke4",
        bestMoveSan: "Kd5",
        evalBefore: 200,
        evalAfter: -200,
      }),
    ]);
    const categories = categoriseMistakesByPhase(moments);
    expect(categories.endgame).toBe(1);
  });

  it("categorises middlegame blunders as tactical", () => {
    const moments = detectCriticalMoments([
      makeMove({
        moveNumber: 20,
        color: "black",
        san: "Nxe4",
        bestMoveSan: "Nf6",
        evalBefore: -30,
        evalAfter: 250,
      }),
    ]);
    const categories = categoriseMistakesByPhase(moments);
    expect(categories.tactical).toBe(1);
  });

  it("returns zeroes when no significant mistakes", () => {
    const categories = categoriseMistakesByPhase([]);
    expect(categories).toEqual({ tactical: 0, strategic: 0, opening: 0, endgame: 0 });
  });
});
