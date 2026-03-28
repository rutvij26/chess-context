# Architecture

ChessContext is built on a three-layer design. The key principle: **the MCP provides chess meaning, Claude provides the reasoning.**

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
│  Stockfish WASM · Lichess Cloud Eval            │
│  Chess.com API · Lichess API · LRU Cache        │
└─────────────────────────────────────────────────┘
```

### Layer 1 — Foundation (`src/engines/`, `src/data/`, `src/cache/`)

Raw compute and data access. Has no opinion about what it returns — just gets the data correctly.

- **`engines/stockfish.ts`** — WASM UCI wrapper. Manages engine lifecycle, queues requests (one `go` at a time), parses `info` lines, returns `UCIAnalysisLine[]`. 30-second timeout, retry on crash.
- **`engines/lichess-eval.ts`** — Queries the Lichess cloud evaluation API (`/api/cloud-eval`). Free, instant for known positions. Returns `null` if position isn't in the cloud DB. Tools always try this before touching local Stockfish.
- **`data/chesscom-api.ts`** — Chess.com REST client. Fetches profiles, ratings, game archives (PGN format). Handles 404 as `PlayerNotFoundError`, retries on 429.
- **`data/lichess-api.ts`** — Lichess REST client. Parses NDJSON game streams. Uses `?opening=true` parameter for free ECO codes on every game.
- **`cache/index.ts`** — Two in-memory caches:
  - Position cache (LRU, 500 entries): `fen:depth:multiPv → UCIAnalysisLine[]`. No TTL — eval is deterministic.
  - Player cache (TTL, 100 entries, 5 minutes): `platform:username → PlayerStats`. Prevents double API calls from `scout_opponent`.

### Layer 2 — Intelligence (`src/intelligence/`)

Pure functions — no I/O, no side effects. Takes chess.js board state and engine output, returns semantic annotations.

- **`position-classifier.ts`** — `classifyPhase()` (opening/middlegame/endgame by piece count and move number), `classifyPawnStructure()` (10 types: isolated, doubled, passed, backward, hanging, chain, symmetrical, open/closed/semi-open center), `getMaterialBalance()` (centipawns).
- **`theme-tagger.ts`** — `tagThemes()` returns up to 15 active themes per position using chess.js board inspection: king safety, pawn storm, space advantage, piece activity, bishop pair, knight outpost, open file, weak squares, pin, fork potential, back rank, opposite-colored bishops, rook on 7th, connected rooks, material imbalance.
- **`narrative-generator.ts`** — `generateNarrative()` composes 2-4 sentences from phase + structure + top themes + eval. Template-based — deterministic and fast. Themes are ranked by phase relevance (e.g., king safety ranks higher in the middlegame, passed pawns rank higher in the endgame).
- **`critical-moments.ts`** — `detectCriticalMoments()` classifies each move: blunder (≥200cp drop), mistake (≥100cp), inaccuracy (≥50cp), missed_win (had >300cp, dropped below 100cp). `computeAccuracy()` measures % of moves within 30cp of best.

### Layer 3 — Tools (`src/tools/`)

Orchestrates Layers 1 and 2 into MCP tool handlers. Each tool is a single file with a single exported handler function.

- **`analyze-position.ts`** — Cache → cloud eval → Stockfish → classify → tag → narrative → SAN conversion.
- **`analyze-game.ts`** — Resolve PGN (direct/Lichess URL) → replay with chess.js → analyze each position with adaptive depth → detect critical moments → compute accuracy.
- **`get-player-stats.ts`** — Thin dispatch: check player cache → call correct API client → cache result.
- **`scout-opponent.ts`** — Calls `get-player-stats` internally → analyze repertoire vs your color → rule-based strategic recommendation.

## Performance Design

### Eval Routing (fastest to slowest)
```
1. Position cache  → instant (in-memory LRU)
2. Lichess cloud   → ~200ms (covers most opening/known positions)
3. Local Stockfish → 2-10s per position (WASM, depth 12-18)
```

### Adaptive Depth in `analyze_game`
Full games would be slow if every position were analyzed at depth 18. Instead:
- Positions where eval barely changed from the previous move → depth 12
- Positions with significant eval change → depth 18
- First and last positions → depth 20

This cuts analysis time by ~60% while keeping quality on critical positions.

### Caching in Game Analysis
After the first analysis, the same game can be re-analyzed near-instantly. Every position's eval is cached by FEN, so re-runs or analyses of positions shared between games hit the cache.

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
