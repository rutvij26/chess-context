import type { GamePhase, PawnStructure, ChessTheme } from "../types/index.js";

// ---------------------------------------------------------------------------
// Template maps
// ---------------------------------------------------------------------------

const PHASE_SENTENCES: Record<GamePhase, string> = {
  opening:
    "The game is in the opening phase, where development and center control are the key priorities.",
  middlegame:
    "The position has entered the middlegame, where strategic plans and tactical opportunities take center stage.",
  endgame:
    "This is an endgame position, where king activity and pawn promotion become decisive factors.",
};

const STRUCTURE_SENTENCES: Record<PawnStructure, string> = {
  isolated:
    "An isolated pawn creates a dynamic imbalance — the owner gains active piece play, while the opponent has a long-term target to attack.",
  doubled:
    "Doubled pawns weaken the pawn structure, reducing defensive flexibility but potentially opening files for rooks.",
  passed:
    "A passed pawn is a powerful long-term asset that demands both sides' attention — it must be stopped or promoted.",
  backward:
    "A backward pawn is a structural weakness that is difficult to advance and can become a chronic target.",
  hanging:
    "Hanging pawns on the c and d files offer dynamic counterplay but are vulnerable to attack if the position simplifies.",
  chain:
    "A pawn chain creates a clear spatial advantage on one side of the board and defines where the battle will be fought.",
  symmetrical:
    "The symmetrical pawn structure means the game is roughly balanced; the player with better piece activity will have the edge.",
  closed_center:
    "The locked central pawns mean the battle will be decided on the flanks — both sides must create pawn breaks or maneuver pieces.",
  open_center:
    "The open center rewards the player with better piece development and coordination — every tempo counts.",
  semi_open_center:
    "The asymmetrical center gives each side different plans and counterplay opportunities.",
};

const THEME_SENTENCES: Record<ChessTheme, string> = {
  king_safety:
    "King safety is a critical factor — the exposed king must be sheltered before launching any aggressive plans.",
  pawn_storm:
    "An advanced pawn storm is brewing, threatening to open lines against the king.",
  space_advantage:
    "The space advantage grants more squares for maneuvering and restricts the opponent's pieces.",
  piece_activity:
    "Active, well-coordinated pieces give the better side significant attacking and defensive potential.",
  bishop_pair:
    "The bishop pair is a powerful long-term asset, especially in open positions where both diagonals are available.",
  knight_outpost:
    "A knight anchored on an outpost — a strong central square with no enemy pawn to evict it — exerts lasting pressure.",
  open_file:
    "Open files invite rooks and queens to penetrate into the opponent's position.",
  weak_squares:
    "Weak squares around the king are invitations for enemy pieces to establish dominating posts.",
  pin:
    "A piece is pinned against a more valuable target, limiting the defending side's options.",
  fork_potential:
    "A knight fork threat exists — the defender must be careful about piece placement.",
  back_rank:
    "A back-rank weakness lurks — the king is vulnerable to a back-rank check or checkmate.",
  opposite_colored_bishops:
    "Opposite-colored bishops make the position drawish in endgames but amplify attacking chances in the middlegame.",
  rook_on_seventh:
    "A rook on the seventh rank is extremely powerful — it targets pawns and cuts off the enemy king.",
  connected_rooks:
    "Connected rooks on an open file form a powerful battery that dominates open files and ranks.",
  material_imbalance:
    "The material imbalance creates non-standard evaluation — understand the resulting piece dynamics rather than counting points.",
};

const EVAL_SENTENCES: Record<string, (score: number) => string> = {
  winning: (s) =>
    `White has a decisive advantage (+${(s / 100).toFixed(1)}).`,
  winning_black: (s) =>
    `Black has a decisive advantage (${(s / 100).toFixed(1)}).`,
  advantage_white: (s) =>
    `White has a clear advantage (+${(s / 100).toFixed(1)}).`,
  advantage_black: (s) =>
    `Black has a clear advantage (${(s / 100).toFixed(1)}).`,
  slight_white: (s) =>
    `White holds a slight edge (+${(s / 100).toFixed(1)}).`,
  slight_black: (s) =>
    `Black holds a slight edge (${(s / 100).toFixed(1)}).`,
  equal: (_s: number) => "The position is approximately equal.",
};

const MATE_SENTENCES = {
  white_mating: (n: number) => `White has forced checkmate in ${n} moves.`,
  black_mating: (n: number) => `Black has forced checkmate in ${n} moves.`,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function evalSentence(scoreCp: number | null, scoreMate: number | null): string {
  if (scoreMate !== null) {
    return scoreMate > 0
      ? MATE_SENTENCES.white_mating(Math.abs(scoreMate))
      : MATE_SENTENCES.black_mating(Math.abs(scoreMate));
  }
  if (scoreCp === null) return "";

  if (scoreCp >= 300) return EVAL_SENTENCES.winning!(scoreCp);
  if (scoreCp <= -300) return EVAL_SENTENCES.winning_black!(scoreCp);
  if (scoreCp >= 100) return EVAL_SENTENCES.advantage_white!(scoreCp);
  if (scoreCp <= -100) return EVAL_SENTENCES.advantage_black!(scoreCp);
  if (scoreCp >= 25) return EVAL_SENTENCES.slight_white!(scoreCp);
  if (scoreCp <= -25) return EVAL_SENTENCES.slight_black!(scoreCp);
  return EVAL_SENTENCES.equal!(0);
}

// Rank themes by importance for the current phase
function rankThemes(themes: ChessTheme[], phase: GamePhase): ChessTheme[] {
  const priority: Record<GamePhase, ChessTheme[]> = {
    opening: [
      "king_safety",
      "open_center",
      "piece_activity",
      "bishop_pair",
      "space_advantage",
    ] as ChessTheme[],
    middlegame: [
      "king_safety",
      "pin",
      "fork_potential",
      "back_rank",
      "rook_on_seventh",
      "knight_outpost",
      "pawn_storm",
      "weak_squares",
    ] as ChessTheme[],
    endgame: [
      "passed",
      "rook_on_seventh",
      "connected_rooks",
      "opposite_colored_bishops",
      "king_safety",
    ] as ChessTheme[],
  };

  const prioritized = priority[phase] ?? [];
  const sorted = themes.slice().sort((a, b) => {
    const ai = prioritized.indexOf(a);
    const bi = prioritized.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return sorted.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function generateNarrative(
  phase: GamePhase,
  structures: PawnStructure[],
  themes: ChessTheme[],
  scoreCp: number | null,
  scoreMate: number | null
): string {
  const sentences: string[] = [];

  // 1. Phase sentence
  sentences.push(PHASE_SENTENCES[phase]);

  // 2. Most notable pawn structure
  const primaryStructure = structures[0];
  if (primaryStructure && STRUCTURE_SENTENCES[primaryStructure]) {
    sentences.push(STRUCTURE_SENTENCES[primaryStructure]!);
  }

  // 3. Top 1-2 themes ranked by phase relevance
  const topThemes = rankThemes(themes, phase);
  for (const theme of topThemes) {
    if (THEME_SENTENCES[theme]) {
      sentences.push(THEME_SENTENCES[theme]!);
    }
  }

  // 4. Evaluation sentence
  const evalStr = evalSentence(scoreCp, scoreMate);
  if (evalStr) sentences.push(evalStr);

  return sentences.join(" ");
}
