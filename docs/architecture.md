# Architecture

ChessContext is built on a three-layer design. The key principle: **the MCP provides chess meaning, Claude provides the reasoning.**

---

## System Boundaries

### What this system does

chess-context is a **deterministic pre-processing layer** that transforms raw chess data (PGN, FEN, player history) into structured, semantically enriched JSON before it reaches Claude. It runs Stockfish, calls Chess.com and Lichess APIs, classifies positions, and annotates moves.

### What Claude does

Claude receives the enriched JSON and generates natural language responses. Claude does not run any engine or call any external API — all computation happens before Claude sees any data.

### Concrete example

| Step | Performed by |
|------|-------------|
| Fetch PGN from Chess.com | this server (data layer) |
| Run Stockfish at depth 18 | this server (engine layer) |
| Classify position as "knight outpost in middlegame" | this server (intelligence layer) |
| Explain the knight outpost in plain language | Claude |

### Deterministic vs heuristic pipeline

Not all logic is equal:

- **Deterministic (rule-based):** pawn structure detection, material balance calculation, game phase by piece count, critical moment thresholds (≥200cp = blunder regardless of position)
- **Heuristic (threshold-based):** theme tagging (e.g. "king safety concern" fires when shield pawns < 2), complexity estimation, space advantage (fires when ≥10 moves target advanced squares)

### What enriched output adds over raw Stockfish

Raw Stockfish gives centipawn scores. This server additionally provides:

- Human-readable move categorisation (brilliant / good / inaccuracy / mistake / blunder)
- Position themes (pin, fork potential, back rank weakness, knight outpost, …)
- Pawn structure labels (isolated, doubled, passed, backward, hanging, …)
- 2–4 sentence narrative ready for Claude to use or quote directly
- Opening name, game phase, material balance in centipawns
- Accuracy percentage per player

---

## The Three Layers

```
┌─────────────────────────────────────────────────┐
│              LAYER 3: MCP TOOLS                 │
│  analyze_position · analyze_game                │
│  get_player_stats · scout_opponent              │
│  refresh_games · review_game                    │
│  get_mistake_patterns · get_style_fingerprint   │
├─────────────────────────────────────────────────┤
│           LAYER 2: INTELLIGENCE                 │
│  Position Classifier · Theme Tagger             │
│  Narrative Generator · Critical Moments         │
│  Player Level · Pattern Scanner · Style Analyzer│
├─────────────────────────────────────────────────┤
│            LAYER 1: FOUNDATION                  │
│  Engine Router · Docker Stockfish               │
│  WASM Stockfish (fallback) · LRU Cache          │
│  Chess.com API · Lichess API                    │
│  PostgreSQL Game Store (optional)               │
└─────────────────────────────────────────────────┘
```

---

### Layer 1 — Foundation (`src/engines/`, `src/data/`, `src/cache/`)

Raw compute and data access. Has no opinion about what it returns — just gets the data correctly.

#### Engine Stack

The engine stack is routed through `engine-router.ts`, which selects the best available backend automatically:

```
src/engines/
  engine-router.ts       ← unified interface (getEval, waitUntilRouterReady)
  stockfish-docker.ts    ← HTTP client to Docker Stockfish container
  stockfish.ts           ← WASM UCI wrapper (single-threaded, fallback)
  stockfish-pool.ts      ← WASM Worker Thread pool (parallel, fallback)
  stockfish-worker.ts    ← Worker Thread entry point
  lichess-eval.ts        ← Lichess cloud eval API (optional)
```

**Eval routing priority (fastest to slowest):**

```
1. LRU cache           → instant (in-memory, deterministic)
2. Docker Stockfish    → 100–200ms/position (native binary, multi-threaded)
3. WASM worker pool    → 1–5s/position (parallel, no Docker needed)
4. WASM single-thread  → 2–10s/position (sequential fallback)
5. Lichess cloud eval  → optional, enabled via ENABLE_LICHESS_CLOUD=true
```

