import { describe, it, expect } from "vitest";
import { generateNarrative } from "./narrative-generator.js";
import type { GamePhase, PawnStructure, ChessTheme } from "../types/index.js";

// ---------------------------------------------------------------------------
// generateNarrative
// ---------------------------------------------------------------------------

describe("generateNarrative", () => {
  it("returns a non-empty string", () => {
    const result = generateNarrative("opening", [], [], 0, null);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("mentions the opening phase for opening positions", () => {
    const result = generateNarrative("opening", [], [], 30, null);
    expect(result.toLowerCase()).toContain("opening");
  });

  it("mentions the middlegame phase for middlegame positions", () => {
    const result = generateNarrative("middlegame", [], [], 80, null);
    expect(result.toLowerCase()).toContain("middlegame");
  });

  it("mentions the endgame phase for endgame positions", () => {
    const result = generateNarrative("endgame", ["passed"], ["rook_on_seventh"], 150, null);
    expect(result.toLowerCase()).toContain("endgame");
  });

  it("includes eval text for a white advantage", () => {
    const result = generateNarrative("middlegame", [], [], 120, null);
    expect(result).toContain("White has a clear advantage");
  });

  it("includes eval text for a black advantage", () => {
    const result = generateNarrative("middlegame", [], [], -120, null);
    expect(result).toContain("Black has a clear advantage");
  });

  it("mentions equal position for near-zero eval", () => {
    const result = generateNarrative("opening", [], [], 10, null);
    expect(result).toContain("approximately equal");
  });

  it("mentions slight white edge for small advantage", () => {
    const result = generateNarrative("opening", [], [], 40, null);
    expect(result).toContain("slight edge");
  });

  it("mentions slight black edge for small black advantage", () => {
    const result = generateNarrative("opening", [], [], -40, null);
    expect(result).toContain("slight edge");
  });

  it("mentions decisive white advantage for large score", () => {
    const result = generateNarrative("middlegame", [], [], 400, null);
    expect(result).toContain("decisive advantage");
  });

  it("mentions decisive black advantage for large negative score", () => {
    const result = generateNarrative("middlegame", [], [], -400, null);
    expect(result).toContain("decisive advantage");
  });

  it("mentions mate when score_mate is provided", () => {
    const result = generateNarrative("endgame", [], [], null, 3);
    expect(result).toContain("checkmate in 3");
  });

  it("mentions black mating when score_mate is negative", () => {
    const result = generateNarrative("endgame", [], [], null, -2);
    expect(result).toContain("checkmate in 2");
  });

  it("includes pawn structure information when structures are provided", () => {
    const result = generateNarrative("middlegame", ["isolated"], [], 0, null);
    expect(result).toContain("isolated pawn");
  });

  it("includes theme information when themes are provided", () => {
    const result = generateNarrative("middlegame", [], ["bishop_pair"], 50, null);
    expect(result).toContain("bishop pair");
  });

  it("handles no structures or themes gracefully", () => {
    const result = generateNarrative("endgame", [], [], -200, null);
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(20);
  });

  it("produces different output for different phases", () => {
    const opening = generateNarrative("opening", [], [], 0, null);
    const endgame = generateNarrative("endgame", [], [], 0, null);
    expect(opening).not.toBe(endgame);
  });

  it("produces different output for different eval scores", () => {
    const winning = generateNarrative("middlegame", [], [], 500, null);
    const losing = generateNarrative("middlegame", [], [], -500, null);
    expect(winning).not.toBe(losing);
  });
});
