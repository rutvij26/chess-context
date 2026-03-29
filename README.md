# ChessContext MCP

[![codecov](https://codecov.io/gh/rutvij26/chess-context/branch/main/graph/badge.svg)](https://codecov.io/gh/rutvij26/chess-context)

**Semantic chess intelligence for Claude.** Not just engine numbers — context, narrative, and strategic insight.

Instead of `best move: Nf3 (+0.4)`, ChessContext gives Claude:

> *"The position is a Sicilian structure entering the middlegame. An isolated queen pawn creates dynamic imbalance — White has active piece play while Black has a long-term structural target. A knight on e5 is anchored on an outpost with no enemy pawn to evict it. White holds a slight edge (+0.8). Best continuation: Nd5, a strong centralizing move that eyes the f4 square and threatens to exchange Black's key defensive piece."*

Built on the [Model Context Protocol](https://modelcontextprotocol.io) — works with Claude Desktop, Cursor, and any MCP-compatible client.

---

## Demo

```
You: Analyze this position for me: r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 4 5

Claude: [calls analyze_position]

The game is in the opening phase. The symmetrical pawn structure means the
game is balanced — the player with better piece activity will have the edge.
The bishop pair gives White long-term compensation in an open position.
Active, well-coordinated pieces give the better side significant attacking
potential. White holds a slight edge (+0.3).

Top moves:
1. O-O (castling — improves king safety and connects the rooks)
2. d4 — central pawn break, opening the c4 bishop's diagonal
3. Be3 — developing and preparing queenside play
```

```
You: Scout my opponent "MagnusCarlsen" on Lichess before our match. I'll be playing White.

Claude: [calls scout_opponent]

Magnus plays the Sicilian Defense in 45% of games as Black vs e4, and the
King's Indian against d4 (55%). His win rate drops significantly in simplified
positions — he has a 42% win rate in endgames vs his 61% overall.

Recommendation: Avoid the sharp Najdorf lines where he's most dangerous.
Consider the Rossolimo (3.Bb5) — leads to strategic positions and sidesteps
his preparation. Aim to trade pieces and reach a technical endgame.
```

---

## Quick Start

**Prerequisites:** Node.js 20+

```bash
git clone https://github.com/your-username/mcp-chess.git
cd mcp-chess/mcp-server
npm install
npm run build
```

Add to your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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

Restart Claude Desktop. You're ready — try: *"Analyze the starting chess position."*

For detailed setup instructions, see [docs/installation.md](docs/installation.md).

---

## Tools

| Tool | Description | Example Prompt |
|------|-------------|----------------|
| `analyze_position` | Semantic analysis of a FEN position | *"Analyze this position: [FEN]"* |
| `analyze_game` | Full game review from PGN or Lichess URL | *"Review my game: [Lichess URL]"* |
| `get_player_stats` | Player profile, ratings, and opening repertoire | *"Get hikaru's stats on chess.com"* |
| `scout_opponent` | Pre-game scouting report with strategic recommendations | *"Scout [username] on lichess, I'm playing white"* |

Full tool schemas and example outputs: [docs/tools.md](docs/tools.md)

---

## Configuration

Set these environment variables to customize behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `STOCKFISH_DEPTH` | `18` | Default search depth for position analysis |
| `STOCKFISH_QUIET_DEPTH` | `12` | Depth for quiet positions in game analysis |
| `STOCKFISH_TIMEOUT` | `30000` | Engine timeout in milliseconds |
| `LICHESS_TOKEN` | *(none)* | Optional Lichess API token for higher rate limits |

Add to the MCP server config:

```json
{
  "mcpServers": {
    "chess-context": {
      "command": "node",
      "args": ["/path/to/mcp-chess/mcp-server/dist/index.js"],
      "env": {
        "LICHESS_TOKEN": "your_token_here",
        "STOCKFISH_DEPTH": "20"
      }
    }
  }
}
```

---

## Architecture

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

**Layer 1** handles raw compute: Stockfish engine (WASM, no system binary needed), Lichess cloud evaluation (instant, free for known positions), and Chess.com/Lichess API clients.

**Layer 2** transforms raw numbers into meaning: game phase detection, 10 pawn structure types, 15 tactical/strategic themes, template-based narratives, and critical moment detection (blunders, mistakes, missed wins).

**Layer 3** wires everything into MCP tools registered with the Claude Desktop server.

**Caching:** Position evaluations are cached by FEN + depth (LRU, 500 entries). Player stats are cached with a 5-minute TTL. `analyze_game` on the same game twice takes milliseconds the second time.

Deep-dive: [docs/architecture.md](docs/architecture.md)

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full milestone checklist.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — adding themes, pawn structures, and new tools is straightforward and documented.

## License

MIT — see [LICENSE](LICENSE)
