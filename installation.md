# Installation Guide

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- A Claude MCP client: [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.sh), or any MCP-compatible client
- **Docker Desktop** *(recommended)* — [docker.com](https://www.docker.com/products/docker-desktop/) for fast native Stockfish engine

Check your Node version:
```bash
node --version  # Should be v20.0.0 or higher
```

---

## Step 1 — Clone and Build

```bash
git clone https://github.com/rutvij26/chess-context.git
cd chess-context/mcp-server
npm install
npm run build
```

The compiled server will be at `mcp-server/dist/index.js`.

---

## Step 2 — Start the Stockfish Engine (Recommended)

ChessContext works without Docker (falls back to a built-in WASM engine), but the **Docker Stockfish container is strongly recommended** — it's multi-threaded, has no startup delay, and makes `analyze_game` dramatically faster and more reliable.

```bash
cd mcp-server
docker compose up -d
```

Verify it's running:
```bash
curl http://localhost:8090/health
# → {"status":"ready","threads":4}
```

The container auto-restarts (`unless-stopped`) so it's always available after your machine boots. To stop it: `docker compose down`.

> **Without Docker:** The server falls back to a single-threaded WASM Stockfish that takes 30–60 seconds to warm up after Claude Desktop starts. `analyze_game` may timeout on longer games during the warmup window.

---

## Step 3 — Configure Your MCP Client

### Claude Desktop

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "chess-context": {
      "command": "node",
      "args": ["C:/absolute/path/to/chess-context/mcp-server/dist/index.js"]
    }
  }
}
```

> **Windows paths:** Use forward slashes or double backslashes. Relative paths don't work.

### Cursor

Add to `.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "chess-context": {
      "command": "node",
      "args": ["/absolute/path/to/chess-context/mcp-server/dist/index.js"]
    }
  }
}
```

---

## Step 4 — Restart and Verify

Restart your MCP client. Then test:

> *"Analyze the starting chess position."*

Claude should call `analyze_position` and return a structured response. If it doesn't, check the [Troubleshooting](#troubleshooting) section.

---

## Docker Configuration

The Stockfish container is tuned via environment variables in `mcp-server/docker-compose.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `STOCKFISH_THREADS` | `4` | CPU threads for Stockfish (set to your core count) |
| `STOCKFISH_HASH` | `256` | Hash table size in MB (use ~25% of your RAM) |
| `STOCKFISH_PORT` | `8090` | HTTP port exposed to the host |
| `STOCKFISH_TIMEOUT` | `30000` | Per-request timeout in ms |

To change settings, edit `docker-compose.yml` and run `docker compose up -d` again.

If you run Docker on a non-default port, tell the MCP server:
```json
{
  "mcpServers": {
    "chess-context": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "STOCKFISH_API_URL": "http://localhost:9000"
      }
    }
  }
}
```

---

## PostgreSQL Game Store (Optional)

The `refresh_games`, `get_mistake_patterns`, and `get_style_fingerprint` tools require a PostgreSQL database to store and query game analyses. The other 5 tools work without it.

### Step 1 — Start Postgres

Postgres is included in the same `docker-compose.yml` as Stockfish:

```bash
cd mcp-server
docker compose up -d postgres
```

Or start both at once:

```bash
docker compose up -d
```

Verify:
```bash
docker exec chess-postgres pg_isready -U chess -d chess_context
# → /var/run/postgresql:5432 - accepting connections
```

### Step 2 — Configure DATABASE_URL

Add `DATABASE_URL` to your MCP client config:

```json
{
  "mcpServers": {
    "chess-context": {
      "command": "node",
      "args": ["/path/to/mcp-chess/mcp-server/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://chess:chess@localhost:5432/chess_context"
      }
    }
  }
}
```

The server automatically runs schema migrations on startup — no manual SQL needed. If `DATABASE_URL` is not set, the game store tools return a `note` field explaining the requirement; all other tools continue working normally.

### Step 3 — Fetch and Analyze Games

```
"Refresh my last 20 games: username notsobrillantmove on chess.com"
```

This calls `refresh_games`, which fetches games from Chess.com, inserts them into Postgres, and queues them for background Stockfish analysis. After ~30–60 seconds, `get_mistake_patterns` and `get_style_fingerprint` will have data to work with.

---

## Optional: Lichess API Token

ChessContext works without any API keys. Adding a Lichess token gives you higher rate limits for fetching game history:

1. Create a token at [lichess.org/account/oauth/token](https://lichess.org/account/oauth/token)
2. Scopes needed: none (read-only public data)
3. Add to your config:

```json
{
  "mcpServers": {
    "chess-context": {
      "command": "node",
      "args": ["/path/to/mcp-chess/mcp-server/dist/index.js"],
      "env": {
        "LICHESS_TOKEN": "your_token_here"
      }
    }
  }
}
```

---

## Optional: Enable Lichess Cloud Eval

By default, ChessContext uses local Stockfish for all evaluations. To also query the Lichess cloud eval API for well-known positions (can speed up analysis of mainstream openings):

```json
"env": {
  "ENABLE_LICHESS_CLOUD": "true"
}
```

---

## Development Mode

Run without building (uses `tsx` for direct TypeScript execution):

```bash
cd chess-context/mcp-server
npm run dev
```

Point your MCP client to `tsx` instead of `node`:

```json
{
  "mcpServers": {
    "chess-context": {
      "command": "npx",
      "args": ["tsx", "/path/to/chess-context/mcp-server/src/index.ts"]
    }
  }
}
```

---

## Troubleshooting

**"Tools not showing up in Claude"**
- Verify the path in your config is absolute (not relative)
- Restart Claude Desktop fully (not just the chat)
- Check Claude Desktop logs: `%APPDATA%\Claude\logs\` (Windows) or `~/Library/Logs/Claude/` (macOS)

**"Engine timeout" or `analyze_game` fails**
- Start the Docker container: `cd mcp-server && docker compose up -d`
- If Docker isn't an option, reduce depth: add `"STOCKFISH_DEPTH": "12"` to the `env` section
- Check container health: `curl http://localhost:8090/health`

**`analyze_game` slow or returning low eval coverage**
- The WASM fallback takes 30–60s to warm up after Claude Desktop starts; wait and retry
- With Docker running, game analysis should complete in 8–16s for a typical 40-move game

**Chess.com rate limiting**
- Chess.com allows 300 requests/minute without authentication
- If you're hitting limits, add a delay by reducing concurrent analysis

**Lichess game not found**
- Ensure the game ID is 8 characters (e.g., `abcd1234`)
- The game must be public (not from a private study)

**Build fails**
- Ensure Node.js 20+: `node --version`
- Delete `node_modules` and `dist`, then re-run `npm install && npm run build`

**Docker container won't start**
- Ensure Docker Desktop is running
- Check logs: `docker logs stockfish`
- Try a clean rebuild: `docker compose up -d --build`
