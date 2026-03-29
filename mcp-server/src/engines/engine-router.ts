/**
 * engine-router.ts
 *
 * Selects the best available chess engine and provides a unified
 * eval interface used by all tool handlers.
 *
 * Priority:
 *   1. Docker Stockfish (native binary, multi-threaded, HTTP)
 *   2. WASM worker pool (parallel, if pool init'd)
 *   3. WASM single-thread (sequential fallback)
 *
 * Usage:
 *   initRouter()                       — call once after server.connect()
 *   await waitUntilRouterReady(90_000) — block a tool call until any engine is ready
 *   getEval(fen, depth, multiPv)       — returns UCIAnalysisLine[] (cache + route + cache)
 *   shutdownRouter()                   — call during graceful shutdown
 */

import { getPositionEval, setPositionEval, positionCacheKey } from "../cache/index.js";
import { isDockerAvailable, analyzePosition as dockerAnalyze } from "./stockfish-docker.js";
import {
  analyzePosition as wasmAnalyze,
  initEngine,
  isReady as isWasmReady,
} from "./stockfish.js";
import { analyzePositionParallel, initPool, isPoolReady } from "./stockfish-pool.js";
import { getCloudEval } from "./lichess-eval.js";
import { config } from "../config.js";
import type { UCIAnalysisLine, StockfishOptions } from "../types/index.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type EngineBackend = "docker" | "pool" | "wasm" | "none";

let activeBackend: EngineBackend = "none";
let healthCheckTimer: ReturnType<typeof setTimeout> | null = null;

let resolveReady: (() => void) | null = null;
const readyPromise: Promise<void> = new Promise<void>((r) => {
  resolveReady = r;
});

function markReady(): void {
  if (resolveReady) {
    resolveReady();
    resolveReady = null;
  }
}

// ---------------------------------------------------------------------------
// Docker health polling
// ---------------------------------------------------------------------------

function scheduleHealthCheck(): void {
  healthCheckTimer = setTimeout(() => {
    void (async () => {
      const dockerUp = await isDockerAvailable();

      if (dockerUp && activeBackend !== "docker") {
        activeBackend = "docker";
        markReady();
        console.error("[EngineRouter] Docker Stockfish became available, switching to it.");
      } else if (!dockerUp && activeBackend === "docker") {
        activeBackend = isPoolReady() ? "pool" : isWasmReady() ? "wasm" : "none";
        console.error(`[EngineRouter] Docker went down, falling back to: ${activeBackend}.`);
      }

      scheduleHealthCheck();
    })();
  }, 30_000);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the router. Fire-and-forget — does not block the MCP handshake.
 * Tries Docker first; falls back to WASM if Docker is unreachable.
 */
export function initRouter(): void {
  void (async () => {
    const dockerUp = await isDockerAvailable();

    if (dockerUp) {
      activeBackend = "docker";
      markReady();
      console.error("[EngineRouter] Docker Stockfish ready.");
    } else {
      console.error("[EngineRouter] Docker unavailable, starting WASM Stockfish...");

      // Start pool and single engine concurrently; both are optional.
      void initPool(2).catch(() => {
        console.error("[EngineRouter] WASM pool failed, single-threaded fallback only.");
      });

      void initEngine()
        .then(() => {
          if (activeBackend === "none") {
            activeBackend = isPoolReady() ? "pool" : "wasm";
            markReady();
          }
          console.error(`[EngineRouter] WASM Stockfish ready (backend: ${activeBackend}).`);
        })
        .catch((err: unknown) => {
          console.error("[EngineRouter] WASM init failed:", err);
        });
    }

    scheduleHealthCheck();
  })();
}

/**
 * Returns a promise that resolves when any engine backend is ready,
 * or rejects after `timeoutMs` with a user-friendly error.
 */
export function waitUntilRouterReady(timeoutMs: number): Promise<void> {
  if (activeBackend !== "none") return Promise.resolve();

  return Promise.race([
    readyPromise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Engine did not initialize within ${timeoutMs}ms. ` +
                "Start the Docker container (docker run -d -p 8090:8090 mcp-chess-stockfish) " +
                "or wait 30–90 seconds for the WASM engine to warm up."
            )
          ),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Core eval function used by all tool handlers.
 * Checks cache first, optionally tries Lichess cloud, then routes to the
 * best available engine. Caches the result before returning.
 */
export async function getEval(
  fen: string,
  depth: number,
  multiPv: number
): Promise<UCIAnalysisLine[]> {
  const cacheKey = positionCacheKey(fen, depth, multiPv);
  const cached = getPositionEval(cacheKey);
  if (cached) return cached;

  // Optional Lichess cloud eval (disabled by default, fast for well-known positions)
  if (config.engine.enableLichessCloud) {
    const cloudLines = await getCloudEval(fen, multiPv).catch(() => null);
    if (cloudLines && cloudLines.length > 0) {
      setPositionEval(cacheKey, cloudLines);
      return cloudLines;
    }
  }

  const opts: StockfishOptions = { depth, multiPv };
  let lines: UCIAnalysisLine[] = [];

  try {
    if (activeBackend === "docker") {
      lines = await dockerAnalyze(fen, opts);
    } else if (activeBackend === "pool") {
      lines = await analyzePositionParallel(fen, opts);
    } else if (activeBackend === "wasm") {
      lines = await wasmAnalyze(fen, opts);
    }
  } catch (err: unknown) {
    console.error(`[EngineRouter] Analysis failed on ${activeBackend}:`, err);
    // If Docker failed, try WASM as emergency fallback
    if (activeBackend === "docker") {
      if (isPoolReady()) {
        lines = await analyzePositionParallel(fen, opts).catch((): UCIAnalysisLine[] => []);
      } else if (isWasmReady()) {
        lines = await wasmAnalyze(fen, opts).catch((): UCIAnalysisLine[] => []);
      }
    }
  }

  if (lines.length > 0) {
    setPositionEval(cacheKey, lines);
  }
  return lines;
}

/**
 * Clean up the health-check timer during graceful shutdown.
 */
export function shutdownRouter(): void {
  if (healthCheckTimer !== null) {
    clearTimeout(healthCheckTimer);
    healthCheckTimer = null;
  }
}
