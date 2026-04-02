import axios from "axios";
import { config } from "../config.js";
import type { UCIAnalysisLine } from "../types/index.js";

interface LichessCloudEvalPv {
  moves: string;
  cp?: number;
  mate?: number;
}

interface LichessCloudEvalResponse {
  fen: string;
  knodes: number;
  depth: number;
  pvs: LichessCloudEvalPv[];
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

class Semaphore {
  private slots: number;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    this.slots = limit;
  }

  acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.slots++;
    }
  }
}

// One semaphore per process; limit is read once at module load.
const cloudSemaphore = new Semaphore(config.lichess.cloudConcurrency);

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

const RETRY_DELAY_BASE_MS = 1_000;
const RETRY_DELAY_JITTER_MS = 1_000;

function retryDelay(): Promise<void> {
  const ms = RETRY_DELAY_BASE_MS + Math.random() * RETRY_DELAY_JITTER_MS;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function is429(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 429;
}

// ---------------------------------------------------------------------------
// Core request (single attempt, no retry)
// ---------------------------------------------------------------------------

async function fetchCloudEval(
  url: string,
  headers: Record<string, string>
): Promise<LichessCloudEvalResponse> {
  const result = await axios.get<LichessCloudEvalResponse>(url, { headers });
  return result.data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query the Lichess cloud evaluation API for a position.
 * Returns null if the position is not in the cloud database.
 *
 * - Concurrency is limited to `config.lichess.cloudConcurrency` (default 10).
 * - A 429 response triggers a 1–2 s backoff and one retry before returning null.
 */
export async function getCloudEval(
  fen: string,
  multiPv = 3
): Promise<UCIAnalysisLine[] | null> {
  const url = new URL(config.lichess.cloudEvalUrl);
  url.searchParams.set("fen", fen);
  url.searchParams.set("multiPv", String(multiPv));
  const urlStr = url.toString();

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (config.lichess.token) {
    headers["Authorization"] = `Bearer ${config.lichess.token}`;
  }

  await cloudSemaphore.acquire();
  try {
    let data: LichessCloudEvalResponse;
    try {
      data = await fetchCloudEval(urlStr, headers);
    } catch (firstErr) {
      if (is429(firstErr)) {
        // One retry after backoff
        await retryDelay();
        try {
          data = await fetchCloudEval(urlStr, headers);
        } catch (retryErr) {
          if (axios.isAxiosError(retryErr) && retryErr.response?.status === 404) {
            return null;
          }
          console.error("[LichessEval] API error after retry:", retryErr);
          return null;
        }
      } else if (axios.isAxiosError(firstErr) && firstErr.response?.status === 404) {
        return null;
      } else {
        console.error("[LichessEval] API error:", firstErr);
        return null;
      }
    }

    return data.pvs.map((pv, index) => ({
      depth: data.depth,
      score_cp: pv.cp ?? null,
      score_mate: pv.mate ?? null,
      pv: pv.moves.trim().split(/\s+/),
      multipv_rank: index + 1,
    }));
  } finally {
    cloudSemaphore.release();
  }
}
