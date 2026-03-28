import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initEngine, shutdown } from "./engines/stockfish.js";
import { handleAnalyzePosition } from "./tools/analyze-position.js";
import { handleAnalyzeGame } from "./tools/analyze-game.js";
import { handleGetPlayerStats } from "./tools/get-player-stats.js";
import { handleScoutOpponent } from "./tools/scout-opponent.js";
import {
  AnalyzePositionInputSchema,
  AnalyzeGameInputSchema,
  GetPlayerStatsInputSchema,
  ScoutOpponentInputSchema,
} from "./types/index.js";

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "chess-context",
  version: "0.1.0",
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
      "Analyze an entire chess game from PGN, a Lichess URL, or a Lichess game ID. Returns a full review including accuracy for each player, critical moments (blunders, mistakes, missed wins), phase breakdown, and detected patterns.",
    inputSchema: AnalyzeGameInputSchema,
  },
  async (input) => {
    const result = await handleAnalyzeGame(input);
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

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ChessContext] MCP server running on stdio.");

  // Initialize Stockfish after the MCP handshake so we don't block the
  // initialize request (WASM load can take 30-60s on first run).
  console.error("[ChessContext] Initializing Stockfish engine...");
  initEngine()
    .then(() => console.error("[ChessContext] Stockfish engine ready."))
    .catch((err: unknown) => console.error("[ChessContext] Stockfish init failed:", err));
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.error("[ChessContext] Shutting down...");
  await shutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.error("[ChessContext] Shutting down...");
  await shutdown();
  process.exit(0);
});

main().catch((err: unknown) => {
  console.error("[ChessContext] Fatal error:", err);
  process.exit(1);
});
