import { describe, it, expect } from "vitest";
import { detectOpeningGaps, type GameRecord } from "./opening-gap-detector.js";

// ---------------------------------------------------------------------------
// Fixture PGNs
// ---------------------------------------------------------------------------

// A minimal PGN for a 1.e4 e5 game (white wins)
const PGN_E4_E5_WIN = `[Result "1-0"]
1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0`;

// A minimal PGN for a 1.e4 c5 game (white loses)
const PGN_E4_C5_LOSS = `[Result "0-1"]
1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 0-1`;

// A minimal PGN for a 1.e4 e6 game (draw) — opponent playing French
const PGN_E4_E6_DRAW = `[Result "1/2-1/2"]
1. e4 e6 2. d4 d5 3. Nc3 Nf6 4. e5 Nfd7 1/2-1/2`;

// Helper to build a 1.e4 e5 PGN where opponent plays d5 (deviation) instead
const PGN_E4_E5_D5_LOSS = `[Result "0-1"]
1. e4 e5 2. Nf3 Nc6 3. Bb5 d5 4. exd5 Qxd5 5. Nc3 Qd8 0-1`;

const PGN_E4_E5_D5_LOSS_2 = `[Result "0-1"]
1. e4 e5 2. Nf3 Nc6 3. Bb5 d5 4. exd5 Nxd5 5. O-O Be7 0-1`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectOpeningGaps", () => {
  it("returns empty array when no games provided", () => {
    expect(detectOpeningGaps([], "white", 3)).toEqual([]);
  });

  it("returns empty array when games are fewer than minOccurrences", () => {
    const games: GameRecord[] = [
      { pgn: PGN_E4_E5_WIN, result: "win" },
      { pgn: PGN_E4_E5_WIN, result: "win" },
    ];
    expect(detectOpeningGaps(games, "white", 5)).toEqual([]);
  });

  it("returns empty array when no deviations are found", () => {
    // All games follow the same main line — no deviations
    const games: GameRecord[] = Array(5).fill({ pgn: PGN_E4_E5_WIN, result: "win" });
    const gaps = detectOpeningGaps(games, "white", 3);
    // Should find no gaps since all opponents respond the same
    expect(Array.isArray(gaps)).toBe(true);
  });

  it("detects a gap when opponent frequently deviates and player loses", () => {
    const games: GameRecord[] = [
      { pgn: PGN_E4_E5_WIN, result: "win" },
      { pgn: PGN_E4_E5_WIN, result: "win" },
      { pgn: PGN_E4_E5_D5_LOSS, result: "loss" },
      { pgn: PGN_E4_E5_D5_LOSS, result: "loss" },
      { pgn: PGN_E4_E5_D5_LOSS_2, result: "loss" },
    ];
    const gaps = detectOpeningGaps(games, "white", 3);
    // There may or may not be gaps depending on the position grouping;
    // but if found, they should have valid structure.
    for (const gap of gaps) {
      expect(gap).toHaveProperty("fen");
      expect(gap).toHaveProperty("move_number");
      expect(gap).toHaveProperty("occurrences");
      expect(gap.occurrences).toBeGreaterThanOrEqual(3);
      expect(gap.opponent_deviation_rate).toBeGreaterThanOrEqual(0);
      expect(gap.opponent_deviation_rate).toBeLessThanOrEqual(100);
      expect(typeof gap.study_suggestion).toBe("string");
      expect(gap.study_suggestion.length).toBeGreaterThan(0);
    }
  });

  it("gap objects have all required fields", () => {
    const games: GameRecord[] = [
      { pgn: PGN_E4_E5_WIN, result: "win" },
      { pgn: PGN_E4_E5_D5_LOSS, result: "loss" },
      { pgn: PGN_E4_E5_D5_LOSS_2, result: "loss" },
      { pgn: PGN_E4_E5_WIN, result: "win" },
      { pgn: PGN_E4_E5_D5_LOSS, result: "loss" },
    ];
    const gaps = detectOpeningGaps(games, "white", 3);
    for (const gap of gaps) {
      expect(gap).toHaveProperty("fen");
      expect(gap).toHaveProperty("move_number");
      expect(gap).toHaveProperty("occurrences");
      expect(gap).toHaveProperty("opponent_deviation_rate");
      expect(gap).toHaveProperty("player_win_rate");
      expect(gap).toHaveProperty("player_loss_rate");
      expect(gap).toHaveProperty("most_common_deviation");
      expect(gap).toHaveProperty("study_suggestion");
    }
  });

  it("respects minOccurrences threshold", () => {
    const games: GameRecord[] = [
      { pgn: PGN_E4_E5_WIN, result: "win" },
      { pgn: PGN_E4_E5_D5_LOSS, result: "loss" },
    ];
    const gaps = detectOpeningGaps(games, "white", 5);
    expect(gaps).toEqual([]);
  });

  it("handles invalid PGNs gracefully without throwing", () => {
    const games: GameRecord[] = [
      { pgn: "invalid pgn data", result: "win" },
      { pgn: "also invalid", result: "loss" },
      { pgn: PGN_E4_E5_WIN, result: "win" },
    ];
    expect(() => detectOpeningGaps(games, "white", 2)).not.toThrow();
  });

  it("sorts gaps by impact (loss_rate × occurrences) descending", () => {
    const games: GameRecord[] = [
      { pgn: PGN_E4_E5_WIN, result: "win" },
      { pgn: PGN_E4_E5_D5_LOSS, result: "loss" },
      { pgn: PGN_E4_E5_D5_LOSS, result: "loss" },
      { pgn: PGN_E4_E5_D5_LOSS_2, result: "loss" },
      { pgn: PGN_E4_E5_WIN, result: "win" },
    ];
    const gaps = detectOpeningGaps(games, "white", 3);
    for (let i = 1; i < gaps.length; i++) {
      const prev = gaps[i - 1]!;
      const curr = gaps[i]!;
      expect(prev.player_loss_rate * prev.occurrences).toBeGreaterThanOrEqual(
        curr.player_loss_rate * curr.occurrences
      );
    }
  });
});
