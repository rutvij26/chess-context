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
├─────────────────────────────────────────────────┤
│           LAYER 2: INTELLIGENCE                 │
│  Position Classifier · Theme Tagger             │
│  Narrative Generator · Critical Moments         │
├─────────────────────────────────────────────────┤
│            LAYER 1: FOUNDATION                  │
│  Engine Router · Docker Stockfish               │
│  WASM Stockfish (fallback) · LRU Cache          │
│  Chess.com API · Lichess API                    │
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

**`data/lichess-api.ts`** — Lichess REST client. Parses NDJSON game streams. Uses `?opening=true` parameter for free ECO codes on every game.

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

---

### Layer 3 — Tools (`src/tools/`)

Orchestrates Layers 1 and 2 into MCP tool handlers. Each tool is a single file with a single exported handler function.

- **`analyze-position.ts`** — `getEval()` (via router) → classify → tag → narrative → SAN conversion.
- **`analyze-game.ts`** — Resolve PGN (direct/URL/username) → replay with chess.js → `Promise.all` over `getEval()` for all positions → detect critical moments → compute accuracy.
- **`get-player-stats.ts`** — Thin dispatch: check player cache → call correct API client → cache result.
- **`scout-opponent.ts`** — Calls `get-player-stats` internally → analyze repertoire vs your color → rule-based strategic recommendation.

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

All positions in `analyze_game` are evaluated at `quietDepth` (default 12). The `analyze_position` tool uses `defaultDepth` (default 18) for deep single-position analysis.

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
