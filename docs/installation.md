# Installation Guide

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- A Claude MCP client: [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.sh), or any MCP-compatible client

Check your Node version:
```bash
node --version  # Should be v20.0.0 or higher
```

---

## Step 1 — Clone and Build

```bash
git clone https://github.com/your-username/mcp-chess.git
cd mcp-chess/mcp-server
npm install
npm run build
```

The compiled server will be at `mcp-server/dist/index.js`.

---

## Step 2 — Configure Your MCP Client

### Claude Desktop

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "chess-context": {
      "command": "node",
      "args": ["C:/absolute/path/to/mcp-chess/mcp-server/dist/index.js"]
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
      "args": ["/absolute/path/to/mcp-chess/mcp-server/dist/index.js"]
    }
  }
}
```

---

## Step 3 — Restart and Verify

Restart your MCP client. Then test:

> *"Analyze the starting chess position."*

Claude should call `analyze_position` and return a structured response. If it doesn't, check the [Troubleshooting](#troubleshooting) section.

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

## Development Mode

Run without building (uses `tsx` for direct TypeScript execution):

```bash
cd mcp-chess/mcp-server
npm run dev
```

Point your MCP client to `tsx` instead of `node`:

```json
{
  "mcpServers": {
    "chess-context": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-chess/mcp-server/src/index.ts"]
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

**"Engine timeout" errors**
- Reduce depth: add `"STOCKFISH_DEPTH": "12"` to the `env` section
- The WASM engine is slower than a native binary — depth 12 is fast, 18 is quality

**Chess.com rate limiting**
- Chess.com allows 300 requests/minute without authentication
- If you're hitting limits, add a delay by reducing concurrent analysis

**Lichess game not found**
- Ensure the game ID is 8 characters (e.g., `abcd1234`)
- The game must be public (not from a private study)

**Build fails**
- Ensure Node.js 20+: `node --version`
- Delete `node_modules` and `dist`, then re-run `npm install && npm run build`
