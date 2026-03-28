/**
 * stockfish-worker.ts
 *
 * Worker Thread entry point for Stockfish analysis.
 * Runs inside a Node.js Worker Thread; communicates with the pool via MessagePort.
 *
 * Protocol (messages received from parent):
 *   { type: 'analyze', fen: string, depth: number, multiPv: number }
 *   { type: 'shutdown' }
 *
 * Protocol (messages sent to parent):
 *   { type: 'ready' }
 *   { type: 'result', lines: UCIAnalysisLine[] }
 *   { type: 'error', message: string }
 */

import { workerData, parentPort } from "worker_threads";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { UCIAnalysisLine } from "../types/index.js";

if (!parentPort) {
  throw new Error("stockfish-worker must be run as a Worker Thread");
}

const port = parentPort;

// ---------------------------------------------------------------------------
// Worker config (passed via workerData)
// ---------------------------------------------------------------------------

interface WorkerData {
  stockfishBinDir: string;
  timeout: number;
}

const { stockfishBinDir, timeout } = workerData as WorkerData;

// ---------------------------------------------------------------------------
// Types for the raw stockfish.js instance
// ---------------------------------------------------------------------------

interface StockfishInstance {
  addMessageListener(handler: (line: string) => void): void;
  postMessage(cmd: string): void;
}

// ---------------------------------------------------------------------------
// UCI output parser (same logic as stockfish.ts)
// ---------------------------------------------------------------------------

function parseInfoLine(line: string): {
  rank: number;
  depth: number;
  score_cp: number | null;
  score_mate: number | null;
  pv: string[];
} | null {
  if (!line.startsWith("info ") || !line.includes(" pv ")) return null;

  const depthMatch = line.match(/\bdepth (\d+)/);
  const mpvMatch = line.match(/\bmultipv (\d+)/);
  const cpMatch = line.match(/\bscore cp (-?\d+)/);
  const mateMatch = line.match(/\bscore mate (-?\d+)/);
  const pvMatch = line.match(/ pv (.+)$/);

  if (!depthMatch || !pvMatch) return null;

  const depth = parseInt(depthMatch[1] ?? "0");
  const rank = mpvMatch ? parseInt(mpvMatch[1] ?? "1") : 1;
  const score_cp = cpMatch ? parseInt(cpMatch[1] ?? "0") : null;
  const score_mate = mateMatch ? parseInt(mateMatch[1] ?? "0") : null;
  const pv = (pvMatch[1] ?? "").trim().split(/\s+/);

  return { rank, depth, score_cp, score_mate, pv };
}

// ---------------------------------------------------------------------------
// Engine state
// ---------------------------------------------------------------------------

interface PendingAnalysis {
  depth: number;
  lines: Map<number, UCIAnalysisLine>;
  resolve: (lines: UCIAnalysisLine[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let engine: StockfishInstance | null = null;
let engineReady = false;
let pending: PendingAnalysis | null = null;

// ---------------------------------------------------------------------------
// Message handler from Stockfish engine
// ---------------------------------------------------------------------------

function onEngineMessage(line: string): void {
  if (line === "uciok" || line.startsWith("id ") || line.startsWith("option ")) {
    return;
  }

  if (line === "readyok") {
    engineReady = true;
    port.postMessage({ type: "ready" });
    return;
  }

  if (!pending) return;

  if (line.startsWith("info ") && line.includes(" pv ")) {
    const parsed = parseInfoLine(line);
    if (parsed && parsed.depth === pending.depth) {
      pending.lines.set(parsed.rank, {
        depth: parsed.depth,
        score_cp: parsed.score_cp,
        score_mate: parsed.score_mate,
        pv: parsed.pv,
        multipv_rank: parsed.rank,
      });
    }
    return;
  }

  if (line.startsWith("bestmove")) {
    clearTimeout(pending.timer);
    const results = Array.from(pending.lines.values()).sort(
      (a, b) => a.multipv_rank - b.multipv_rank
    );
    const resolve = pending.resolve;
    pending = null;
    resolve(results);
  }
}

// ---------------------------------------------------------------------------
// Run one analysis request
// ---------------------------------------------------------------------------

function runAnalysis(
  fen: string,
  depth: number,
  multiPv: number
): Promise<UCIAnalysisLine[]> {
  return new Promise<UCIAnalysisLine[]>((resolve, reject) => {
    if (!engine || !engineReady) {
      reject(new Error("Engine not ready"));
      return;
    }

    const timer = setTimeout(() => {
      if (pending) {
        engine?.postMessage("stop");
        const err = new Error(`Stockfish worker timeout after ${timeout}ms`);
        const r = pending.reject;
        pending = null;
        r(err);
      }
    }, timeout);

    pending = {
      depth,
      lines: new Map(),
      resolve,
      reject,
      timer,
    };

    engine.postMessage(`setoption name MultiPV value ${multiPv}`);
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go depth ${depth}`);
  });
}

// ---------------------------------------------------------------------------
// Initialize engine
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  const sfPath = join(stockfishBinDir, "stockfish-18-single.js");
  const wasmPath = join(stockfishBinDir, "stockfish-18-single.wasm");

  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const InitEngine = require(sfPath) as () => (mod: {
    locateFile: (path: string) => string;
  }) => Promise<StockfishInstance>;

  engine = await InitEngine()({
    locateFile: (path: string) => {
      if (path.endsWith(".wasm")) return wasmPath;
      return path;
    },
  });

  engine.addMessageListener(onEngineMessage);
  engine.postMessage("uci");
  engine.postMessage("isready");

  // Wait for readyok (signalled by setting engineReady = true and posting 'ready')
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (engineReady) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
}

// ---------------------------------------------------------------------------
// Message handler from parent (pool)
// ---------------------------------------------------------------------------

port.on("message", async (msg: unknown) => {
  if (!msg || typeof msg !== "object") return;
  const message = msg as Record<string, unknown>;

  if (message["type"] === "shutdown") {
    engine?.postMessage("quit");
    process.exit(0);
  }

  if (message["type"] === "analyze") {
    const fen = message["fen"] as string;
    const depth = message["depth"] as number;
    const multiPv = message["multiPv"] as number;

    try {
      const lines = await runAnalysis(fen, depth, multiPv);
      port.postMessage({ type: "result", lines });
    } catch (err: unknown) {
      const message_ = err instanceof Error ? err.message : String(err);
      port.postMessage({ type: "error", message: message_ });
    }
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[StockfishWorker] Failed to init engine: ${msg}`);
  port.postMessage({ type: "error", message: `Worker init failed: ${msg}` });
});
