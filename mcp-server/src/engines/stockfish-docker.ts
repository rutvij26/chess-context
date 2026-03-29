/**
 * stockfish-docker.ts
 *
 * HTTP client for the Stockfish engine running in Docker (engine-server/server.js).
 * The container exposes:
 *   POST /analyze  { fen, depth, multiPv, timeoutMs? } → { lines: UCIAnalysisLine[] }
 *   GET  /health   → { status: "ready"|"warming_up", threads: N }
 */

import axios from "axios";
import { config } from "../config.js";
import type { UCIAnalysisLine, StockfishOptions } from "../types/index.js";

interface HealthResponse {
  status: "ready" | "warming_up";
  threads: number;
}

interface AnalyzeResponse {
  lines: UCIAnalysisLine[];
}

/**
 * Returns true if the Docker Stockfish container is reachable and reports "ready".
 * Uses a 2-second timeout so startup is not blocked.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const resp = await axios.get<HealthResponse>(`${config.engine.apiUrl}/health`, {
      timeout: 2000,
    });
    return resp.data.status === "ready";
  } catch {
    return false;
  }
}

/**
 * Analyze a position via the Docker Stockfish HTTP API.
 * Throws if the container is unreachable or returns an error.
 */
export async function analyzePosition(
  fen: string,
  options: StockfishOptions
): Promise<UCIAnalysisLine[]> {
  const resp = await axios.post<AnalyzeResponse>(
    `${config.engine.apiUrl}/analyze`,
    {
      fen,
      depth: options.depth,
      multiPv: options.multiPv,
      timeoutMs: config.stockfish.timeout,
    },
    { timeout: config.stockfish.timeout + 5000 }
  );
  return resp.data.lines;
}
