# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

v0.1.0 MVP — 4 tools implemented and live.

| Tool | Status |
|------|--------|
| `analyze_position` | ✅ Pass |
| `get_player_stats` | ✅ Pass |
| `scout_opponent` | ✅ Pass |
| `analyze_game` | ⚠️ Known timeout bug (see ROADMAP Known Issues) |

Next: v0.5 hardening → v0.6 (7 tools total) → v0.7 (10 tools total).

## What This Is

**ChessContext** is an MCP (Model Context Protocol) server for Claude that transforms raw chess engine output and database stats into rich semantic context. The philosophy: the MCP provides chess *meaning*, Claude provides the *reasoning*.

## Development Commands

```bash
cd mcp-server
npm install       # Install dependencies
npm run build     # Compile TypeScript → dist/
npm run dev       # Run directly with tsx (no build step)
npm start         # Run compiled dist/index.js
```

The server runs on stdio transport — it's not an HTTP server. Connect via Claude Desktop or another MCP client.

## Project Structure

```
mcp-chess/
├── mcp-server/
│   ├── src/
│   │   ├── index.ts                   # MCP server entry, tool registration
│   │   ├── config.ts                  # All config via env vars
│   │   ├── types/index.ts             # All shared TS interfaces + Zod schemas
│   │   ├── cache/index.ts             # LRU position cache + TTL player cache
│   │   ├── engines/
│   │   │   ├── stockfish.ts           # WASM UCI wrapper
│   │   │   └── lichess-eval.ts        # Cloud eval (tried first, before Stockfish)
│   │   ├── intelligence/              # Pure functions — no I/O
│   │   │   ├── position-classifier.ts # Phase, pawn structure, material
│   │   │   ├── theme-tagger.ts        # 15 strategic/tactical themes
│   │   │   ├── narrative-generator.ts # Template-based text summaries
│   │   │   └── critical-moments.ts    # Blunder/mistake detection
│   │   ├── data/
│   │   │   ├── chesscom-api.ts        # Chess.com REST client
│   │   │   └── lichess-api.ts         # Lichess REST client (NDJSON)
│   │   └── tools/                     # One handler per MCP tool
│   │       ├── analyze-position.ts
│   │       ├── analyze-game.ts
│   │       ├── get-player-stats.ts
│   │       └── scout-opponent.ts
│   ├── package.json
│   └── tsconfig.json
├── docs/
│   ├── tools.md         # Full tool schemas + example outputs
│   ├── architecture.md  # Deep-dive on 3-layer design
│   └── installation.md  # Setup guide for Claude Desktop / Cursor
├── ROADMAP.md
└── CONTRIBUTING.md
```

## Architecture

Three layers, each with a clear responsibility:

1. **Foundation (`engines/`, `data/`, `cache/`)** — raw compute and data. Stockfish WASM, Lichess cloud eval, Chess.com/Lichess API clients, LRU cache. No semantic opinions.
2. **Intelligence (`intelligence/`)** — pure functions. Takes chess.js `Chess` board instances, returns semantic annotations (phase, pawn structures, themes, narratives, critical moments).
3. **Tools (`tools/`)** — orchestrate layers 1+2 into MCP tool handlers.

## Key Implementation Decisions

- **Stockfish:** WASM via `stockfish` npm package, single-threaded (`stockfish-nnue-16-single.js`). Loaded via `createRequire` from ESM. No system binary needed.
- **Stockfish init timing:** `initEngine()` is fire-and-forget after MCP handshake (~30–60s warm-up). Tool calls that fall back to Stockfish before init completes get eval=0. Readiness gate planned for v0.5.
- **Eval routing:** Position cache → Lichess cloud eval → Stockfish (slowest). Cloud eval is tried first on every request.
- **Adaptive depth:** `analyze_game` uses depth 12 for quiet positions and depth 18 near critical moments — ~60% faster than uniform depth.
- **Adaptive narrative (planned v0.6):** All tool output will detect player skill tier from rating and adapt explanation depth — plain English for beginners, engine lines for club players, full technical output for advanced.
- **MCP SDK:** Uses `server.registerTool()` (SDK v1.28.0+). Tool responses: `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }`.
- **TypeScript:** Strict mode with `exactOptionalPropertyTypes: true`. Ratings objects use conditional spreading to satisfy this.
- **Module system:** `"type": "module"` in package.json, `"module": "Node16"` in tsconfig. All local imports use `.js` extensions.
- **All logs go to `console.error()`** — stdout is reserved for MCP JSON-RPC protocol.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STOCKFISH_DEPTH` | `18` | Default analysis depth |
| `STOCKFISH_QUIET_DEPTH` | `12` | Depth for quiet positions in game analysis |
| `STOCKFISH_TIMEOUT` | `30000` | Engine timeout (ms) |
| `LICHESS_TOKEN` | *(none)* | Optional — higher Lichess rate limits |

## Claude Desktop Config

`%APPDATA%\Claude\claude_desktop_config.json` (Windows):
```json
{
  "mcpServers": {
    "chess-context": {
      "command": "node",
      "args": ["C:/Users/rut26/OneDrive/Desktop/Repos/mcp/mcp-chess/mcp-server/dist/index.js"]
    }
  }
}
```

## Adding a New Tool

1. Add input/output types to `src/types/index.ts`
2. Create `src/tools/your-tool.ts` with a single exported handler
3. Register in `src/index.ts` with `server.registerTool()`
4. Document in `docs/tools.md`

## Next Milestones

**v0.5 (current):** Engine hardening — readiness gate, SQLite eval cache, cloud eval concurrency, Worker Thread spike for multi-threaded WASM, pawn structures (10 → 30), themes (15 → 50+).

**v0.6:** 3 new tools → 7 total: `review_game`, `get_mistake_patterns`, `get_style_fingerprint`. Adaptive explanations by player level land here.

**v0.7:** 3 more tools → 10 total: `get_opening_theory`, `find_opening_gaps`, `generate_puzzles`.

See `ROADMAP.md` for full specs and known issues.
