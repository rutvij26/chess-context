import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { shutdown } from "./engines/stockfish.js";
import { shutdownPool } from "./engines/stockfish-pool.js";
import { initRouter, shutdownRouter } from "./engines/engine-router.js";
import { migrate, closeDb, isDbConfigured } from "./store/db.js";
import { handleAnalyzePosition } from "./tools/analyze-position.js";
import { handleAnalyzeGame } from "./tools/analyze-game.js";
import { handleGetPlayerStats } from "./tools/get-player-stats.js";
import { handleScoutOpponent } from "./tools/scout-opponent.js";
import { handleRefreshGames } from "./tools/refresh-games.js";
import { handleReviewGame } from "./tools/review-game.js";
import { handleGetMistakePatterns } from "./tools/get-mistake-patterns.js";
import { handleGetStyleFingerprint } from "./tools/get-style-fingerprint.js";
import { handleGetAnalysisProgress } from "./tools/get-analysis-progress.js";
import { handleGetOpeningTheory } from "./tools/get-opening-theory.js";
import { handleFindOpeningGaps } from "./tools/find-opening-gaps.js";
import { handleGeneratePuzzles } from "./tools/generate-puzzles.js";
import {
  AnalyzePositionInputSchema,
  AnalyzeGameInputSchema,
  GetPlayerStatsInputSchema,
  ScoutOpponentInputSchema,
  RefreshGamesInputSchema,
  ReviewGameInputSchema,
  GetMistakePatternsInputSchema,
  GetStyleFingerprintInputSchema,
  GetAnalysisProgressInputSchema,
  GetOpeningTheoryInputSchema,
  FindOpeningGapsInputSchema,
  GeneratePuzzlesInputSchema,
} from "./types/index.js";

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "chess-context",
  version: "0.7.0",
});

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