**`engine-router.ts`** — Selects the best available backend on startup, re-checks Docker availability every 30 seconds, and exposes a single `getEval(fen, depth, multiPv)` function that all tool handlers call. If Docker becomes available after startup, the router switches to it automatically.

**`stockfish-docker.ts`** — Thin axios HTTP client. `POST /analyze` sends FEN + depth + multiPv; `GET /health` checks container readiness. Docker Stockfish is the primary backend: it uses a native binary (not WASM), can use 4+ CPU threads, has zero startup delay, and serializes requests internally so all threads focus on one position at a time.

**`stockfish.ts`** — WASM UCI wrapper. Manages engine lifecycle, queues requests (one `go` at a time), parses `info` lines, returns `UCIAnalysisLine[]`. 30-second timeout, used when Docker is unavailable.

**`stockfish-pool.ts`** — Parallel WASM analysis via Node.js Worker Threads. Each worker runs an independent WASM instance. Queue-based dispatch to idle workers. Used as first WASM fallback when Docker is down.

**`engines/lichess-eval.ts`** — Queries the Lichess cloud eval API (`/api/cloud-eval`). Disabled by default. Enable with `ENABLE_LICHESS_CLOUD=true` to get instant high-depth evals for well-known positions.

**`data/chesscom-api.ts`** — Chess.com REST client. Fetches profiles, ratings, game archives (PGN format). Handles 404 as `PlayerNotFoundError`, retries on 429.

**`data/lichess-api.ts`** — Lichess REST client. Parses NDJSON game streams. Uses `?opening=true` parameter for free ECO codes on every game. Includes `clocks=true` to embed `[%clk]` annotations used by the style fingerprint's time management dimension.

**`store/db.ts`** — postgres.js v3 client. Lazy-initialised on first call. `migrate()` runs the DDL in `schema.sql` idempotently on startup. `isDbConfigured()` checks for `DATABASE_URL` — all store tools degrade gracefully when it is absent.

**`store/game-store.ts`** — `insertGames()` (upsert, skips duplicates by `platform+username+game_id`), `getGamesForUser()`, `getUnanalyzedGameIds()`.

**`store/analysis-store.ts`** — `insertAnalysis()` (stores `MoveRecord[]` and `CriticalMoment[]` as JSONB), `getAnalysesForUser()`, `getAnalysisForGame()`.

**`store/analysis-pipeline.ts`** — Background queue processor. `enqueueUnanalyzedGames()` inserts pending rows into `analysis_queue`. `startPipeline()` fires `processNextQueued()` via `setImmediate` — each game is claimed atomically (UPDATE … RETURNING), analyzed with `analyzeGameFull()`, results stored, then the next item is scheduled via another `setImmediate`. The server event loop is never blocked.

**`cache/index.ts`** — Two in-memory caches:
- Position cache (LRU, 500 entries): `fen:depth:multiPv → UCIAnalysisLine[]`. No TTL — eval is deterministic.
- Player cache (TTL, 100 entries, 5 minutes): `platform:username → PlayerStats`. Prevents double API calls from `scout_opponent`.

---

### Layer 2 — Intelligence (`src/intelligence/`)

Pure functions — no I/O, no side effects. Takes chess.js board state and engine output, returns semantic annotations.

