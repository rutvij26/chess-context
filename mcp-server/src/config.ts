export const config = {
  stockfish: {
    defaultDepth: parseInt(process.env["STOCKFISH_DEPTH"] ?? "18"),
    quietDepth: parseInt(process.env["STOCKFISH_QUIET_DEPTH"] ?? "12"),
    maxDepth: parseInt(process.env["STOCKFISH_MAX_DEPTH"] ?? "20"),
    timeout: parseInt(process.env["STOCKFISH_TIMEOUT"] ?? "30000"),
    readinessTimeout: Number(process.env["STOCKFISH_READINESS_TIMEOUT"]) || 90_000,
    defaultMultiPv: 3,
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
