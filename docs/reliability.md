# Reliability & Performance

This document describes failure modes, performance characteristics, and caching behavior for the chess-context MCP server. All values are derived from the actual source code; env var names and defaults match `mcp-server/src/config.ts`.

---

## API Failure Behavior

### Chess.com API

| Scenario | Tool behavior |
|---|---|
| API down / network error | Tool returns an error response with the original error message. No fallback — Chess.com game data is not replicated elsewhere. |
| Game not found (404) | Tool returns an error indicating the game could not be retrieved. |
| Invalid username | Returns an error from the Chess.com API response. |
| Rate limited | The error propagates to the caller; there is no automatic retry for Chess.com requests. |

### Lichess API

| Scenario | Tool behavior |
|---|---|
| API down / network error | Error propagates to the caller. |
| Game not found | Tool returns an error indicating the game could not be retrieved. |
| Invalid username or game ID | Returns the API error response as a tool error. |

### Lichess Cloud Eval (optional, disabled by default)

Lichess cloud eval is an optional fast-path controlled by `ENABLE_LICHESS_CLOUD=true`. When enabled:

- **404 (position not in cloud database)**: Silently returns `null`; the router falls through to the local engine. This is the normal path for non-mainstream positions.
- **429 (rate limited)**: The Axios call throws; `getCloudEval` catches the error, logs it to stderr, and returns `null`. The router then falls through to the local Stockfish engine — **there is no retry** for cloud eval. The tool completes using local analysis.
- **Other network errors**: Same as 429 — logged to stderr, returns `null`, local engine is used.

No user-visible error is produced when cloud eval degrades; the tool transparently falls back to local analysis.

### Engine Errors

| Scenario | Tool behavior |
|---|---|
| Docker Stockfish fails mid-analysis | Router catches the error, then attempts WASM pool, then WASM single-thread as emergency fallbacks. Returns empty lines `[]` only if all fallbacks also fail. |
| WASM pool init fails | Logged to stderr; single-threaded WASM is used instead. |
| WASM single-thread init fails | Logged to stderr; `activeBackend` remains `"none"` until Docker or WASM succeeds. Tool calls block until `STOCKFISH_READINESS_TIMEOUT` then reject with a user-friendly error. |
| All engines unavailable | Tool rejects with: *"Engine did not initialize within Nms. Start the Docker container (docker run -d -p 8090:8090 mcp-chess-stockfish) or wait 30–90 seconds for the WASM engine to warm up."* |

### Invalid PGN / Input Validation

- Invalid PGN passed to `analyze_game` or `analyze_position` results in a parse error returned to the caller.
- Missing required fields return a Zod validation error describing which fields are absent.
- The server never crashes on bad input — errors are caught and returned as MCP error responses.

---

## Known Edge Cases and Limitations

### Very Short Games (fewer than 5 moves)

Games with fewer than 5 moves produce analysis, but the opening detection may return no match (positions are too shallow to cross the book threshold). Move classification still runs on any available positions, but accuracy metrics may be statistically meaningless with so few data points.

### Anonymous Games / Missing Player Headers

`analyze_game` applies defaults when player headers are absent from the PGN. Analysis proceeds normally; accuracy stats are attributed to generic placeholder names. The `get_player_stats` and `scout_opponent` tools require an explicit username and will return an error if the username is not found on the specified platform.

### Incomplete PGN (Missing Headers)

When standard PGN headers (White, Black, Event, Date, Result) are absent:
- Missing player names default to `"?"`.
- Missing result is treated as unknown.
- Analysis of moves and positions still runs on whatever is present.

### Games with Time Forfeits

A time forfeit ends the game at the final recorded position. The position count used for analysis is determined by the actual moves in the PGN, not by the theoretical game length. The timeout position is analyzed normally; no special handling is applied.

### Off-Book Positions

Opening detection uses the first `openingMoveDepth` moves (default: **5 moves** from `config.analysis.openingMoveDepth`). Once the game exits known opening lines, the opening field returns the last recognized opening name rather than failing. Positions with no book match produce an empty or absent opening annotation.

### Classification Accuracy

Move classification (blunder / mistake / inaccuracy / good) is based on centipawn thresholds applied to eval deltas:

| Classification | Threshold (centipawns) |
|---|---|
| Blunder | ≥ 200 cp (`blunderThreshold`) |
| Mistake | ≥ 100 cp (`mistakeThreshold`) |
| Inaccuracy | ≥ 50 cp (`inaccuracyThreshold`) |