- **`position-classifier.ts`** — `classifyPhase()` (opening/middlegame/endgame by piece count and move number), `classifyPawnStructure()` (10 types: isolated, doubled, passed, backward, hanging, chain, symmetrical, open/closed/semi-open center), `getMaterialBalance()` (centipawns).
- **`theme-tagger.ts`** — `tagThemes()` returns up to 15 active themes per position using chess.js board inspection: king safety, pawn storm, space advantage, piece activity, bishop pair, knight outpost, open file, weak squares, pin, fork potential, back rank, opposite-colored bishops, rook on 7th, connected rooks, material imbalance.
- **`narrative-generator.ts`** — `generateNarrative()` composes 2-4 sentences from phase + structure + top themes + eval. Template-based — deterministic and fast. Themes are ranked by phase relevance (e.g., king safety ranks higher in the middlegame, passed pawns rank higher in the endgame).
- **`critical-moments.ts`** — `detectCriticalMoments()` classifies each move: blunder (≥200cp drop), mistake (≥100cp), inaccuracy (≥50cp), missed_win (had >300cp, dropped below 100cp). `computeAccuracy()` measures % of moves within 30cp of best.
- **`player-level.ts`** — `detectPlayerLevel(rating)` maps rating to `beginner` (<1000), `club` (1000–1800), or `advanced` (>1800). `buildStudyRecommendations()` generates 1–3 study suggestions from phase grades and error patterns. `filterMomentsForLevel()` controls how much engine detail is surfaced to the player.
- **`pattern-scanner.ts`** — `detectMistakePatterns()` scans `MoveRecord[][]` and `CriticalMoment[][]` across multiple games. Detects 5 pattern types: time-pressure blunder clusters, opening preparation gaps, endgame technique failures, hanging pieces, and repeated opening collapses. All detectors return `null` when frequency is below threshold (≥2–3 occurrences).
- **`style-analyzer.ts`** — `computeStyleFingerprint()` scores 5 dimensions: aggression (pawn advances + sacrifice events), positional_sense (strategic accuracy), tactical_sharpness (% of critical moves found), endgame_skill (win conversion rate with advantage), time_management (`[%clk]` annotations, Lichess only). `deriveStyleLabel()` maps scores to one of 6 archetypes. `buildStyleDescription()` generates a 2–3 sentence narrative.
- **`opening-gap-detector.ts`** — `detectOpeningGaps(games, color, minOccurrences)` replays each game with chess.js up to move 15, groups positions by FEN, and identifies repeated positions where opponent deviations lead to poor results. Sorted by `loss_rate × occurrences`. No engine required.
- **`puzzle-classifier.ts`** — `extractPuzzles(analyses, metas, difficulty, max)` reads stored `critical_moments` from DB, finds the FEN before each blunder, runs a shallow engine eval to get the forcing PV, converts UCI → SAN with chess.js, and classifies difficulty (easy/medium/hard based on PV length and eval swing). Puzzles are deduplicated by FEN hash.

---

### Layer 3 — Tools (`src/tools/`)

Orchestrates Layers 1 and 2 into MCP tool handlers. Each tool is a single file with a single exported handler function.

- **`analyze-position.ts`** — `getEval()` (via router) → classify → tag → narrative → SAN conversion.
- **`analyze-game.ts`** — Resolve PGN (direct/URL/username) → replay with chess.js → `Promise.all` over `getEval()` for all positions → detect critical moments → compute accuracy. Also exports `analyzeGameFull()` for the background pipeline (returns both `GameAnalysis` and `MoveRecord[]`).
- **`get-player-stats.ts`** — Thin dispatch: check player cache → call correct API client → cache result.
- **`scout-opponent.ts`** — Calls `get-player-stats` internally → analyze repertoire vs your color → rule-based strategic recommendation.
- **`refresh-games.ts`** — Fetch games from Chess.com/Lichess API → upsert into `player_games` → enqueue unanalyzed games → start background pipeline → return immediately with queue status.
- **`review-game.ts`** — Calls `handleAnalyzeGame()` → detects player color and rating → `detectPlayerLevel()` → computes per-phase accuracy and letter grades → finds turning point (largest `eval_drop_cp`) → generates study recommendations and narrative.
- **`get-mistake-patterns.ts`** — Queries `getAnalysesForUser()` → optional time_control filter → calls `detectMistakePatterns()` → returns ranked patterns with overall summary.
- **`get-style-fingerprint.ts`** — Queries `getAnalysesForUser()` + `getGamesForUser()` → builds `GameDataForStyle[]` → calls `computeStyleFingerprint()` → returns fingerprint, style label, and description.
- **`get-opening-theory.ts`** — Resolves FEN from name lookup or input → calls `getLichessOpeningExplorer()` → builds key ideas, continuations, win stats, and level-adapted narrative.
- **`find-opening-gaps.ts`** — Fetches games from API → calls `detectOpeningGaps()` → returns sorted gap list with study suggestions. No DB or engine required.
- **`generate-puzzles.ts`** — DB-backed: queries stored analyses → `waitUntilRouterReady()` → calls `extractPuzzles()` → applies puzzle_type filter → returns puzzles sorted easy→hard.