server.registerTool(
  "analyze_position",
  {
    title: "Analyze Chess Position",
    description:
      "Analyze a chess position from a FEN string. Returns engine evaluation, top moves with explanations, and rich semantic context including game phase, pawn structures, tactical/strategic themes, and a human-readable narrative.",
    inputSchema: AnalyzePositionInputSchema,
  },
  async (input) => {
    const result = await handleAnalyzePosition(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "analyze_game",
  {
    title: "Analyze Chess Game",
    description:
      "Analyze an entire chess game. Accepts: a raw PGN string, a Chess.com game URL (https://www.chess.com/game/live/...), a Lichess game URL or game ID, or a Chess.com username to automatically fetch and analyze that player's most recent game. Returns a full review including accuracy for each player, critical moments (blunders, mistakes, missed wins), phase breakdown, and detected patterns.",
    inputSchema: AnalyzeGameInputSchema,
  },
  async (input, extra) => {
    const progressToken = extra._meta?.progressToken;

    const onProgress = progressToken !== undefined
      ? (completed: number, total: number): void => {
          void extra.sendNotification({
            method: "notifications/progress",
            params: { progressToken, progress: completed, total },
          }).catch(() => {});
        }
      : undefined;

    const result = await handleAnalyzeGame(input, onProgress);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "get_player_stats",
  {
    title: "Get Player Statistics",
    description:
      "Fetch comprehensive statistics for a Chess.com or Lichess player. Returns ratings across time controls, win rates by color, opening repertoire (top openings with win rates), and recent form.",
    inputSchema: GetPlayerStatsInputSchema,
  },
  async (input) => {
    const result = await handleGetPlayerStats(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "scout_opponent",
  {
    title: "Scout Opponent",
    description:
      "Generate a pre-game scouting report for an upcoming opponent. Analyzes their opening repertoire, identifies strengths and weaknesses, and provides strategic recommendations including which openings to play or avoid.",
    inputSchema: ScoutOpponentInputSchema,
  },
  async (input) => {
    const result = await handleScoutOpponent(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "refresh_games",
  {
    title: "Refresh Games",
    description:
      "Fetch and store a player's recent games from Chess.com or Lichess into the local game store, then queue them for engine analysis in the background. " +
      "Run this before using get_mistake_patterns or get_style_fingerprint — those tools read from the stored analyses. " +
      "Returns immediately; analysis runs in the background (allow ~30-60s per 20 games on first run, near-instant on reruns thanks to eval cache). " +
      "Requires DATABASE_URL to be configured and Postgres running (docker compose up -d postgres).",
    inputSchema: RefreshGamesInputSchema,
  },
  async (input) => {
    const result = await handleRefreshGames(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "review_game",
  {
    title: "Review Game",
    description:
      "One-click post-game debrief for a specific game. Analyzes accuracy by phase, identifies the key turning point, and provides study recommendations. " +
      "Output depth adapts to the player's rating: beginners get plain English, club players see engine lines for critical moments, advanced players get full technical detail. " +
      "Accepts the same inputs as analyze_game (PGN, URL, or Lichess ID) plus a player_username to review from that player's perspective.",
    inputSchema: ReviewGameInputSchema,
  },
  async (input) => {
    const result = await handleReviewGame(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "get_mistake_patterns",
  {
    title: "Get Mistake Patterns",
    description:
      "Scan a player's stored game analyses and identify recurring mistake patterns — not just 'you blundered 5 times' but systematic weaknesses like 'you consistently blunder under time pressure in moves 30-50'. " +
      "Detects: blunder clusters in time pressure, opening preparation gaps, endgame technique failures, hanging pieces, and repeated opening collapses. " +
      "Requires refresh_games to have been run first to populate the game store.",
    inputSchema: GetMistakePatternsInputSchema,
  },
  async (input) => {
    const result = await handleGetMistakePatterns(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "get_style_fingerprint",
  {
    title: "Get Style Fingerprint",
    description:
      "Characterize a player's chess style across 5 dimensions derived from their stored game analyses: aggression, positional sense, tactical sharpness, endgame skill, and time management (Lichess only). " +
      "Returns a style label (e.g. 'Aggressive Tactician', 'Solid Positional Player') and a narrative description. " +
      "Requires refresh_games to have been run first. time_management is null for Chess.com players (no clock data available).",
    inputSchema: GetStyleFingerprintInputSchema,
  },
  async (input) => {
    const result = await handleGetStyleFingerprint(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "get_analysis_progress",
  {
    title: "Get Analysis Progress",
    description:
      "Check how many of a player's stored games have been analyzed by the engine. " +
      "Returns counts for analyzed, pending, processing, and failed games, plus an overall progress percentage. " +
      "Use this after refresh_games to monitor when background analysis is complete before calling get_mistake_patterns or get_style_fingerprint.",
    inputSchema: GetAnalysisProgressInputSchema,
  },
  async (input) => {
    const result = await handleGetAnalysisProgress(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "get_opening_theory",
  {
    title: "Get Opening Theory",
    description:
      "Fetch opening theory for any chess position. Provide a FEN string or an opening name (e.g. 'Sicilian Defense', 'Ruy Lopez'). Returns the opening name, ECO code, key strategic ideas, main continuations from Lichess master games, win statistics, historical context, and an explanation adapted to your level (beginner/club/advanced).",
    inputSchema: GetOpeningTheoryInputSchema,
  },
  async (input) => {
    const result = await handleGetOpeningTheory(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "find_opening_gaps",
  {
    title: "Find Opening Gaps",
    description:
      "Detect repertoire blind spots by scanning a player's recent games. Identifies positions reached 3+ times where opponents deviate from the expected line and the player scores poorly. No engine required — works purely from game history. Returns gaps sorted by impact with study suggestions. Supports Chess.com and Lichess.",
    inputSchema: FindOpeningGapsInputSchema,
  },
  async (input) => {
    const result = await handleFindOpeningGaps(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  "generate_puzzles",
  {
    title: "Generate Puzzles",
    description:
      "Extract tactical puzzles from a player's own analyzed games. Finds positions where a blunder occurred and the engine shows a forcing continuation. Returns puzzles with FEN, solution (SAN sequence), difficulty tier (easy/medium/hard), eval swing, and tactical theme. " +
      "Requires refresh_games to have been run first. Filter by difficulty or puzzle type (tactical/positional/endgame).",
    inputSchema: GeneratePuzzlesInputSchema,
  },
  async (input) => {
    const result = await handleGeneratePuzzles(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ChessContext] MCP server running on stdio.");

  // Initialize engine after the MCP handshake so we don't block the
  // initialize request. Router checks Docker first (fast), then falls back
  // to WASM if Docker is unavailable.
  console.error("[ChessContext] Initializing engine (Docker preferred, WASM fallback)...");
  initRouter();

  // Apply database schema if DATABASE_URL is configured.
  if (isDbConfigured()) {
    migrate().catch((err: unknown) => {
      console.error("[ChessContext] DB migration failed:", err);
    });
  }
}

// Graceful shutdown
async function gracefulShutdown(): Promise<void> {
  console.error("[ChessContext] Shutting down...");
  shutdownRouter();
  await Promise.allSettled([shutdown(), shutdownPool(), closeDb()]);
  process.exit(0);
}

process.on("SIGTERM", () => { void gracefulShutdown(); });
process.on("SIGINT", () => { void gracefulShutdown(); });

main().catch((err: unknown) => {
  console.error("[ChessContext] Fatal error:", err);
  process.exit(1);
});
