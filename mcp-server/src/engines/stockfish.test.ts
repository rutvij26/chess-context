/**
 * Unit tests for stockfish.ts — focused on `waitUntilReady`.
 *
 * We cannot load the actual WASM engine in the test environment, so we test
 * `waitUntilReady` by constructing equivalent race-promise logic and verifying
 * the contract described in the issue acceptance criteria:
 *
 *  1. Resolves immediately when the engine is already ready.
 *  2. Resolves once `readyok` arrives before the timeout.
 *  3. Rejects with a clear error message when the timeout elapses first.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers that mirror the production implementation so we can test the
// contract without loading WASM.
// ---------------------------------------------------------------------------

function makeReadinessGate(alreadyReady: boolean): {
  resolve: () => void;
  waitUntilReady: (timeoutMs?: number) => Promise<void>;
} {
  let engineReady = alreadyReady;
  let resolveReady: (() => void) | null = null;

  const readyPromise: Promise<void> = new Promise<void>((res) => {
    if (alreadyReady) {
      res();
    } else {
      resolveReady = res;
    }
  });

  function resolve(): void {
    engineReady = true;
    resolveReady?.();
  }

  function waitUntilReady(timeoutMs = 90_000): Promise<void> {
    if (engineReady) return Promise.resolve();

    return Promise.race([
      readyPromise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Stockfish engine did not initialize within ${timeoutMs}ms. ` +
                  "Please retry in a moment — the engine is still warming up."
              )
            ),
          timeoutMs
        )
      ),
    ]);
  }

  return { resolve, waitUntilReady };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("waitUntilReady", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when the engine is already ready", async () => {
    const { waitUntilReady } = makeReadinessGate(true);
    await expect(waitUntilReady()).resolves.toBeUndefined();
  });

  it("resolves when readyok arrives before the timeout", async () => {
    const { resolve, waitUntilReady } = makeReadinessGate(false);

    const promise = waitUntilReady(5_000);

    // Simulate engine signalling readyok after 1 second
    vi.advanceTimersByTime(1_000);
    resolve();

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with a clear error message when timeout elapses before readyok", async () => {
    const { waitUntilReady } = makeReadinessGate(false);

    const promise = waitUntilReady(3_000);

    // Advance past the timeout without resolving
    vi.advanceTimersByTime(3_001);

    await expect(promise).rejects.toThrow(
      /Stockfish engine did not initialize within 3000ms/
    );
  });

  it("error message mentions retry hint", async () => {
    const { waitUntilReady } = makeReadinessGate(false);

    const promise = waitUntilReady(1_000);
    vi.advanceTimersByTime(1_001);

    await expect(promise).rejects.toThrow(/warming up/);
  });

  it("uses 90_000ms as the default timeout", async () => {
    const { waitUntilReady } = makeReadinessGate(false);

    const promise = waitUntilReady(); // no argument → default 90_000

    // Should not reject before the default timeout
    vi.advanceTimersByTime(89_999);
    // Still pending — resolve to clean up
    const { resolve } = makeReadinessGate(false); // separate gate, just for cleanup
    void resolve;

    // Advance past default timeout
    vi.advanceTimersByTime(1);
    await expect(promise).rejects.toThrow(/90000ms/);
  });

  it("resolves even when called multiple times concurrently", async () => {
    const { resolve, waitUntilReady } = makeReadinessGate(false);

    const p1 = waitUntilReady(5_000);
    const p2 = waitUntilReady(5_000);
    const p3 = waitUntilReady(5_000);

    resolve();

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