These are heuristic thresholds. Tactical themes and pawn structure annotations are also heuristic — they rely on pattern matching, not exhaustive search, and may miss subtleties in highly complex positions.

---

## Performance Characteristics

### Engine Latency per Position

| Engine backend | Condition | Latency per position |
|---|---|---|
| Docker Stockfish | Shallow depth (quiet, depth 10) | 100–200 ms |
| Docker Stockfish | Critical depth (depth 16) | 300–800 ms |
| Docker Stockfish | Default depth (depth 18) | 500 ms – 1.5 s |
| WASM worker pool (2 workers) | Shallow depth | 1–3 s |
| WASM worker pool (2 workers) | Critical depth | 2–6 s |
| WASM single-thread | Any depth | 2–10 s |
| SQLite cache hit | Any | ~1 ms |
| Lichess cloud eval hit | Any | 200–600 ms (network round-trip) |

### Tool Latency Estimates

Game analysis uses a two-pass adaptive strategy: quiet positions (eval delta < 30 cp) are analyzed at `STOCKFISH_QUIET_DEPTH` (default **10**); critical positions are re-analyzed at `STOCKFISH_CRITICAL_DEPTH` (default **16**).

A 40-move game produces approximately 81 positions. With a warm cache, most positions return in ~1 ms each.

| Tool | Cold start (Docker, no cache) | Cold start (WASM, no cache) | Cache hit |
|---|---|---|---|
| `analyze_position` (single position) | 0.5–1.5 s | 2–10 s | ~1 ms |
| `analyze_game` (40-move game, ~81 positions) | 1–3 min | 5–15 min | 1–10 s |
| `get_player_stats` | 1–3 s (API call) | 1–3 s (API call) | ~1 ms (LRU, 5 min TTL) |
| `scout_opponent` | 2–5 s (multiple API calls) | 2–5 s (multiple API calls) | ~1 ms (LRU, 5 min TTL) |

MCP progress notifications are sent during `analyze_game` so clients can display progress on long-running analysis.

### Chess.com / Lichess API Calls

- Typical response time: 500 ms – 2 s depending on endpoint and server load.
- No client-side retry on transient failures. A single network error propagates immediately.

---

## Concurrency Behavior

### Multiple Simultaneous Tool Calls

All tool handlers are `async` and run concurrently within the same Node.js process. There is no per-tool serialization — two calls to `analyze_game` can run in parallel. However, the engine backends have their own concurrency limits:

- **Docker Stockfish**: Requests are sent over HTTP. The Docker container processes one analysis at a time by default; concurrent requests queue on the container side.
- **WASM pool**: The pool is initialized with 2 workers (`initPool(2)`). Up to 2 positions can be analyzed in parallel.
- **WASM single-thread**: Strictly sequential — all analysis is serialized through one engine instance.

### Lichess Cloud Eval Concurrency

When `ENABLE_LICHESS_CLOUD=true`, concurrent cloud eval requests are **not** internally rate-limited by a semaphore in the current implementation. Lichess enforces its own rate limits server-side. If rate-limited (HTTP 429), cloud eval is silently skipped for that position and the local engine is used.

> **Note:** The `LICHESS_CLOUD_CONCURRENCY` env var is documented in `CLAUDE.md` for future use. The current implementation does not apply a concurrency semaphore around cloud eval requests. The value of 10 (default) / 25 (with token) reflects the safe request rate, not an enforced in-process limit.

### Player Stats Cache

The LRU player stats cache is shared across all concurrent tool calls in the same process. It holds up to **100 entries** (`config.cache.playerMaxSize`) with a **5-minute TTL** (`config.cache.playerTtlMs = 5 * 60 * 1000`). Cache keys are `"platform:username"` (lowercased). Concurrent reads are safe because Node.js is single-threaded; there is no lock contention.

---

## Caching Strategy

### Layer 1: SQLite Eval Cache (persistent)

