import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../store/db.js", () => ({ isDbConfigured: vi.fn() }));
vi.mock("../store/analysis-store.js", () => ({
  getQueueStatusForUser: vi.fn(),
  countAnalysesForUser: vi.fn(),
}));
vi.mock("../store/game-store.js", () => ({ getGameIdsForUser: vi.fn() }));

import { handleGetAnalysisProgress } from "./get-analysis-progress.js";
import { isDbConfigured } from "../store/db.js";
import { getQueueStatusForUser, countAnalysesForUser } from "../store/analysis-store.js";
import { getGameIdsForUser } from "../store/game-store.js";

const mockIsDb = vi.mocked(isDbConfigured);
const mockQueueStatus = vi.mocked(getQueueStatusForUser);
const mockCountAnalyses = vi.mocked(countAnalysesForUser);
const mockGetGameIds = vi.mocked(getGameIdsForUser);

const INPUT = { username: "alice", platform: "chess.com" as const };

beforeEach(() => {
  mockIsDb.mockReturnValue(true);
  mockQueueStatus.mockResolvedValue([]);
  mockCountAnalyses.mockResolvedValue(0);
  mockGetGameIds.mockResolvedValue([]);
});

describe("handleGetAnalysisProgress", () => {
  it("returns no_games when DB not configured", async () => {
    mockIsDb.mockReturnValue(false);
    const r = await handleGetAnalysisProgress(INPUT);
    expect(r.status).toBe("no_games");
    expect(r.total_games).toBe(0);
  });

  it("returns no_games when no games stored", async () => {
    const r = await handleGetAnalysisProgress(INPUT);
    expect(r.status).toBe("no_games");
    expect(r.summary).toContain("refresh_games");
  });

  it("returns complete when all games analyzed", async () => {
    mockGetGameIds.mockResolvedValue(["g1", "g2"]);
    mockCountAnalyses.mockResolvedValue(2);
    const r = await handleGetAnalysisProgress(INPUT);
    expect(r.status).toBe("complete");
    expect(r.progress_pct).toBe(100);
    expect(r.analyzed).toBe(2);
    expect(r.total_games).toBe(2);
  });

  it("returns processing when pending jobs exist", async () => {
    mockGetGameIds.mockResolvedValue(["g1", "g2", "g3"]);
    mockCountAnalyses.mockResolvedValue(1);
    mockQueueStatus.mockResolvedValue([
      { status: "done", count: 1 },
      { status: "pending", count: 2 },
    ]);
    const r = await handleGetAnalysisProgress(INPUT);
    expect(r.status).toBe("processing");
    expect(r.pending).toBe(2);
    expect(r.progress_pct).toBe(33);
  });

  it("returns processing when jobs are actively processing", async () => {
    mockGetGameIds.mockResolvedValue(["g1", "g2"]);
    mockCountAnalyses.mockResolvedValue(1);
    mockQueueStatus.mockResolvedValue([{ status: "processing", count: 1 }]);
    const r = await handleGetAnalysisProgress(INPUT);
    expect(r.status).toBe("processing");
    expect(r.processing).toBe(1);
  });

  it("reports failed count", async () => {
    mockGetGameIds.mockResolvedValue(["g1", "g2", "g3"]);
    mockCountAnalyses.mockResolvedValue(2);
    mockQueueStatus.mockResolvedValue([{ status: "failed", count: 1 }]);
    const r = await handleGetAnalysisProgress(INPUT);
    expect(r.failed).toBe(1);
    expect(r.summary).toContain("failed");
  });

  it("summary mentions game counts", async () => {
    mockGetGameIds.mockResolvedValue(["g1", "g2", "g3", "g4"]);
    mockCountAnalyses.mockResolvedValue(2);
    mockQueueStatus.mockResolvedValue([{ status: "pending", count: 2 }]);
    const r = await handleGetAnalysisProgress(INPUT);
    expect(r.summary).toContain("2/4");
  });
});
