import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { getCloudEval } from "./lichess-eval.js";

// ---------------------------------------------------------------------------
// Mock axios
// ---------------------------------------------------------------------------

function makeCloudEvalResponse(depth = 24, pvs = [
  { moves: "e2e4 e7e5 g1f3", cp: 30 },
  { moves: "d2d4 d7d5", cp: 20 },
]) {
  return {
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    knodes: 10000,
    depth,
    pvs,
  };
}

function mockAxios(status: number, body: unknown) {
  if (status >= 200 && status < 300) {
    return vi.spyOn(axios, "get").mockResolvedValueOnce({ data: body, status });
  }
  const err = Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data: body },
  });
  return vi.spyOn(axios, "get").mockRejectedValueOnce(err);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getCloudEval
// ---------------------------------------------------------------------------

describe("getCloudEval", () => {
  const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  it("returns null when the position is not in the cloud database (404)", async () => {
    mockAxios(404, null);
    const result = await getCloudEval(FEN);
    expect(result).toBeNull();
  });

  it("returns null on a non-ok response other than 404", async () => {
    mockAxios(500, null);
    const result = await getCloudEval(FEN);
    expect(result).toBeNull();
  });

  it("returns null when axios throws a network error", async () => {
    vi.spyOn(axios, "get").mockRejectedValueOnce(new Error("Network failure"));
    const result = await getCloudEval(FEN);
    expect(result).toBeNull();
  });

  it("returns an array of UCIAnalysisLine on success", async () => {
    mockAxios(200, makeCloudEvalResponse());
    const result = await getCloudEval(FEN);
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBe(2);
  });

  it("maps depth correctly from the response", async () => {
    mockAxios(200, makeCloudEvalResponse(28));
    const result = await getCloudEval(FEN);
    expect(result![0]!.depth).toBe(28);
  });

  it("maps score_cp from pv.cp", async () => {
    mockAxios(200, makeCloudEvalResponse(24, [{ moves: "e2e4", cp: 42 }]));
    const result = await getCloudEval(FEN);
    expect(result![0]!.score_cp).toBe(42);
    expect(result![0]!.score_mate).toBeNull();
  });

  it("maps score_mate when pv has mate", async () => {
    mockAxios(200, makeCloudEvalResponse(24, [{ moves: "e2e4", mate: 3 }]));
    const result = await getCloudEval(FEN);
    expect(result![0]!.score_mate).toBe(3);
    expect(result![0]!.score_cp).toBeNull();
  });

  it("splits pv moves into an array", async () => {
    mockAxios(200, makeCloudEvalResponse(24, [{ moves: "e2e4 e7e5 g1f3", cp: 10 }]));
    const result = await getCloudEval(FEN);
    expect(result![0]!.pv).toEqual(["e2e4", "e7e5", "g1f3"]);
  });

  it("handles leading/trailing whitespace in pv moves", async () => {
    mockAxios(200, makeCloudEvalResponse(24, [{ moves: "  e2e4 e7e5  ", cp: 5 }]));
    const result = await getCloudEval(FEN);
    expect(result![0]!.pv).toEqual(["e2e4", "e7e5"]);
  });

  it("sets multipv_rank starting from 1", async () => {
    mockAxios(200, makeCloudEvalResponse(24, [
      { moves: "e2e4", cp: 30 },
      { moves: "d2d4", cp: 20 },
      { moves: "c2c4", cp: 15 },
    ]));
    const result = await getCloudEval(FEN);
    expect(result![0]!.multipv_rank).toBe(1);
    expect(result![1]!.multipv_rank).toBe(2);
    expect(result![2]!.multipv_rank).toBe(3);
  });

  it("passes multiPv parameter to the URL", async () => {
    const spy = mockAxios(200, makeCloudEvalResponse());
    await getCloudEval(FEN, 5);
    const calledUrl = (spy.mock.calls[0]![0] as string);
    expect(calledUrl).toContain("multiPv=5");
  });

  it("includes the FEN in the request URL", async () => {
    const spy = mockAxios(200, makeCloudEvalResponse());
    await getCloudEval(FEN, 3);
    const calledUrl = (spy.mock.calls[0]![0] as string);
    expect(calledUrl).toContain("fen=");
  });

  it("defaults multiPv to 3 when not specified", async () => {
    const spy = mockAxios(200, makeCloudEvalResponse());
    await getCloudEval(FEN);
    const calledUrl = (spy.mock.calls[0]![0] as string);
    expect(calledUrl).toContain("multiPv=3");
  });
});