- **Location**: `EVAL_CACHE_DB` env var, default `~/.chess-context/eval-cache.db`
- **Key**: `"${fen}:${depth}:${multiPv}"` — uniquely identifies a position evaluation at a specific depth and multi-PV count.
- **TTL**: None. Position evaluation at a given depth is deterministic, so entries never expire.
- **Persistence**: Survives server restarts. The SQLite file is created on first use.
- **WAL mode**: The database is opened with `PRAGMA journal_mode = WAL` for better concurrent read performance.
- **Eviction**: LRU eviction by `accessed_at` timestamp. The cache is capped at **10,000 entries** (`MAX_ENTRIES` in `sqlite-cache.ts`). When the entry count exceeds 10,000, the oldest-accessed entries are deleted to bring the count back to the limit.
- **Access pattern**: Reads update `accessed_at` via a `TOUCH` statement, keeping frequently used positions warm.

### Layer 2: In-Memory LRU Player Cache (ephemeral)

- **Scope**: Player stats fetched from Chess.com and Lichess APIs.
- **Max size**: **100 entries** (`config.cache.playerMaxSize`)
- **TTL**: **5 minutes** (`config.cache.playerTtlMs`). Entries older than 5 minutes are treated as expired and evicted on next access.
- **Persistence**: In-memory only. Lost on server restart.
- **Key**: `"platform:username"` (e.g., `"chess.com:hikaru"`, `"lichess:magnus"`)

### Cache Invalidation

- **Position eval cache**: No active invalidation. Entries persist until the 10,000-entry cap is reached and LRU eviction removes them. Engine upgrades (e.g., upgrading Stockfish version) do not automatically invalidate the cache; stale evals at old depths remain until evicted.
- **Player stats cache**: Automatic TTL expiry at 5 minutes. No manual invalidation is provided.

### What Is Not Cached

- Raw PGN downloads from Chess.com or Lichess.
- Opening book lookups.
- Move classification results (these are recomputed from cached evals on each request).

---

## Memory Profile

### WASM Stockfish

Stockfish compiled to WASM loads approximately **~50 MB** of memory on first initialization. This is a one-time cost per process start. The WASM pool initializes 2 workers, so peak memory usage from the engine can reach **~100 MB** when the pool is active.

### SQLite Cache

The SQLite file grows deterministically: one row per unique `(fen, depth, multiPv)` triple. Each row stores a JSON-serialized array of `UCIAnalysisLine` objects (~200–400 bytes per row). At the 10,000-entry cap the file is approximately **2–4 MB**. The file does not shrink automatically when entries are evicted unless `VACUUM` is run manually.

### LRU Cache Bounds

| Cache | Max entries | Approx. memory |
|---|---|---|
| SQLite eval cache | 10,000 (hard cap, with eviction) | ~2–4 MB on disk |
| In-memory position LRU (engine-router) | 500 (`config.cache.positionMaxSize`) | ~0.5–2 MB heap |
| In-memory player LRU | 100 (`config.cache.playerMaxSize`) | ~0.1–0.5 MB heap |

> The in-memory position LRU (`positionMaxSize: 500`) is defined in config but currently the `getPositionEval` / `setPositionEval` functions in `cache/index.ts` delegate directly to SQLite. The 500-entry LRU is reserved for a future in-process hot-path layer in front of SQLite.

---

## Timeout Behavior

### `STOCKFISH_TIMEOUT` (default: 30,000 ms)

Per-position analysis timeout. If a single Stockfish analysis call does not return within this window, the call rejects with a timeout error. The engine remains alive for subsequent requests; the timeout is not a global engine shutdown signal.

- Applies to: Docker HTTP requests and WASM engine calls.
- On timeout: The tool receives an error for that position. Depending on the tool, it may skip the position, return partial results, or surface the error to the caller.

### `STOCKFISH_READINESS_TIMEOUT` (default: 90,000 ms)

Maximum time to wait for any engine backend to become ready before rejecting a tool call. The engine initializes asynchronously after server startup (fire-and-forget, does not block the MCP handshake). Tool calls that arrive before initialization is complete block on `waitUntilRouterReady()`.

- If Docker or WASM becomes ready within 90 s: the blocked tool call proceeds normally.
- If no engine is ready after 90 s: the tool rejects with a user-friendly message instructing the user to start the Docker container or wait for WASM warmup.
- After the timeout fires, the engine init may still complete in the background; subsequent tool calls will succeed once `activeBackend !== "none"`.

### Docker Health Check

The router polls Docker availability every **30 seconds** (`scheduleHealthCheck` uses a 30,000 ms timer). If Docker goes down after being active, the router falls back to WASM pool, then WASM single-thread, then `"none"`. If Docker comes back up, the router switches back automatically and marks itself ready again.