---

## Docker Engine Container

The Stockfish Docker container runs entirely separately from the MCP server:

```
Claude Desktop (Windows/macOS)
       │  stdio
       ▼
MCP Server (Node.js)
  src/engines/engine-router.ts
       │  HTTP POST /analyze
       ▼
Docker Container (local)
  engine-server/server.js        ← Express HTTP-to-UCI bridge
       │  stdin/stdout (UCI)
       ▼
  /usr/local/bin/stockfish       ← Native Stockfish binary
  (4 threads, 256MB hash)
```

The container (`mcp-server/engine-server/server.js`) is a ~150-line Express app that:
- Spawns Stockfish as a child process
- Translates `POST /analyze` into UCI commands (`setoption`, `position fen`, `go depth`)
- Parses `info` lines at the target depth and collects them into `UCIAnalysisLine[]`
- Serializes requests internally — one position at a time with all threads focused on each
- Auto-restarts Stockfish if it crashes

**Why serialized requests?** A single Stockfish using 4 threads is faster per position than 2 instances using 2 threads each. The MCP server fires all `Promise.all` requests concurrently; the container queues them and processes each with full thread power (~100–200ms at depth 12).

---

## Performance Design

### Game Analysis (`analyze_game`)

A 40-move game produces ~81 positions. With Docker:

| Stage | Time |
|-------|------|
| PGN fetch + parse | < 1s |
| 81× `getEval` (concurrent HTTP, depth 12) | 8–16s |
| Critical moment detection | < 100ms |
| **Total** | **~10–17s** |

Without Docker (WASM fallback), the same analysis takes 30–60s+ and may hit the 50s timeout.

### Adaptive Depth in `analyze_game`

`analyze_game` uses a two-pass approach. Pass 1 evaluates all positions at `quietDepth` (default 10). Any position where the eval swing exceeds `quietThreshold` (30cp) is re-evaluated at `criticalDepth` (default 16) in Pass 2. The `analyze_position` tool uses `defaultDepth` (default 18) for deep single-position analysis.

### Caching

After the first analysis, the same game can be re-analyzed near-instantly. Every position's eval is cached by `fen:depth:multiPv`, so re-runs or analyses of positions shared between games hit the LRU cache.

---

## Adding a New Tool

1. Define input/output types in `src/types/index.ts`
2. Create `src/tools/your-tool.ts` with a `handleYourTool(input)` function
3. Register in `src/index.ts`:
   ```typescript
   server.registerTool("your_tool", { title, description, inputSchema }, async (input) => {
     const result = await handleYourTool(input);
     return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
   });
   ```
4. Document in `docs/tools.md`

To use the engine in your new tool:
```typescript
import { getEval, waitUntilRouterReady } from "../engines/engine-router.js";

const lines = await getEval(fen, depth, multiPv);
```

---

## Testing Intelligence Layer

All Layer 2 functions are pure — test them directly:

```typescript
import { Chess } from "chess.js";
import { classifyPhase, classifyPawnStructure } from "./intelligence/position-classifier.js";

const board = new Chess("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
console.log(classifyPhase(board));          // "opening"
console.log(classifyPawnStructure(board));  // ["symmetrical"]
```

No mocking required — just chess.js board instances and plain function calls.

---

## File and Function Map

Every file in the project maps to exactly one layer. Use this as a navigation index.

### Layer 1 — Foundation

