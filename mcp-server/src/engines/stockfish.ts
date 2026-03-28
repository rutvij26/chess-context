import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "../config.js";
import type { UCIAnalysisLine, StockfishOptions } from "../types/index.js";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types for the raw stockfish.js instance
// ---------------------------------------------------------------------------

interface StockfishInstance {
  addMessageListener(handler: (line: string) => void): void;
  postMessage(cmd: string): void;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let engine: StockfishInstance | null = null;
let engineReady = false;

// Resolves when the engine receives its first `readyok`
let resolveEngineReady: (() => void) | null = null;
const engineReadyPromise: Promise<void> = new Promise<void>((resolve) => {
  resolveEngineReady = resolve;
});

// Pending analysis request
interface PendingRequest {
  depth: number;
  multiPv: number;
  lines: Map<number, UCIAnalysisLine>; // keyed by multipv rank
  resolve: (lines: UCIAnalysisLine[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let pending: PendingRequest | null = null;

// Queue of requests waiting to be processed
interface QueueEntry {
  fen: string;
  options: StockfishOptions;
  resolve: (lines: UCIAnalysisLine[]) => void;
  reject: (err: Error) => void;
}

const queue: QueueEntry[] = [];

// ---------------------------------------------------------------------------
// UCI output parser
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
// Message handler
// ---------------------------------------------------------------------------

function onMessage(line: string): void {
  if (line === "uciok" || line.startsWith("id ") || line.startsWith("option ")) {
    return;
  }

  if (line === "readyok") {
    engineReady = true;
    resolveEngineReady?.();
    processQueue();
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
    processQueue();
    resolve(results);
  }
}

// ---------------------------------------------------------------------------
// Queue processing
// ---------------------------------------------------------------------------

function processQueue(): void {
  if (pending || !engineReady || queue.length === 0) return;

  const next = queue.shift();
  if (!next) return;

  runAnalysis(next.fen, next.options, next.resolve, next.reject);
}

function runAnalysis(
  fen: string,
  options: StockfishOptions,
  resolve: (lines: UCIAnalysisLine[]) => void,
  reject: (err: Error) => void
): void {
  if (!engine) {
    reject(new Error("Stockfish engine is not initialized"));
    return;
  }

  const timer = setTimeout(() => {
    if (pending) {
      engine?.postMessage("stop");
      const err = new Error(`Stockfish timeout after ${config.stockfish.timeout}ms`);
      const r = pending.reject;
      pending = null;
      processQueue();
      r(err);
    }
  }, config.stockfish.timeout);

  pending = {
    depth: options.depth,
    multiPv: options.multiPv,
    lines: new Map(),
    resolve,
    reject,
    timer,
  };

  engine.postMessage(`setoption name MultiPV value ${options.multiPv}`);
  engine.postMessage(`position fen ${fen}`);
  engine.postMessage(`go depth ${options.depth}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initEngine(): Promise<void> {
  const sfPath = join(
    __dirname,
    "../../node_modules/stockfish/bin/stockfish-18-single.js"
  );
  const wasmPath = join(
    __dirname,
    "../../node_modules/stockfish/bin/stockfish-18-single.wasm"
  );

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

  engine.addMessageListener(onMessage);

  await new Promise<void>((resolve) => {
    engine!.postMessage("uci");
    // Wait for readyok
    const interval = setInterval(() => {
      if (engineReady) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
    engine!.postMessage("isready");
  });

  console.error("[Stockfish] Engine initialized");
}

export function isReady(): boolean {
  return engineReady && engine !== null;
}

/**
 * Returns a promise that resolves when the engine has sent `readyok`,
 * or rejects with a clear error if `timeoutMs` elapses first.
 */
export function waitUntilReady(timeoutMs = 90_000): Promise<void> {
  if (engineReady) return Promise.resolve();

  return Promise.race([
    engineReadyPromise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Stockfish engine did not initialize within ${timeoutMs}ms. ` +
                "Please retry in a moment — the engine is still warming up."
            )
          ),
        timeoutMs
      )
    ),
  ]);
}

export async function analyzePosition(
  fen: string,
  options?: Partial<StockfishOptions>
): Promise<UCIAnalysisLine[]> {
  const opts: StockfishOptions = {
    depth: options?.depth ?? config.stockfish.defaultDepth,
    multiPv: options?.multiPv ?? config.stockfish.defaultMultiPv,
  };

  return new Promise<UCIAnalysisLine[]>((resolve, reject) => {
    if (!engineReady || pending) {
      queue.push({ fen, options: opts, resolve, reject });
      return;
    }
    runAnalysis(fen, opts, resolve, reject);
  });
}

export async function shutdown(): Promise<void> {
  if (engine) {
    engine.postMessage("quit");
    engine = null;
    engineReady = false;
  }
}
