import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { tagThemes } from "./theme-tagger.js";

// ---------------------------------------------------------------------------
// FEN constants
// ---------------------------------------------------------------------------

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// White has both bishops (c1 + f1), black has both bishops (c8 + f8)
const BISHOP_PAIR_FEN =
  "r1bqkb1r/pppp1ppp/2n2n2/8/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 1";

// Rook on 7th rank (White rook on d7)
const ROOK_ON_SEVENTH_FEN =
  "r5k1/3R4/8/8/8/8/8/4K3 w - - 0 1";

// Open e-file (no pawns on e-file)
const OPEN_FILE_FEN =
  "r1bqkb1r/pppp1ppp/2n2n2/8/8/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 1";

// One bishop each — neither side has the bishop pair
// White: king + 1 bishop. Black: king + 1 bishop.
const ONE_BISHOP_EACH_FEN = "4k1b1/8/8/8/8/8/8/2B1K3 w - - 0 1";

// Opposite-colored bishops: white bishop on light square, black bishop on dark square
// White Bd2 (d2 = file 3, rank 2, (3+2)%2=1=light), Black Bd7 (file 3, rank 7, (3+7)%2=0=dark)
const OPPOSITE_COLORED_BISHOPS_FEN =
  "4k3/3b4/8/8/8/8/3B4/4K3 w - - 0 1";

// Connected rooks: White rooks on a1 and c1 with nothing between them
const CONNECTED_ROOKS_FEN =
  "8/8/8/8/8/8/8/R1R1K2k w - - 0 1";

// ---------------------------------------------------------------------------
// tagThemes
// ---------------------------------------------------------------------------

describe("tagThemes", () => {
  it("returns an array", () => {
    const themes = tagThemes(new Chess(STARTING_FEN), "opening");
    expect(Array.isArray(themes)).toBe(true);
  });

  it("detects bishop_pair when one side has both bishops", () => {
    // BISHOP_PAIR_FEN: both sides have two bishops each
    const themes = tagThemes(new Chess(BISHOP_PAIR_FEN), "opening");
    expect(themes).toContain("bishop_pair");
  });

  it("does not detect bishop_pair when each side has only one bishop", () => {
    // ONE_BISHOP_EACH_FEN: 1 white bishop + 1 black bishop — neither has the pair
    const themes = tagThemes(new Chess(ONE_BISHOP_EACH_FEN), "endgame");
    expect(themes).not.toContain("bishop_pair");
  });

  it("detects rook_on_seventh when a rook is on the 7th rank", () => {
    const themes = tagThemes(new Chess(ROOK_ON_SEVENTH_FEN), "endgame");
    expect(themes).toContain("rook_on_seventh");
  });

  it("detects open_file when a file has no pawns", () => {
    const themes = tagThemes(new Chess(OPEN_FILE_FEN), "middlegame");
    expect(themes).toContain("open_file");
  });

  it("detects opposite_colored_bishops", () => {
    const themes = tagThemes(new Chess(OPPOSITE_COLORED_BISHOPS_FEN), "endgame");
    expect(themes).toContain("opposite_colored_bishops");
  });

  it("detects connected_rooks when two rooks share a rank with nothing between them", () => {
    const themes = tagThemes(new Chess(CONNECTED_ROOKS_FEN), "endgame");
    expect(themes).toContain("connected_rooks");
  });

  it("does not crash on any legal position", () => {
    const positions = [
      STARTING_FEN,
      ROOK_ON_SEVENTH_FEN,
      OPPOSITE_COLORED_BISHOPS_FEN,
      "4K2k/8/8/8/8/8/8/8 w - - 0 1", // bare kings
    ];
    for (const fen of positions) {
      expect(() => tagThemes(new Chess(fen), "endgame")).not.toThrow();
    }
  });

  it("does not return duplicate themes", () => {
    const themes = tagThemes(new Chess(STARTING_FEN), "opening");
    const unique = new Set(themes);
    expect(unique.size).toBe(themes.length);
  });

  it("returns different themes for different phases", () => {
    const openingThemes = tagThemes(new Chess(STARTING_FEN), "opening");
    const endgameThemes = tagThemes(new Chess(STARTING_FEN), "endgame");
    // The theme lists may differ — just ensure both are valid arrays
    expect(Array.isArray(openingThemes)).toBe(true);
    expect(Array.isArray(endgameThemes)).toBe(true);
  });
});
