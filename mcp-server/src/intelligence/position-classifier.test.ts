import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  classifyPhase,
  classifyPawnStructure,
  getMaterialBalance,
  countPieces,
} from "./position-classifier.js";

// ---------------------------------------------------------------------------
// FEN constants for well-known positions
// ---------------------------------------------------------------------------

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Middlegame: both queens present but total < 24 pieces (enough trades to bypass
// the opening heuristic: moveNumber=0 from FEN, so we rely on piece count < 24)
// White: Bc1, Qd1, Re1, Kg1, Nc3, Nf3, 6 pawns = 12
// Black: Bc8, Qd8, Kg8, Nc6, Nf6, 6 pawns = 11 → total 23
const MIDDLEGAME_FEN =
  "2bq2k1/pp3ppp/2n2n2/3p4/3P4/2N2N2/PP3PPP/2BQR1K1 w - - 0 1";

// King + Rook vs King (pure endgame, 3 pieces total)
const KR_VS_K_FEN = "8/8/4k3/8/8/4K3/8/4R3 w - - 0 1";

// No queens — should be endgame
const NO_QUEENS_FEN =
  "r1b1kb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1B1KB1R w KQkq - 0 5";

// Isolated pawn: White d4 with no pawns on c or e files (kings added)
const ISOLATED_PAWN_FEN = "8/8/8/8/3P4/8/8/4K2k w - - 0 1";

// Doubled pawns: Two white pawns on d-file (kings added)
const DOUBLED_PAWNS_FEN = "8/8/8/8/3P4/3P4/8/4K2k w - - 0 1";

// Passed pawn: White pawn on d6, no black pawns on c/d/e files ahead (kings added)
const PASSED_PAWN_FEN = "8/8/3P4/8/8/8/8/4K2k w - - 0 1";

// Closed center: White e4 vs Black d5 (e4 vs d5 = classic closed center trigger)
const CLOSED_CENTER_FEN =
  "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2";

// Open center: No pawns on central squares
const OPEN_CENTER_FEN = "r1bqkb1r/pppp1ppp/2n2n2/8/8/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 1";

// ---------------------------------------------------------------------------
// classifyPhase
// ---------------------------------------------------------------------------

describe("classifyPhase", () => {
  it("returns 'opening' for the starting position", () => {
    expect(classifyPhase(new Chess(STARTING_FEN))).toBe("opening");
  });

  it("returns 'middlegame' for a position with queens but fewer than 24 pieces", () => {
    // MIDDLEGAME_FEN has 23 pieces, both queens — fails opening threshold (total < 24)
    expect(classifyPhase(new Chess(MIDDLEGAME_FEN))).toBe("middlegame");
  });

  it("returns 'endgame' for K+R vs K", () => {
    expect(classifyPhase(new Chess(KR_VS_K_FEN))).toBe("endgame");
  });

  it("returns 'endgame' when no queens are on the board", () => {
    expect(classifyPhase(new Chess(NO_QUEENS_FEN))).toBe("endgame");
  });

  it("returns 'middlegame' after replaying 26 half-moves", () => {
    const board = new Chess();
    // Scandinavian Defense — 26 half-moves (move 13), passing the 12-move opening boundary
    const moves = [
      "e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5", "d4", "Nf6",
      "Nf3", "Bf5", "Be2", "e6", "O-O", "Be7", "Ne5", "O-O",
      "f4", "c6", "Be3", "Qc7", "Qd2", "Nbd7", "Rad1", "Nb6",
      "g4", "Bg6",
    ];
    for (const m of moves) board.move(m);
    expect(classifyPhase(board)).toBe("middlegame");
  });
});

// ---------------------------------------------------------------------------
// classifyPawnStructure
// ---------------------------------------------------------------------------

describe("classifyPawnStructure", () => {
  it("detects 'open_center' in the starting position (no pawns on e4/d4/e5/d5)", () => {
    // Starting position has pawns on 2nd/7th ranks, not on central 4th/5th ranks
    const structures = classifyPawnStructure(new Chess(STARTING_FEN));
    expect(structures).toContain("open_center");
  });

  it("detects 'symmetrical' when both sides have center pawns on 4th/5th rank", () => {
    // After 1.e4 e5 2.d4 d5 — white e4+d4, black e5+d5 → symmetrical
    const fen = "rnbqkbnr/ppp2ppp/8/3pp3/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3";
    const structures = classifyPawnStructure(new Chess(fen));
    expect(structures).toContain("symmetrical");
  });

  it("detects 'isolated' pawn", () => {
    const structures = classifyPawnStructure(new Chess(ISOLATED_PAWN_FEN));
    expect(structures).toContain("isolated");
  });

  it("detects 'doubled' pawns", () => {
    const structures = classifyPawnStructure(new Chess(DOUBLED_PAWNS_FEN));
    expect(structures).toContain("doubled");
  });

  it("detects 'passed' pawn", () => {
    const structures = classifyPawnStructure(new Chess(PASSED_PAWN_FEN));
    expect(structures).toContain("passed");
  });

  it("detects 'closed_center' for e4 vs d5 structure", () => {
    const structures = classifyPawnStructure(new Chess(CLOSED_CENTER_FEN));
    expect(structures).toContain("closed_center");
  });

  it("detects 'open_center' when no central pawns", () => {
    const structures = classifyPawnStructure(new Chess(OPEN_CENTER_FEN));
    expect(structures).toContain("open_center");
  });

  it("returns an array", () => {
    const structures = classifyPawnStructure(new Chess(STARTING_FEN));
    expect(Array.isArray(structures)).toBe(true);
  });

  it("does not detect 'isolated' in the starting position", () => {
    // Starting position: all pawns have friendly pawns on adjacent files
    const structures = classifyPawnStructure(new Chess(STARTING_FEN));
    expect(structures).not.toContain("isolated");
  });
});

// ---------------------------------------------------------------------------
// getMaterialBalance
// ---------------------------------------------------------------------------

describe("getMaterialBalance", () => {
  it("returns zero advantage in the starting position", () => {
    const balance = getMaterialBalance(new Chess(STARTING_FEN));
    expect(balance.advantage).toBe(0);
    expect(balance.white).toBe(balance.black);
  });

  it("accounts for captured pieces", () => {
    // After 1.e4 d5 2.exd5 — white pawn captures black pawn (white +100cp)
    const board = new Chess();
    board.move("e4");
    board.move("d5");
    board.move("exd5");
    const balance = getMaterialBalance(board);
    expect(balance.advantage).toBeGreaterThan(0);
    expect(balance.advantage).toBe(100); // one pawn = 100cp
  });

  it("returns negative advantage when black is ahead", () => {
    // FEN with white missing a rook
    const lopsided = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1";
    const balance = getMaterialBalance(new Chess(lopsided));
    expect(balance.advantage).toBeLessThan(0);
  });

  it("returns positive advantage when white has extra material", () => {
    const lopsided = "rnbqkb1r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; // black missing a rook
    const balance = getMaterialBalance(new Chess(lopsided));
    expect(balance.advantage).toBeGreaterThan(0);
  });

  it("returns { white, black, advantage } shape", () => {
    const balance = getMaterialBalance(new Chess(STARTING_FEN));
    expect(balance).toHaveProperty("white");
    expect(balance).toHaveProperty("black");
    expect(balance).toHaveProperty("advantage");
    expect(typeof balance.white).toBe("number");
    expect(typeof balance.black).toBe("number");
    expect(typeof balance.advantage).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// countPieces
// ---------------------------------------------------------------------------

describe("countPieces", () => {
  it("counts 32 total pieces in the starting position", () => {
    const counts = countPieces(new Chess(STARTING_FEN));
    expect(counts.total).toBe(32);
  });

  it("counts 16 white pieces in the starting position", () => {
    const counts = countPieces(new Chess(STARTING_FEN));
    const whitePieces = Object.values(counts.white).reduce((a, b) => a + b, 0);
    expect(whitePieces).toBe(16);
  });

  it("counts 8 white pawns in the starting position", () => {
    const counts = countPieces(new Chess(STARTING_FEN));
    expect(counts.white["p"]).toBe(8);
  });

  it("counts 1 white queen in the starting position", () => {
    const counts = countPieces(new Chess(STARTING_FEN));
    expect(counts.white["q"]).toBe(1);
  });

  it("decrements count after a capture", () => {
    const board = new Chess();
    board.move("e4");
    board.move("d5");
    board.move("exd5"); // white captures black pawn
    const counts = countPieces(board);
    expect(counts.black["p"]).toBe(7);
    expect(counts.total).toBe(31);
  });
});