| File | Key exports |
|------|-------------|
| `engines/engine-router.ts` | `getEval(fen, depth, multiPv)`, `waitUntilRouterReady()` |
| `engines/stockfish-docker.ts` | `analyzeWithDocker()`, `checkDockerHealth()` |
| `engines/stockfish.ts` | `analyzePosition()`, engine lifecycle management |
| `engines/stockfish-pool.ts` | WASM worker pool, `analyzeWithPool()` |
| `engines/stockfish-worker.ts` | Worker Thread entry point |
| `engines/lichess-eval.ts` | `getCloudEval(fen, multiPv)` |
| `data/chesscom-api.ts` | `getPlayerProfile()`, `getRecentGames()` |
| `data/lichess-api.ts` | `getPlayerGames()`, NDJSON stream parsing |
| `cache/index.ts` | `getPositionCache()`, `getPlayerCache()` |
| `cache/sqlite-cache.ts` | `SqliteEvalCache` — persistent eval storage |

### Layer 2 — Intelligence

| File | Key exports |
|------|-------------|
| `intelligence/position-classifier.ts` | `classifyPhase()`, `classifyPawnStructure()`, `getMaterialBalance()`, `estimateComplexity()` |
| `intelligence/theme-tagger.ts` | `tagThemes(board, phase)` |
| `intelligence/narrative-generator.ts` | `generateNarrative(phase, structures, themes, scoreCp, scoreMate)` |
| `intelligence/critical-moments.ts` | `detectCriticalMoments()`, `computeAccuracy()`, `categoriseMistakesByPhase()` |
| `intelligence/opening-gap-detector.ts` | `detectOpeningGaps(games, color, minOccurrences)` |
| `intelligence/puzzle-classifier.ts` | `extractPuzzles(analyses, metas, difficulty, max)` |

### Layer 3 — Tools

| File | Key exports |
|------|-------------|
| `tools/analyze-position.ts` | `handleAnalyzePosition(input)` |
| `tools/analyze-game.ts` | `handleAnalyzeGame(input)` |
| `tools/get-player-stats.ts` | `handleGetPlayerStats(input)` |
| `tools/scout-opponent.ts` | `handleScoutOpponent(input)` |

### Entry Point

| File | Purpose |
|------|---------|
| `index.ts` | MCP server setup, tool registration |
| `config.ts` | All env var defaults in one place |
| `types/index.ts` | All shared types, Zod input schemas |

---

## Layer Boundary Rules

These rules enforce the three-layer separation and keep the codebase maintainable:

| Layer | May import from | Must NOT import from |
|-------|----------------|---------------------|
| Intelligence (`src/intelligence/`) | `chess.js`, `src/types/` | engines, data APIs, cache, tools |
| Foundation (`src/engines/`, `src/data/`, `src/cache/`) | npm packages, `src/types/`, `src/config.ts` | intelligence layer, tools |
| Tools (`src/tools/`) | foundation layer, intelligence layer, `src/types/` | each other (no cross-tool imports) |

**Why these boundaries matter:**
- The intelligence layer stays pure — easily testable without mocks, reusable across tools
- The foundation layer stays ignorant of chess semantics — easy to swap backends
- Tools orchestrate both layers but don't leak logic between them

---

## Extending the System

### Adding a new tactical or strategic theme

1. **Add the constant** to `CHESS_THEMES` in `src/types/index.ts`:
   ```typescript
   export const CHESS_THEMES = [
     // existing themes...
     "your_new_theme",
   ] as const;
   ```

2. **Write the detector** in `src/intelligence/theme-tagger.ts`:
   ```typescript
   function hasYourNewTheme(board: Chess): boolean {
     // Use board.board(), board.moves(), etc.
     // Return true if the condition is present
     return false;
   }
   ```

3. **Register it** in the `tagThemes()` function — add a call to your detector in the results array.

4. **Add phase relevance** — add your theme to the appropriate phase priority list in `tagThemes()` so the narrative generator ranks it correctly.

5. **Add a narrative sentence** in `src/intelligence/narrative-generator.ts` — add a case for your theme key in the theme sentences map.

6. **Write tests** in `src/intelligence/theme-tagger.test.ts` — use a known FEN where your condition is present and absent.

### Adding a new pawn structure type

1. **Add the constant** to `PAWN_STRUCTURES` in `src/types/index.ts`:
   ```typescript
   export const PAWN_STRUCTURES = [
     // existing structures...
     "your_structure",
   ] as const;
   ```

