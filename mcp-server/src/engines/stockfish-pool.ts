/**
 * stockfish-pool.ts
 *
 * A pool of N Stockfish Worker Threads for parallel position analysis.
 * Each worker runs one analysis at a time; requests beyond current capacity
 * are queued and dispatched when a worker becomes free.
 *
 * Public API:
 *   initPool(size?)           — start N worker threads (default: 2)
 *   analyzePositionParallel() — submit an analysis request to the pool
 *   shutdownPool()            — terminate all workers
 *   isPoolReady()             — true when at least one worker is available
 */

import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "../config.js";
import type { UCIAnalysisLine, StockfishOptions } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POOL_SIZE = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueEntry {
  fen: string;
  options: StockfishOptions;
  resolve: (lines: UCIAnalysisLine[]) => void;
  reject: (err: Error) => void;
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "result"; lines: UCIAnalysisLine[] }
  | { type: "error"; message: string };

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  pending: QueueEntry | null;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const workers: PoolWorker[] = [];
const queue: QueueEntry[] = [];
let poolInitialized = false;

// ---------------------------------------------------------------------------
// Worker creation
// ---------------------------------------------------------------------------

function createPoolWorker(stockfishBinDir: string): Promise<PoolWorker> {
  return new Promise<PoolWorker>((resolve, reject) => {
    // Worker file is compiled to dist/engines/stockfish-worker.js
    // At runtime __dirname is either src/ (tsx dev) or dist/ (compiled)
    const workerPath = join(__dirname, "stockfish-worker.js");

    const worker = new Worker(workerPath, {
      workerData: {
        stockfishBinDir,
        timeout: config.stockfish.timeout,
      },
    });

    const poolWorker: PoolWorker = {
      worker,
      busy: false,
      pending: null,
    };

    let initialized = false;

    const onMessage = (msg: WorkerMessage): void => {
      if (!initialized) {
        if (msg.type === "ready") {
          initialized = true;
          worker.on("message", onWorkerMessage.bind(null, poolWorker));
          worker.off("message", onMessage);
          resolve(poolWorker);
        } else if (msg.type === "error") {
          reject(new Error(`Worker failed to init: ${msg.message}`));
        }
        return;
      }
    };

    worker.on("message", onMessage);

    worker.on("error", (err) => {
      if (!initialized) {
        reject(err);
        return;
      }
      // Worker crashed mid-analysis — reject the pending request
      if (poolWorker.pending) {
        const entry = poolWorker.pending;
        poolWorker.pending = null;
        poolWorker.busy = false;
        const errMsg = err instanceof Error ? err.message : String(err);
        entry.reject(new Error(`Worker crashed: ${errMsg}`));
        dispatchNext();
      }
    });

    worker.on("exit", (code) => {
      if (!initialized && code !== 0) {
        reject(new Error(`Worker exited with code ${code} before ready`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Worker message handler (during normal operation, after init)
// ---------------------------------------------------------------------------

function onWorkerMessage(poolWorker: PoolWorker, msg: WorkerMessage): void {
  const entry = poolWorker.pending;
  if (!entry) return;

  poolWorker.pending = null;
  poolWorker.busy = false;

  if (msg.type === "result") {
    entry.resolve(msg.lines);
  } else if (msg.type === "error") {
    entry.reject(new Error(msg.message));
  }

  dispatchNext();
}

// ---------------------------------------------------------------------------
// Dispatch queue
// ---------------------------------------------------------------------------

function dispatchNext(): void {
  if (queue.length === 0) return;

  const freeWorker = workers.find((w) => !w.busy);
  if (!freeWorker) return;

  const entry = queue.shift();
  if (!entry) return;

  dispatch(freeWorker, entry);
}

function dispatch(poolWorker: PoolWorker, entry: QueueEntry): void {
  poolWorker.busy = true;
  poolWorker.pending = entry;
  poolWorker.worker.postMessage({
    type: "analyze",
    fen: entry.fen,
    depth: entry.options.depth,
    multiPv: entry.options.multiPv,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initPool(size: number = DEFAULT_POOL_SIZE): Promise<void> {
  if (poolInitialized) return;

  const stockfishBinDir = join(__dirname, "../../node_modules/stockfish/bin");

  const results = await Promise.allSettled(
    Array.from({ length: size }, () => createPoolWorker(stockfishBinDir))
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      workers.push(result.value);
    } else {
      console.error(
        `[StockfishPool] Worker failed to start: ${(result.reason as Error).message}`
      );
    }
  }

  if (workers.length === 0) {
    throw new Error("StockfishPool: all workers failed to start");
  }

  poolInitialized = true;
  console.error(
    `[StockfishPool] Initialized ${workers.length}/${size} workers`
  );
}

export function isPoolReady(): boolean {
  return poolInitialized && workers.length > 0;
}

export async function analyzePositionParallel(
  fen: string,
  options?: Partial<StockfishOptions>
): Promise<UCIAnalysisLine[]> {
  const opts: StockfishOptions = {
    depth: options?.depth ?? config.stockfish.quietDepth,
    multiPv: options?.multiPv ?? 1,
  };

  return new Promise<UCIAnalysisLine[]>((resolve, reject) => {
    const entry: QueueEntry = { fen, options: opts, resolve, reject };

    const freeWorker = workers.find((w) => !w.busy);
    if (freeWorker) {
      dispatch(freeWorker, entry);
    } else {
      queue.push(entry);
    }
  });
}

export async function shutdownPool(): Promise<void> {
  for (const pw of workers) {
    pw.worker.postMessage({ type: "shutdown" });
  }
  await Promise.allSettled(workers.map((pw) => pw.worker.terminate()));
  workers.length = 0;
  queue.length = 0;
  poolInitialized = false;
  console.error("[StockfishPool] Shutdown complete");
}
