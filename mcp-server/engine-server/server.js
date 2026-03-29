// Thin HTTP-to-UCI bridge for native Stockfish binary.
// Runs inside the Docker container.
//
// POST /analyze  { fen, depth, multiPv, timeoutMs? } → { lines: UCIAnalysisLine[] }
// GET  /health   → { status: "ready"|"warming_up", threads: N }

"use strict";

const { spawn } = require("child_process");
const express = require("express");

const STOCKFISH_PATH = process.env.STOCKFISH_PATH || "stockfish";
const THREADS = parseInt(process.env.STOCKFISH_THREADS || "4", 10);
const HASH_MB = parseInt(process.env.STOCKFISH_HASH || "256", 10);
const PORT = parseInt(process.env.STOCKFISH_PORT || "8090", 10);
const DEFAULT_TIMEOUT_MS = parseInt(process.env.STOCKFISH_TIMEOUT || "30000", 10);

// ---------------------------------------------------------------------------
// Stockfish process management
// ---------------------------------------------------------------------------

let sf = null;
let sfReady = false;
let sfBuffer = "";

/** @type {Array<PendingRequest>} */
const requestQueue = [];

/** @type {PendingRequest|null} */
let currentRequest = null;

/**
 * @typedef {Object} PendingRequest
 * @property {string} fen
 * @property {number} depth
 * @property {number} multiPv
 * @property {number} timeoutMs  - always DEFAULT_TIMEOUT_MS, never caller-supplied
 * @property {Map<number, object>} lines
 * @property {(result: {lines: object[]}) => void} resolve
 * @property {(err: Error) => void} reject
 * @property {ReturnType<typeof setTimeout>|null} timer
 */

function spawnStockfish() {
  sf = spawn(STOCKFISH_PATH);
  sfBuffer = "";
  sfReady = false;

  sf.stdin.write(`setoption name Threads value ${THREADS}\n`);
  sf.stdin.write(`setoption name Hash value ${HASH_MB}\n`);
  sf.stdin.write("uci\n");
  sf.stdin.write("isready\n");

  sf.stdout.on("data", (data) => {
    sfBuffer += data.toString();
    const lines = sfBuffer.split("\n");
    sfBuffer = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line.trim());
    }
  });

  sf.stderr.on("data", (data) => {
    // Swallow Stockfish stderr (benchmark output, etc.)
    void data;
  });

  sf.on("error", (err) => {
    console.error(`[StockfishServer] Failed to spawn Stockfish: ${err.message}`);
    console.error(`[StockfishServer] Check STOCKFISH_PATH=${STOCKFISH_PATH}`);
    sfReady = false;
    setTimeout(spawnStockfish, 3000);
  });

  sf.on("exit", (code) => {
    console.error(`[StockfishServer] Stockfish exited (code=${code}), restarting in 1s...`);
    sfReady = false;
    sf = null;
    setTimeout(spawnStockfish, 1000);
  });
}

function handleLine(line) {
  if (line === "readyok") {
    sfReady = true;
    console.log(`[StockfishServer] Stockfish ready (${THREADS} threads, ${HASH_MB}MB hash).`);
    processQueue();
    return;
  }

  if (!currentRequest) return;

  if (line.startsWith("info ") && line.includes(" pv ")) {
    const depthMatch = line.match(/\bdepth (\d+)/);
    const mpvMatch = line.match(/\bmultipv (\d+)/);
    const cpMatch = line.match(/\bscore cp (-?\d+)/);
    const mateMatch = line.match(/\bscore mate (-?\d+)/);
    const pvMatch = line.match(/ pv (.+)$/);

    if (depthMatch && pvMatch) {
      const depth = parseInt(depthMatch[1], 10);
      if (depth === currentRequest.depth) {
        const rank = mpvMatch ? parseInt(mpvMatch[1], 10) : 1;
        const score_cp = cpMatch ? parseInt(cpMatch[1], 10) : null;
        const score_mate = mateMatch ? parseInt(mateMatch[1], 10) : null;
        const pv = pvMatch[1].trim().split(/\s+/);
        currentRequest.lines.set(rank, { depth, score_cp, score_mate, pv, multipv_rank: rank });
      }
    }
    return;
  }

  if (line.startsWith("bestmove")) {
    const req = currentRequest;
    currentRequest = null;
    if (req.timer !== null) clearTimeout(req.timer);
    const lines = Array.from(req.lines.values()).sort((a, b) => a.multipv_rank - b.multipv_rank);
    req.resolve({ lines });
    processQueue();
  }
}

function processQueue() {
  if (currentRequest || !sfReady || requestQueue.length === 0) return;
  const next = requestQueue.shift();
  if (next) runAnalysis(next);
}

function runAnalysis(req) {
  currentRequest = req;

  req.timer = setTimeout(() => {
    if (currentRequest === req) {
      if (sf) sf.stdin.write("stop\n");
      currentRequest = null;
      req.reject(new Error(`Analysis timed out after ${req.timeoutMs}ms`));
      processQueue();
    }
  }, req.timeoutMs);

  if (sf) {
    sf.stdin.write(`setoption name MultiPV value ${req.multiPv}\n`);
    sf.stdin.write(`position fen ${req.fen}\n`);
    sf.stdin.write(`go depth ${req.depth}\n`);
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: sfReady ? "ready" : "warming_up", threads: THREADS });
});

app.post("/analyze", (req, res) => {
  const { fen, depth = 18, multiPv = 3 } = req.body;

  if (!fen || typeof fen !== "string") {
    res.status(400).json({ error: "fen is required and must be a string" });
    return;
  }

  /** @type {PendingRequest} */
  const entry = {
    fen,
    depth: Math.min(Math.max(parseInt(String(depth), 10) || 18, 1), 24),
    multiPv: Math.min(Math.max(parseInt(String(multiPv), 10) || 3, 1), 5),
    // Timeout is always server-controlled via STOCKFISH_TIMEOUT env var — never
    // caller-supplied, to prevent resource exhaustion from crafted requests.
    timeoutMs: DEFAULT_TIMEOUT_MS,
    lines: new Map(),
    resolve: (result) => res.json(result),
    reject: (err) => res.status(500).json({ error: err.message }),
    timer: null,
  };

  requestQueue.push(entry);
  processQueue();
});

spawnStockfish();

app.listen(PORT, () => {
  console.log(`[StockfishServer] Listening on port ${PORT}`);
});