2. **Write the detection logic** in `classifyPawnStructure()` in `src/intelligence/position-classifier.ts`. The function iterates over the board array — follow the existing pattern.

3. **Add a narrative sentence** for the new structure in `src/intelligence/narrative-generator.ts`.

4. **Write tests** in `src/intelligence/position-classifier.test.ts` — use a FEN where the structure is clearly present.

### Adding a new MCP tool

See `CLAUDE.md`'s "Adding a Tool" section for the full workflow. The short version:
1. Define input/output types in `src/types/index.ts`
2. Create `src/tools/your-tool.ts` with `handleYourTool(input)`
3. Register in `src/index.ts`
4. Document in `docs/tools.md` and update the file map above

---

## Design Decisions

- **Why Stockfish depth 18 as default?** Accuracy vs speed tradeoff for amateur games (sub-2000 rated). Depth 18 reliably detects all blunders and most mistakes. Depth 20+ has diminishing accuracy returns for this skill range.

- **Why two-pass adaptive depth (quietDepth=10, criticalDepth=16)?** Pass 1 sweeps all positions at depth 10 (~50ms/position with Docker) to detect eval swings. Positions with swings > `quietThreshold` (30cp) are re-evaluated at depth 16. This reduces total analysis time by ~60% vs uniform depth-16.

- **Why WASM Stockfish as fallback?** Zero infrastructure requirement for local users. Tradeoff: single-threaded WASM is 5-10x slower than Docker. The pool variant (Worker Threads) bridges the gap.

- **Why stdio transport (not HTTP)?** Claude Desktop's MCP client connects via stdio. The protocol is designed for this. HTTP transport would require a different client configuration.

- **Why SQLite for eval cache?** Persists across server restarts without any external infrastructure. Evals are deterministic (same FEN + depth + multiPv always produces the same result), so no TTL needed.

- **Why axios instead of fetch?** Stockfish WASM (the npm package) has a known side effect: it sets `global.fetch = null` during initialization. Axios uses Node.js's `http.request` internally and is unaffected by this.

- **Why console.error() for all logging?** The MCP server communicates with Claude Desktop via stdout (JSON-RPC). Any non-JSON on stdout corrupts the protocol. All logs go to stderr.

---

## Operations

### Logging Strategy

- All log output goes to `console.error()` — never `console.log()` (stdout is MCP JSON-RPC)
- Log prefix format: `[ComponentName] message: detail` (e.g. `[EngineRouter] Docker health check failed: ECONNREFUSED`)
- What is logged: engine init events, API errors, retry attempts, Docker health checks, semaphore queue depth (at debug level)
- Reading debug output: `node dist/index.js 2>mcp-debug.log` to capture stderr separately

### Error Handling Strategy

- Tool level: all errors caught at the handler boundary, logged to stderr, returned as MCP error responses (not crashes)
- Engine level: errors return `null`, caller (engine-router) falls back to next available backend
- API level: 404 → returns null (not found); 429 → one retry with jitter; other errors → log + return null
- No silent swallowing: every `catch` block either logs or re-throws

### Security Considerations

- `LICHESS_TOKEN`: stored as env var, never logged, sent only in `Authorization: Bearer <token>` header
- API tokens never appear in MCP JSON responses
- Rate limit handling: Lichess semaphore (default 10 concurrent, 25 with token) keeps the server within allowed limits
- On 429: single retry with 1-2s jitter, then degrades gracefully — no crash, no token exposure

### Testing Strategy for the Intelligence Layer

- All functions in `src/intelligence/` are pure — test them directly with `Chess` board instances
- Test fixtures: known FEN strings with expected classification outcomes
- No mocking required: just `new Chess(fen)` and plain function calls
- See `src/intelligence/*.test.ts` for patterns to follow when adding tests

### Schema Versioning

- Breaking input/output schema changes: add a versioned tool (e.g. `analyze_game_v2`) rather than modifying the existing schema
- Additive changes (new optional output fields): non-breaking, no version bump needed
- Deprecation process: announce in `CHANGELOG.md` one minor version before removal
