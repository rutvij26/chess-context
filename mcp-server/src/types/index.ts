import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type GamePhase = "opening" | "middlegame" | "endgame";

export const PAWN_STRUCTURES = [
  "isolated",
  "doubled",
  "passed",
  "backward",
  "hanging",
  "chain",
  "symmetrical",
  "closed_center",
  "open_center",
  "semi_open_center",
] as const;
export type PawnStructure = (typeof PAWN_STRUCTURES)[number];

export const CHESS_THEMES = [
  "king_safety",
  "pawn_storm",
  "space_advantage",
  "piece_activity",
  "bishop_pair",
  "knight_outpost",
  "open_file",
  "weak_squares",
  "pin",
  "fork_potential",
  "back_rank",
  "opposite_colored_bishops",
  "rook_on_seventh",
  "connected_rooks",
  "material_imbalance",
] as const;
export type ChessTheme = (typeof CHESS_THEMES)[number];

export type MoveCategory =
  | "brilliant"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "missed_win";

// ---------------------------------------------------------------------------
// Zod input schemas (used for MCP tool registration)
// ---------------------------------------------------------------------------

export const AnalyzePositionInputSchema = z.object({
  fen: z.string().describe("FEN string of the position to analyze"),
  depth: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Search depth (default: 18)"),
  num_lines: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Number of top moves to return (default: 3)"),
});
export type AnalyzePositionInput = z.infer<typeof AnalyzePositionInputSchema>;

export const AnalyzeGameInputSchema = z
  .object({
    pgn: z.string().optional().describe("PGN string of the game"),
    game_url: z
      .string()
      .optional()
      .describe(
        "Chess.com or Lichess game URL (e.g. https://lichess.org/abcd1234)"
      ),
    lichess_id: z
      .string()
      .optional()
      .describe("Lichess game ID (8 characters, e.g. abcd1234)"),
    depth: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe("Max analysis depth for critical positions (default: 18)"),
  })
  .refine((d) => d.pgn ?? d.game_url ?? d.lichess_id, {
    message: "Provide at least one of: pgn, game_url, lichess_id",
  });
export type AnalyzeGameInput = z.infer<typeof AnalyzeGameInputSchema>;

export const GetPlayerStatsInputSchema = z.object({
  username: z.string().describe("Player username on the platform"),
  platform: z
    .enum(["chess.com", "lichess"])
    .describe("Chess platform to fetch stats from"),
});
export type GetPlayerStatsInput = z.infer<typeof GetPlayerStatsInputSchema>;

export const ScoutOpponentInputSchema = z.object({
  opponent_username: z.string().describe("Opponent's username"),
  platform: z.enum(["chess.com", "lichess"]),
  your_color: z
    .enum(["white", "black"])
    .describe("The color you will be playing"),
});
export type ScoutOpponentInput = z.infer<typeof ScoutOpponentInputSchema>;

// ---------------------------------------------------------------------------
// Internal engine types
// ---------------------------------------------------------------------------

export interface UCIAnalysisLine {
  depth: number;
  score_cp: number | null;   // centipawn score (null if mate)
  score_mate: number | null; // mate in N (null if not mate)
  pv: string[];              // principal variation in UCI notation
  multipv_rank: number;      // 1 = best line
}

export interface StockfishOptions {
  depth: number;
  multiPv: number;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface TopMove {
  move_uci: string;   // UCI notation (e.g. "e2e4")
  move_san: string;   // SAN notation (e.g. "e4")
  eval_cp: number | null;
  eval_mate: number | null;
  continuation: string[]; // next ~4 moves in SAN
  explanation: string;    // short template-based hint
}

export interface PositionContext {
  phase: GamePhase;
  move_number: number;
  pawn_structures: PawnStructure[];
  themes: ChessTheme[];
  material_balance: number; // positive = white ahead, in centipawns
  complexity: "low" | "medium" | "high";
  narrative: string;
}

export interface PositionAnalysis {
  evaluation: {
    score_cp: number | null;
    score_mate: number | null;
    score_text: string;
    depth: number;
  };
  best_moves: TopMove[];
  position_context: PositionContext;
}

export interface CriticalMoment {
  move_number: number;
  color: "white" | "black";
  move_played: string;    // SAN
  best_move: string;      // SAN
  eval_before_cp: number;
  eval_after_cp: number;
  eval_drop_cp: number;
  category: MoveCategory;
  explanation: string;
}

export interface GameInfo {
  white: string;
  black: string;
  result: string;
  opening: string;
  time_control: string;
  date: string;
  platform: string;
}

export interface PhaseBreakdown {
  moves: string;       // e.g. "1-12"
  assessment: string;
}

export interface GameSummary {
  total_moves: number;
  white_accuracy: number; // percentage 0-100
  black_accuracy: number;
  phase_breakdown: {
    opening: PhaseBreakdown;
    middlegame: PhaseBreakdown;
    endgame: PhaseBreakdown | null;
  };
  mistake_categories: {
    tactical: number;
    strategic: number;
    opening: number;
    endgame: number;
  };
}

export interface GameAnalysis {
  game_info: GameInfo;
  summary: GameSummary;
  critical_moments: CriticalMoment[];
  patterns_detected: string[];
}

export interface RatingInfo {
  current: number;
  peak: number;
  games: number;
}

export interface OpeningEntry {
  opening: string;
  frequency: number;  // percentage of games
  win_rate: number;   // percentage
  sample_size: number;
}

export interface RecentForm {
  last_n_games: number;
  wins: number;
  draws: number;
  losses: number;
  rating_trend: "rising" | "falling" | "stable";
}

export interface PlayerStats {
  username: string;
  platform: "chess.com" | "lichess";
  ratings: {
    bullet?: RatingInfo;
    blitz?: RatingInfo;
    rapid?: RatingInfo;
    classical?: RatingInfo;
  };
  win_rate: {
    overall: number;
    as_white: number;
    as_black: number;
  };
  opening_repertoire: {
    as_white: OpeningEntry[];
    as_black_vs_e4: OpeningEntry[];
    as_black_vs_d4: OpeningEntry[];
  };
  recent_form: RecentForm;
}

export interface ExpectedOpening {
  opening: string;
  frequency_percent: number;
  win_rate: number;
  trend: "increasing" | "decreasing" | "stable";
}

export interface ScoutReport {
  opponent_profile: PlayerStats;
  expected_openings: ExpectedOpening[];
  strengths: string[];
  weaknesses: string[];
  strategic_recommendation: string;
  opening_suggestion: string;
}
