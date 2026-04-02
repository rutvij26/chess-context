# CLAUDE.md

## Status
v0.1.0 — 4 tools live. `analyze_game` has known timeout bug (see ROADMAP #1).
Next: v0.5 hardening → v0.6 (7 tools) → v0.7 (10 tools).

## Commands
```bash
cd mcp-server
npm run build   # TS → dist/
npm run dev     # tsx (no build)
npm start       # dist/index.js
```
stdio transport — not HTTP. Connect via Claude Desktop.

## Structure
```
mcp-server/src/
  index.ts              # entry, tool registration
  config.ts             # env vars
  types/index.ts        # interfaces + Zod schemas
  cache/index.ts        # SQLite position cache + LRU player stats cache
  cache/sqlite-cache.ts # SQLite-backed eval persistence (survives restarts)
  engines/stockfish.ts  # WASM UCI wrapper
  engines/lichess-eval.ts # cloud eval (tried first)
  intelligence/         # pure fns, no I/O
  data/                 # chesscom-api.ts, lichess-api.ts
  tools/                # one handler per tool
```

## Architecture
3 layers: **Foundation** (engines, data, cache) → **Intelligence** (pure fns, semantic annotations) → **Tools** (MCP handlers).

## Key Decisions
- Stockfish: WASM via npm, single-threaded, loaded with `createRequire` from ESM
- Init: fire-and-forget after `server.connect()` — don't block MCP handshake (~30–60s warmup)
- Eval routing: cache → Lichess cloud → Stockfish
- HTTP: axios everywhere (immune to Stockfish's `fetch=null` side effect)
- Logs: `console.error()` only — stdout is MCP JSON-RPC
- TS: strict + `exactOptionalPropertyTypes`. Imports use `.js` extensions. `"type": "module"`

## Env Vars
| Var | Default | Desc |
|-----|---------|------|
| `STOCKFISH_DEPTH` | `18` | default depth |
| `STOCKFISH_QUIET_DEPTH` | `10` | quiet positions (pass 1) |
| `STOCKFISH_CRITICAL_DEPTH` | `16` | critical positions (pass 2) |
| `STOCKFISH_TIMEOUT` | `30000` | ms per position |
| `STOCKFISH_READINESS_TIMEOUT` | `90000` | ms to wait for engine init before rejecting tool calls |
| `LICHESS_TOKEN` | — | optional, higher rate limits (allows LICHESS_CLOUD_CONCURRENCY=25) |
| `LICHESS_CLOUD_CONCURRENCY` | `10` | max concurrent cloud eval requests (safe default; raise to 25 with a token) |
| `EVAL_CACHE_DB` | `~/.chess-context/eval-cache.db` | SQLite eval cache path |

## Claude Desktop Config (Windows)
```json
{ "mcpServers": { "chess-context": { "command": "cmd", "args": ["/c", "node", "C:/Users/rut26/OneDrive/Desktop/Repos/mcp/mcp-chess/mcp-server/dist/index.js"] } } }
```

## Adding a Tool
1. Types → `src/types/index.ts`
2. Handler → `src/tools/your-tool.ts`
3. Register → `src/index.ts`
4. Docs → `docs/tools.md`

## Issue Workflow
For every GitHub issue:
1. `git checkout -b issue-<N>-short-description`
2. Implement + tests
3. PR: link issue (`Closes #N`), assign @rutvij26 as reviewer
4. Merge only after review approval

## Milestones
See `ROADMAP.md`. All tasks tracked as GitHub issues (#1–#30).
