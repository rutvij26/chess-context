import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UCIAnalysisLine } from "../types/index.js";

// ---------------------------------------------------------------------------
// Each test gets a fresh module instance so module-level state (activeBackend,
// readyPromise) doesn't leak between tests.
// ---------------------------------------------------------------------------

function makeLines(cp = 30): UCIAnalysisLine[] {
  return [{ depth: 18, score_cp: cp, score_mate: null, pv: ["e2e4"], multipv_rank: 1 }];
}

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Shared mock factories — recreated per test via vi.doMock + vi.resetModules

function mockCache(hit: UCIAnalysisLine[] | undefined = undefined) {
  vi.doMock("../cache/index.js", () => ({
    positionCacheKey: vi.fn((...args: unknown[]) => args.join(":")),
    getPositionEval: vi.fn().mockReturnValue(hit),
    setPositionEval: vi.fn(),
  }));
}

function mockConfig(enableLichessCloud = false) {
  vi.doMock("../config.js", () => ({
    config: {
      engine: {
        apiUrl: "http://localhost:8090",
        threads: 4,
        enableLichessCloud,
      },
      stockfish: {
        timeout: 30000,
        readinessTimeout: 90000,
        defaultDepth: 18,
        quietDepth: 12,
        maxDepth: 20,
        defaultMultiPv: 3,
      },
    },
  }));
}

function mockDocker(available: boolean, lines: UCIAnalysisLine[] = makeLines()) {
  const analyzePosition = vi.fn().mockResolvedValue(lines);
  vi.doMock("./stockfish-docker.js", () => ({
    isDockerAvailable: vi.fn().mockResolvedValue(available),
    analyzePosition,
  }));
  return { analyzePosition };
}

