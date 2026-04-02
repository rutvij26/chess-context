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

function makeAxiosError(status: number, body: unknown = null) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data: body },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// getCloudEval — basic happy path and error handling
// ---------------------------------------------------------------------------

describe("getCloudEval", () => {
  const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  it("returns null when the position is not in the cloud database (404)", async () => {
    vi.spyOn(axios, "get").mockRejectedValueOnce(makeAxiosError(404));
    const result = await getCloudEval(FEN);
    expect(result).toBeNull();
  });

  it("returns null on a non-ok response other than 404", async () => {
    vi.spyOn(axios, "get").mockRejectedValueOnce(makeAxiosError(500));
    const result = await getCloudEval(FEN);
    expect(result).toBeNull();
  });

  it("returns null when axios throws a network error", async () => {
    vi.spyOn(axios, "get").mockRejectedValueOnce(new Error("Network failure"));
    const result = await getCloudEval(FEN);
    expect(result).toBeNull();
  });

  it("returns an array of UCIAnalysisLine on success", async () => {
    vi.spyOn(axios, "get").mockResolvedValueOnce({ data: makeCloudEvalResponse(), status: 200 });
    const result = await getCloudEval(FEN);
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBe(2);
  });

  it("maps depth correctly from the response", async () => {
    vi.spyOn(axios, "get").mockResolvedValueOnce({ data: makeCloudEvalResponse(28), status: 200 });
    const result = await getCloudEval(FEN);
    expect(result![0]!.depth).toBe(28);
  });

  it("maps score_cp from pv.cp", async () => {
    vi.spyOn(axios, "get").mockResolvedValueOnce({ data: makeCloudEvalResponse(24, [{ moves: "e2e4", cp: 42 }]), status: 200 });
    const result = await getCloudEval(FEN);
    expect(result![0]!.score_cp).toBe(42);
    expect(result![0]!.score_mate).toBeNull();
  });

  it("maps score_mate when pv has mate", async () => {
    vi.spyOn(axios, "get").mockResolvedValueOnce({ data: makeCloudEvalResponse(24, [{ moves: "e2e4", mate: 3 }]), status: 200 });
    const result = await getCloudEval(FEN);
    expect(result![0]!.score_mate).toBe(3);
    expect(result![0]!.score_cp).toBeNull();
  });

  it("splits pv moves into an array", async () => {
    vi.spyOn(axios, "get").mockResolvedValueOnce({ data: makeCloudEvalResponse(24, [{ moves: "e2e4 e7e5 g1f3", cp: 10 }]), status: 200 });
    const result = await getCloudEval(FEN);
    expect(result![0]!.pv).toEqual(["e2e4", "e7e5", "g1f3"]);
  });

  it("handles leading/trailing whitespace in pv moves", async () => {
    vi.spyOn(axios, "get").mockResolvedValueOnce({ data: makeCloudEvalResponse(24, [{ moves: "  e2e4 e7e5  ", cp: 5 }]), status: 200 });
    const result = await getCloudEval(FEN);
    expect(result![0]!.pv).toEqual(["e2e4", "e7e5"]);
  });

  it("sets multipv_rank starting from 1", async () => {
    vi.spyOn(axios, "get").mockResolvedValueOnce({ data: makeCloudEvalResponse(24, [
      { moves: "e2e4", cp: 30 },
      { moves: "d2d4", cp: 20 },
      { moves: "c2c4", cp: 15 },
    ]), status: 200 });
    const result = await getCloudEval(FEN);
    expect(result![0]!.multipv_rank).toBe(1);
    expect(result![1]!.multipv_rank).toBe(2);
    expect(result![2]!.multipv_rank).toBe(3);
  });

  it("passes multiPv parameter to the URL", async () => {
    const spy = vi.spyOn(axios, "get").mockResolvedValueOnce({ data: makeCloudEvalResponse(), status: 200 });
    await getCloudEval(FEN, 5);
    const calledUrl = (spy.mock.calls[0]![0] as string);
    expect(calledUrl).toContain("multiPv=5");
  });

  it("includes the FEN in the request URL", async () => {
    const spy = vi.spyOn(axios, "get").mockResolvedValueOnce({ data: makeCloudEvalResponse(), status: 200 });
    await getCloudEval(FEN, 3);
    const calledUrl = (spy.mock.calls[0]![0] as string);
    expect(calledUrl).toContain("fen=");
  });

  it("defaults multiPv to 3 when not specified", async () => {
    const spy = vi.spyOn(axios, "get").mockResolvedValueOnce({ data: makeCloudEvalResponse(), status: 200 });
    await getCloudEval(FEN);
    const calledUrl = (spy.mock.calls[0]![0] as string);
    expect(calledUrl).toContain("multiPv=3");
  });
});

// ---------------------------------------------------------------------------
// getCloudEval — 429 retry behaviour
// ---------------------------------------------------------------------------

describe("getCloudEval — 429 retry", () => {
  const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  it("retries once after a 429 and returns the result on success", async () => {
    const spy = vi.spyOn(axios, "get")
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ data: makeCloudEvalResponse(), status: 200 });

    const promise = getCloudEval(FEN);
    // Advance past the retry delay (max 2 s)
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
  });

  it("returns null after two consecutive 429s", async () => {
    const spy = vi.spyOn(axios, "get")
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockRejectedValueOnce(makeAxiosError(429));

    const promise = getCloudEval(FEN);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
  });

  it("returns null when retry gets a 404", async () => {
    vi.spyOn(axios, "get")
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockRejectedValueOnce(makeAxiosError(404));

    const promise = getCloudEval(FEN);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toBeNull();
  });

  it("does NOT retry on non-429 errors", async () => {
    const spy = vi.spyOn(axios, "get")
      .mockRejectedValueOnce(makeAxiosError(500));

    const result = await getCloudEval(FEN);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});
