import { homedir } from "os";
import { join } from "path";

export const config = {
  stockfish: {
    defaultDepth: parseInt(process.env["STOCKFISH_DEPTH"] ?? "18"),
    quietDepth: parseInt(process.env["STOCKFISH_QUIET_DEPTH"] ?? "10"),
    criticalDepth: parseInt(process.env["STOCKFISH_CRITICAL_DEPTH"] ?? "16"),
    maxDepth: parseInt(process.env["STOCKFISH_MAX_DEPTH"] ?? "20"),
    timeout: parseInt(process.env["STOCKFISH_TIMEOUT"] ?? "30000"),
    readinessTimeout: Number(process.env["STOCKFISH_READINESS_TIMEOUT"]) || 90_000,
    defaultMultiPv: 3,
  },
  engine: {
    // URL of the Docker Stockfish HTTP API. If unreachable, WASM is used as fallback.
    apiUrl: process.env["STOCKFISH_API_URL"] ?? "http://localhost:8090",
    // Threads to advertise to the Docker container (informational; set via container env).
    threads: parseInt(process.env["STOCKFISH_THREADS"] ?? "4"),
    // Set ENABLE_LICHESS_CLOUD=true to try Lichess cloud eval before the engine.
    enableLichessCloud: process.env["ENABLE_LICHESS_CLOUD"] === "true",
  },
  lichess: {
    token: process.env["LICHESS_TOKEN"],
    baseUrl: "https://lichess.org",
    cloudEvalUrl: "https://lichess.org/api/cloud-eval",
  },
  chesscom: {
    baseUrl: "https://api.chess.com/pub",
  },
  cache: {
    positionMaxSize: 500,
    playerMaxSize: 100,
    playerTtlMs: 5 * 60 * 1000, // 5 minutes
    dbPath:
      process.env["EVAL_CACHE_DB"] ??
      join(homedir(), ".chess-context", "eval-cache.db"),
  },
  analysis: {
    // Eval delta threshold (cp) to use full depth vs quiet depth
    quietThreshold: 30,
    // Centipawn thresholds for move classification
    blunderThreshold: 200,
    mistakeThreshold: 100,
    inaccuracyThreshold: 50,
    // Games to fetch for player stats
    recentGamesCount: 50,
    // Games for recent form calculation
    recentFormCount: 20,
    // Moves used for opening repertoire
    openingMoveDepth: 5,
  },
} as const;