function mockWasm(poolReady = false, wasmReady = false, lines: UCIAnalysisLine[] = makeLines()) {
  const wasmAnalyze = vi.fn().mockResolvedValue(lines);
  const poolAnalyze = vi.fn().mockResolvedValue(lines);
  vi.doMock("./stockfish.js", () => ({
    initEngine: vi.fn().mockResolvedValue(undefined),
    analyzePosition: wasmAnalyze,
    isReady: vi.fn().mockReturnValue(wasmReady),
    shutdown: vi.fn(),
    waitUntilReady: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock("./stockfish-pool.js", () => ({
    initPool: vi.fn().mockResolvedValue(undefined),
    analyzePositionParallel: poolAnalyze,
    isPoolReady: vi.fn().mockReturnValue(poolReady),
    shutdownPool: vi.fn(),
  }));
  return { wasmAnalyze, poolAnalyze };
}

function mockLichess(lines: UCIAnalysisLine[] | null = null) {
  const getCloudEval = vi.fn().mockResolvedValue(lines);
  vi.doMock("./lichess-eval.js", () => ({ getCloudEval }));
  return { getCloudEval };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("engine-router — getEval cache", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns cached result and skips all engines", async () => {
    const cached = makeLines(99);
    mockCache(cached);
    mockConfig();
    mockDocker(false);
    mockWasm();
    mockLichess();

    const { getEval } = await import("./engine-router.js");
    const result = await getEval(STARTING_FEN, 18, 3);

    expect(result).toBe(cached);
  });
});

describe("engine-router — Docker routing", () => {
  beforeEach(() => { vi.resetModules(); });

  it("uses Docker when available and caches the result", async () => {
    const lines = makeLines(25);
    mockCache(undefined);
    mockConfig();
    const { analyzePosition: dockerAnalyze } = mockDocker(true, lines);
    mockWasm();
    mockLichess();

    const { initRouter, getEval } = await import("./engine-router.js");
    initRouter();
    await new Promise<void>((r) => setTimeout(r, 30)); // let async Docker check resolve

    const { setPositionEval } = await import("../cache/index.js");

    const result = await getEval(STARTING_FEN, 18, 3);

    expect(dockerAnalyze).toHaveBeenCalledWith(STARTING_FEN, { depth: 18, multiPv: 3 });
    expect(result).toEqual(lines);
    expect(vi.mocked(setPositionEval)).toHaveBeenCalled();
  });
});

describe("engine-router — WASM fallback", () => {
  beforeEach(() => { vi.resetModules(); });

  it("uses WASM pool when Docker is unavailable and pool is ready", async () => {
    const lines = makeLines(10);
    mockCache(undefined);
    mockConfig();
    mockDocker(false);
    const { poolAnalyze } = mockWasm(true, false, lines);
    mockLichess();

    const { initRouter, getEval } = await import("./engine-router.js");
    initRouter();
    await new Promise<void>((r) => setTimeout(r, 50));

    const result = await getEval(STARTING_FEN, 12, 1);

    expect(poolAnalyze).toHaveBeenCalledWith(STARTING_FEN, { depth: 12, multiPv: 1 });
    expect(result).toEqual(lines);
  });

  it("uses single WASM when Docker and pool are both unavailable", async () => {
    const lines = makeLines(5);
    mockCache(undefined);
    mockConfig();
    mockDocker(false);
    const { wasmAnalyze } = mockWasm(false, true, lines);
    mockLichess();

    const { initRouter, getEval } = await import("./engine-router.js");
    initRouter();
    await new Promise<void>((r) => setTimeout(r, 50));

    const result = await getEval(STARTING_FEN, 12, 1);

    expect(wasmAnalyze).toHaveBeenCalledWith(STARTING_FEN, { depth: 12, multiPv: 1 });
    expect(result).toEqual(lines);
  });
});

describe("engine-router — Lichess cloud eval (optional)", () => {
  beforeEach(() => { vi.resetModules(); });

  it("skips Lichess cloud eval when ENABLE_LICHESS_CLOUD is false", async () => {
    mockCache(undefined);
    mockConfig(false);
    mockDocker(true);
    mockWasm();
    const { getCloudEval } = mockLichess(makeLines(40));

    const { initRouter, getEval } = await import("./engine-router.js");
    initRouter();
    await new Promise<void>((r) => setTimeout(r, 30));

    await getEval(STARTING_FEN, 18, 3);

    expect(getCloudEval).not.toHaveBeenCalled();
  });

  it("uses Lichess cloud eval before engine when ENABLE_LICHESS_CLOUD is true", async () => {
    const cloudLines = makeLines(55);
    mockCache(undefined);
    mockConfig(true);
    const { analyzePosition: dockerAnalyze } = mockDocker(true);
    mockWasm();
    const { getCloudEval } = mockLichess(cloudLines);

    const { initRouter, getEval } = await import("./engine-router.js");
    initRouter();
    await new Promise<void>((r) => setTimeout(r, 30));

    const result = await getEval(STARTING_FEN, 18, 3);

    expect(getCloudEval).toHaveBeenCalledWith(STARTING_FEN, 3);
    expect(dockerAnalyze).not.toHaveBeenCalled();
    expect(result).toEqual(cloudLines);
  });
});

describe("engine-router — waitUntilRouterReady", () => {
  beforeEach(() => { vi.resetModules(); });

  it("resolves immediately when Docker is already available", async () => {
    mockCache(undefined);
    mockConfig();
    mockDocker(true);
    mockWasm();
    mockLichess();

    const { initRouter, waitUntilRouterReady } = await import("./engine-router.js");
    initRouter();
    await new Promise<void>((r) => setTimeout(r, 30));

    await expect(waitUntilRouterReady(1000)).resolves.toBeUndefined();
  });

  it("rejects after timeout if no engine becomes ready", async () => {
    mockCache(undefined);
    mockConfig();
    // Docker unavailable + WASM init never resolves
    mockDocker(false);
    vi.doMock("./stockfish.js", () => ({
      initEngine: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
      analyzePosition: vi.fn(),
      isReady: vi.fn().mockReturnValue(false),
      shutdown: vi.fn(),
    }));
    vi.doMock("./stockfish-pool.js", () => ({
      initPool: vi.fn().mockReturnValue(new Promise(() => {})),
      analyzePositionParallel: vi.fn(),
      isPoolReady: vi.fn().mockReturnValue(false),
      shutdownPool: vi.fn(),
    }));
    mockLichess();

    const { initRouter, waitUntilRouterReady } = await import("./engine-router.js");
    initRouter();

    await expect(waitUntilRouterReady(50)).rejects.toThrow(/did not initialize/i);
  });
});
