/**
 * stockfish-pool.test.ts
 *
 * Unit tests for the Stockfish worker pool.
 * All Worker Thread creation is mocked — no real engine is started.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UCIAnalysisLine } from "../types/index.js";

// ---------------------------------------------------------------------------
// Mock worker_threads so no real worker process is spawned
// ---------------------------------------------------------------------------

type WorkerEventMap = {
  message: ((msg: unknown) => void)[];
  error: ((err: Error) => void)[];
  exit: ((code: number) => void)[];
};

interface MockWorker {
  postMessage: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  _emit: (event: keyof WorkerEventMap, ...args: unknown[]) => void;
  _listeners: WorkerEventMap;
}

function createMockWorker(): MockWorker {
  const listeners: WorkerEventMap = { message: [], error: [], exit: [] };

  const w: MockWorker = {
    postMessage: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined),
    _listeners: listeners,
    _emit(event: keyof WorkerEventMap, ...args: unknown[]) {
      const handlers = listeners[event] as ((...a: unknown[]) => void)[];
      for (const handler of [...handlers]) {
        handler(...args);
      }
    },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const key = event as keyof WorkerEventMap;
      if (listeners[key]) {
        (listeners[key] as ((...a: unknown[]) => void)[]).push(handler);
      }
      return w;
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const key = event as keyof WorkerEventMap;
      if (listeners[key]) {
        const idx = (listeners[key] as ((...a: unknown[]) => void)[]).indexOf(handler);
        if (idx !== -1) {
          (listeners[key] as ((...a: unknown[]) => void)[]).splice(idx, 1);
        }
      }
      return w;
    }),
  };
  return w;
}

const mockWorkers: MockWorker[] = [];

vi.mock("worker_threads", () => ({
  // Must use `function` (not arrow) so `new Worker()` works as a constructor.
  // Returning an explicit object from a constructor function overrides `this`.
  Worker: vi.fn(function (_path: string, _opts: unknown) {
    const w = createMockWorker();
    mockWorkers.push(w);
    return w;
  }),
  workerData: {},
  parentPort: null,
  isMainThread: true,
}));

// ---------------------------------------------------------------------------
// Re-import module under test AFTER mocking
// ---------------------------------------------------------------------------

// We import the pool functions dynamically after each reset so the module
// state is clean per test group. For simplicity, we use a fresh vi.resetModules
// and dynamic import in each describe block.

async function loadPool() {
  const mod = await import("./stockfish-pool.js");
  return mod;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResultLine(cp = 30): UCIAnalysisLine {
  return {
    depth: 12,
    score_cp: cp,
    score_mate: null,
    pv: ["e2e4"],
    multipv_rank: 1,
  };
}

/**
 * Simulate a worker becoming "ready" by emitting the 'ready' message.
 * Called after initPool() is invoked but before it resolves.
 */
function emitReadyOnAll() {
  for (const w of mockWorkers) {
    w._emit("message", { type: "ready" });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StockfishPool — isPoolReady", () => {
  beforeEach(() => {
    mockWorkers.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false before initPool is called", async () => {
    const { isPoolReady } = await loadPool();
    expect(isPoolReady()).toBe(false);
  });

  it("returns true after pool initializes successfully", async () => {
    const { initPool, isPoolReady, shutdownPool } = await loadPool();

    const initPromise = initPool(1);
    emitReadyOnAll();
    await initPromise;

    expect(isPoolReady()).toBe(true);
    await shutdownPool();
  });
});

describe("StockfishPool — analyzePositionParallel", () => {
  beforeEach(() => {
    mockWorkers.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches analysis to a worker and resolves with the result", async () => {
    const { initPool, analyzePositionParallel, shutdownPool } = await loadPool();

    const initPromise = initPool(1);
    emitReadyOnAll();
    await initPromise;

    const analysisPromise = analyzePositionParallel(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      { depth: 12, multiPv: 1 }
    );

    // Simulate worker returning a result
    const worker = mockWorkers[0]!;
    worker._emit("message", { type: "result", lines: [makeResultLine(30)] });

    const lines = await analysisPromise;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.score_cp).toBe(30);

    await shutdownPool();
  });

  it("rejects when the worker returns an error message", async () => {
    const { initPool, analyzePositionParallel, shutdownPool } = await loadPool();

    const initPromise = initPool(1);
    emitReadyOnAll();
    await initPromise;

    const analysisPromise = analyzePositionParallel(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      { depth: 12, multiPv: 1 }
    );

    const worker = mockWorkers[0]!;
    worker._emit("message", { type: "error", message: "Engine crashed" });

    await expect(analysisPromise).rejects.toThrow("Engine crashed");

    await shutdownPool();
  });

  it("queues requests when all workers are busy and dispatches when one frees", async () => {
    const { initPool, analyzePositionParallel, shutdownPool } = await loadPool();

    const initPromise = initPool(1);
    emitReadyOnAll();
    await initPromise;

    const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    // Submit two requests to a pool of 1 — the second will be queued
    const p1 = analyzePositionParallel(FEN, { depth: 12, multiPv: 1 });
    const p2 = analyzePositionParallel(FEN, { depth: 12, multiPv: 1 });

    const worker = mockWorkers[0]!;

    // Resolve first request
    worker._emit("message", { type: "result", lines: [makeResultLine(10)] });
    const result1 = await p1;
    expect(result1[0]!.score_cp).toBe(10);

    // Now second request should be dispatched — resolve it
    worker._emit("message", { type: "result", lines: [makeResultLine(20)] });
    const result2 = await p2;
    expect(result2[0]!.score_cp).toBe(20);

    await shutdownPool();
  });

  it("uses both workers in parallel when pool size is 2", async () => {
    const { initPool, analyzePositionParallel, shutdownPool } = await loadPool();

    const initPromise = initPool(2);
    emitReadyOnAll();
    await initPromise;

    const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    const p1 = analyzePositionParallel(FEN, { depth: 12, multiPv: 1 });
    const p2 = analyzePositionParallel(FEN, { depth: 12, multiPv: 1 });

    // Both workers should have received a postMessage (both are busy now)
    const w1 = mockWorkers[0]!;
    const w2 = mockWorkers[1]!;
    expect(w1.postMessage).toHaveBeenCalled();
    expect(w2.postMessage).toHaveBeenCalled();

    w1._emit("message", { type: "result", lines: [makeResultLine(5)] });
    w2._emit("message", { type: "result", lines: [makeResultLine(15)] });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1[0]!.score_cp).toBe(5);
    expect(r2[0]!.score_cp).toBe(15);

    await shutdownPool();
  });
});

describe("StockfishPool — shutdownPool", () => {
  beforeEach(() => {
    mockWorkers.length = 0;
    vi.resetModules();
  });

  it("terminates all workers and resets state", async () => {
    const { initPool, isPoolReady, shutdownPool } = await loadPool();

    const initPromise = initPool(2);
    emitReadyOnAll();
    await initPromise;

    expect(isPoolReady()).toBe(true);
    await shutdownPool();
    expect(isPoolReady()).toBe(false);
  });
});
