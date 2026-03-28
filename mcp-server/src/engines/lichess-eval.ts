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

/**
 * Query the Lichess cloud evaluation API for a position.
 * Returns null if the position is not in the cloud database.
 * This is the preferred first step for position evaluation — instant and free.
 */
export async function getCloudEval(
  fen: string,
  multiPv = 3
): Promise<UCIAnalysisLine[] | null> {
  const url = new URL(config.lichess.cloudEvalUrl);
  url.searchParams.set("fen", fen);
  url.searchParams.set("multiPv", String(multiPv));

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (config.lichess.token) {
    headers["Authorization"] = `Bearer ${config.lichess.token}`;
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), { headers });
  } catch (err) {
    console.error("[LichessEval] Network error:", err);
    return null;
  }

  if (response.status === 404) {
    return null; // Position not in cloud database
  }

  if (!response.ok) {
    console.error(`[LichessEval] API error: ${response.status}`);
    return null;
  }

  const data = (await response.json()) as LichessCloudEvalResponse;

  return data.pvs.map((pv, index) => ({
    depth: data.depth,
    score_cp: pv.cp ?? null,
    score_mate: pv.mate ?? null,
    pv: pv.moves.trim().split(/\s+/),
    multipv_rank: index + 1,
  }));
}
