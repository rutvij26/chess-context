import { getLichessOpeningExplorer } from "../data/lichess-api.js";
import type {
  GetOpeningTheoryInput,
  GetOpeningTheoryOutput,
  OpeningContinuation,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Opening name → starting FEN lookup
// Used when caller provides opening_name but no FEN.
// ---------------------------------------------------------------------------

const OPENING_FEN_MAP: Record<string, string> = {
  // 1.e4 openings
  "ruy lopez": "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
  "italian game": "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
  "sicilian defense": "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
  "french defense": "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "caro-kann defense": "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "pirc defense": "rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "scandinavian defense": "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2",
  "kings gambit": "rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq f3 0 2",
  // 1.d4 openings
  "queens gambit": "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3 0 2",
  "kings indian defense": "rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 1 3",
  "nimzo-indian defense": "rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 2 4",
  "queens indian defense": "rnbqkb1r/p1pp1ppp/1p2pn2/8/2PP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 0 4",
  "grunfeld defense": "rnbqkb1r/ppp1pp1p/5np1/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4",
  "english opening": "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq c3 0 1",
  // Default starting position
  "starting position": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
};

// ---------------------------------------------------------------------------
// FEN → opening name + ECO (local fallback when Lichess Explorer is unavailable)
// Keyed on "piece_placement active_color" (first two FEN fields) so en passant
// square, castling rights, and move counters don't prevent a match.
// ---------------------------------------------------------------------------

interface LocalOpening { name: string; eco: string }

const FEN_ECO_MAP: Record<string, LocalOpening> = {
  // After 1.e4
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b": { name: "King's Pawn Opening", eco: "B00" },
  // After 1.e4 c5
  "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w": { name: "Sicilian Defense", eco: "B20" },
  // After 1.e4 e5
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w": { name: "Open Game", eco: "C20" },
  // After 1.e4 e6
  "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w": { name: "French Defense", eco: "C00" },
  // After 1.e4 c6
  "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w": { name: "Caro-Kann Defense", eco: "B10" },
  // After 1.e4 d5
  "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w": { name: "Scandinavian Defense", eco: "B01" },
  // After 1.e4 d6
  "rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w": { name: "Pirc Defense", eco: "B07" },
  // After 1.e4 e5 2.Nf3 Nc6 3.Bb5
  "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b": { name: "Ruy Lopez", eco: "C60" },
  // After 1.e4 e5 2.Nf3 Nc6 3.Bc4
  "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b": { name: "Italian Game", eco: "C50" },
  // After 1.d4
  "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b": { name: "Queen's Pawn Opening", eco: "D00" },
  // After 1.d4 d5 2.c4
  "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b": { name: "Queen's Gambit", eco: "D06" },
  // After 1.d4 Nf6 2.c4 g6
  "rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR w": { name: "King's Indian Defense", eco: "E60" },
  // After 1.d4 Nf6 2.c4 e6 3.Nc3 Bb4
  "rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR w": { name: "Nimzo-Indian Defense", eco: "E20" },
  // After 1.d4 d5
  "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w": { name: "Closed Game", eco: "D00" },
  // After 1.c4
  "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b": { name: "English Opening", eco: "A10" },
  // After 1.Nf3
  "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b": { name: "Réti Opening", eco: "A04" },
};

/** Reduce a full FEN to "piece_placement active_color" for map lookup. */
function normalizeFen(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  return `${parts[0] ?? ""} ${parts[1] ?? ""}`;
}

/** Reverse lookup: FEN → local opening info (name + ECO). */
function lookupOpeningByFen(fen: string): LocalOpening | null {
  return FEN_ECO_MAP[normalizeFen(fen)] ?? null;
}

function lookupFen(openingName: string): string | null {
  const normalized = openingName.toLowerCase().replace(/['']/g, "");
  for (const [key, fen] of Object.entries(OPENING_FEN_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return fen;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Key ideas by opening family
// ---------------------------------------------------------------------------

function buildKeyIdeas(
  openingName: string,
  playerLevel: "beginner" | "club" | "advanced"
): string[] {
  const name = openingName.toLowerCase();

  if (name.includes("sicilian")) {
    if (playerLevel === "beginner") {
      return [
        "Black fights back with c5 instead of mirroring e5",
        "Creates an asymmetric position with chances for both sides",
        "Black aims to counter-attack on the queenside",
        "White usually attacks on the kingside",
        "One of the most popular and combative openings",
      ];
    }
    return [
      "Asymmetrical pawn structure gives Black dynamic counterplay",
      "Black's c5 controls d4 and prepares queenside expansion",
      "White typically opens with f4 or g4-g5 for kingside attack",
      "Key plans: Black's minority attack vs White's kingside pawn storm",
      "Anti-Sicilian systems (Grand Prix, Alapin, Moscow) sidestep main lines",
    ];
  }

  if (name.includes("ruy lopez") || name.includes("spanish")) {
    return [
      "White pressures the e5 pawn indirectly via Bb5 attacking the defender Nc6",
      "Long strategic game with slow maneuvering typical",
      "Key tension: whether Black's e5 pawn can be won or maintained",
      "Closed center favors piece maneuvering and pawn breaks",
      "The Marshall Attack is Black's sharpest counterplay option",
    ];
  }

  if (name.includes("queens gambit")) {
    return [
      "White offers the c4 pawn to gain central control with d4+c4",
      "Accepted (QGA): Black takes c4, White gets open c-file and center",
      "Declined (QGD): Black holds d5 with e6, solid but slightly passive",
      "Slav Defense: Black supports d5 with c6, avoiding bishop problems",
      "Exchange Variation: Fixed pawn center, White aims for minority attack",
    ];
  }

  if (name.includes("french")) {
    return [
      "Black builds a solid pawn chain with e6+d5 but can get cramped",
      "The bad light-squared bishop on c8 is Black's main weakness",
      "Exchange Variation: symmetrical structure, early simplification",
      "Advance Variation: White closes center with e5, space advantage",
      "Winawer Variation: Bb4 pins, creates double pawns for White but gives counterplay",
    ];
  }

  if (name.includes("italian")) {
    return [
      "White develops bishop to c4 targeting the f7 weakness",
      "Giuoco Piano: symmetrical development, slower positional game",
      "Evan's Gambit: b4 pawn sacrifice for quick attack",
      "Two Knights: sharp play after Nf6, Black fights for equality",
      "Modern Italian (Giouco Pianissimo): slow maneuvering with c3+d3",
    ];
  }

  if (name.includes("kings indian")) {
    return [
      "Black allows White a strong center (e4+d4) then counter-attacks it",
      "Kingside fianchetto with g6+Bg7 gives Black long-term pressure",
      "Classic King's Indian: Black plays e5, leads to tense pawn chains",
      "White space advantage vs Black's dynamic piece play",
      "Famous for sharp, unbalanced positions with mutual attacks",
    ];
  }

  // Generic fallback
  return [
    "Follow opening principles: develop pieces, control center, castle early",
    "Understand the pawn structure to guide your plans",
    "Identify key squares: outposts for knights, open files for rooks",
    "Coordinate your pieces before launching an attack",
    "Know the typical pawn breaks in this structure",
  ];
}

// ---------------------------------------------------------------------------
// Historical context snippets
// ---------------------------------------------------------------------------

function buildHistoricalContext(openingName: string): string {
  const name = openingName.toLowerCase();

  if (name.includes("ruy lopez") || name.includes("spanish")) {
    return "Named after 16th-century Spanish priest Ruy López de Segura, this opening has been analyzed for over 500 years and remains one of the most theoretically rich openings in chess.";
  }
  if (name.includes("sicilian")) {
    return "The Sicilian Defense has been the most popular response to 1.e4 since the 1970s. Players like Fischer, Kasparov, and Tal have used it to generate the sharp, unbalanced play it is famous for.";
  }
  if (name.includes("queens gambit")) {
    return "One of the oldest openings, the Queen's Gambit was a staple of classical chess and rose to fame in the 1920s during Capablanca and Alekhine's era. Still a top choice at the highest levels.";
  }
  if (name.includes("french")) {
    return "The French Defense gained its name after a correspondence match between London and Paris in 1834. Petrosian and Korchnoi were among its most famous practitioners.";
  }
  if (name.includes("kings indian")) {
    return "The King's Indian Defense became popular in the 1940s-50s, championed by Bronstein and later Kasparov, who used it to defeat Karpov in several World Championship games.";
  }
  return "This opening has been played at the highest levels and contains rich strategic and tactical ideas that reward deep study.";
}

// ---------------------------------------------------------------------------
// Narrative builder
// ---------------------------------------------------------------------------

function buildNarrative(
  openingName: string,
  winStats: { white_wins: number; draws: number; black_wins: number },
  playerLevel: "beginner" | "club" | "advanced",
  topMoves: string[]
): string {
  const { white_wins, draws, black_wins } = winStats;
  const total = white_wins + draws + black_wins;
  const whitePct = total > 0 ? Math.round((white_wins / total) * 100) : 33;
  const drawPct = total > 0 ? Math.round((draws / total) * 100) : 33;
  const blackPct = total > 0 ? Math.round((black_wins / total) * 100) : 34;

  const statsLine = `In master-level games, White scores ${whitePct}%, draws occur ${drawPct}% of the time, and Black scores ${blackPct}%.`;
  const moveLine =
    topMoves.length > 0
      ? ` The most frequently played continuations are ${topMoves.slice(0, 3).join(", ")}.`
      : "";

  if (playerLevel === "beginner") {
    return `${openingName} is a great opening to learn as a beginner. Focus on understanding the basic ideas before memorizing specific move orders. ${statsLine}${moveLine}`;
  }
  if (playerLevel === "advanced") {
    return `${openingName} at the advanced level demands precise move order knowledge and an understanding of transpositions. ${statsLine}${moveLine} Study the key sub-variations and typical endgame structures arising from this opening.`;
  }
  return `${openingName} is a solid choice for club players. ${statsLine}${moveLine} Study the key ideas and 2-3 main lines to build a reliable repertoire.`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleGetOpeningTheory(
  input: GetOpeningTheoryInput
): Promise<GetOpeningTheoryOutput> {
  if (!input.fen && !input.opening_name) {
    return {
      opening_name: "Unknown",
      eco: null,
      key_ideas: [],
      main_continuations: [],
      win_stats: { white_wins: 0, draws: 0, black_wins: 0 },
      historical_context: "",
      narrative: "",
      lichess_explorer_url: "https://lichess.org/analysis",
      note: "Provide either a FEN string or an opening name.",
    };
  }

  const playerLevel = input.player_level ?? "club";

  // Resolve FEN
  let fen: string | undefined = input.fen;
  if (!fen && input.opening_name) {
    fen = lookupFen(input.opening_name) ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  }

  // Resolve opening name + ECO from local map before the API call so the
  // fallback path can still return complete data if the Explorer is down.
  const localOpening = fen ? lookupOpeningByFen(fen) : null;

  let explorerData;
  try {
    explorerData = await getLichessOpeningExplorer(fen!);
  } catch (err) {
    const opening =
      localOpening?.name ?? input.opening_name ?? "Unknown Opening";
    const eco = localOpening?.eco ?? null;
    const emptyStats = { white_wins: 0, draws: 0, black_wins: 0 };
    return {
      opening_name: opening,
      eco,
      key_ideas: buildKeyIdeas(opening, playerLevel),
      main_continuations: [],
      win_stats: emptyStats,
      historical_context: buildHistoricalContext(opening),
      narrative: buildNarrative(opening, emptyStats, playerLevel, []),
      lichess_explorer_url: `https://lichess.org/analysis/${encodeURIComponent(fen!)}`,
      note: `Lichess Opening Explorer unavailable (${err instanceof Error ? err.message : String(err)}). Showing local opening data only — win statistics and main continuations require a live connection.`,
    };
  }

  const openingName =
    explorerData.opening?.name ??
    localOpening?.name ??
    input.opening_name ??
    "Unknown Opening";
  const eco = explorerData.opening?.eco ?? localOpening?.eco ?? null;

  // Build win stats (percentages)
  const total = explorerData.white + explorerData.draws + explorerData.black;
  const winStats = {
    white_wins: total > 0 ? Math.round((explorerData.white / total) * 100) : 0,
    draws: total > 0 ? Math.round((explorerData.draws / total) * 100) : 0,
    black_wins: total > 0 ? Math.round((explorerData.black / total) * 100) : 0,
  };

  // Build main continuations from top explorer moves
  const mainContinuations: OpeningContinuation[] = explorerData.moves
    .slice(0, 5)
    .map((m) => ({
      moves: m.san,
      description: `${m.san} — white ${m.white}, draws ${m.draws}, black ${m.black} (avg rating: ${m.averageRating ?? "?"})`,
    }));

  const topMoveSans = explorerData.moves.slice(0, 5).map((m) => m.san);

  return {
    opening_name: openingName,
    eco,
    key_ideas: buildKeyIdeas(openingName, playerLevel),
    main_continuations: mainContinuations,
    win_stats: winStats,
    historical_context: buildHistoricalContext(openingName),
    narrative: buildNarrative(openingName, winStats, playerLevel, topMoveSans),
    lichess_explorer_url: `https://lichess.org/analysis/${encodeURIComponent(fen!)}`,
  };
}
