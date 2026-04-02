# chess-context MCP

A Model Context Protocol server that enriches raw chess data into structured, semantically annotated JSON — giving Claude the chess meaning it needs to provide expert analysis.

## What it does

chess-context is a **deterministic pre-processing layer** between your chess games and Claude. It runs Stockfish, calls Chess.com and Lichess APIs, classifies positions, and annotates moves — so Claude receives structured intelligence rather than raw centipawn scores.

## Four tools

| Tool | What it does |
|------|-------------|
| `analyze_position` | Deep single-position analysis: best moves, themes, narrative |
| `analyze_game` | Full game review: critical moments, accuracy, phase breakdown |
| `get_player_stats` | Rating history, win rates, opening repertoire |
| `scout_opponent` | Pre-game scouting report with strategic recommendations |

## Quick start

```bash
git clone https://github.com/rutvij26/chess-context
cd chess-context/mcp-server
npm install
npm run build
```

Then add to Claude Desktop — see [Installation](installation.md) for full setup.

## Docs

- [Installation](installation.md) — prerequisites, setup, Docker configuration
- [Architecture](architecture.md) — three-layer design, engine routing, extensibility
- [Tool Reference](tools.md) — full input/output schemas with examples
- [Intelligence Layer](intelligence.md) — how positions are classified and annotated
- [Reliability & Performance](reliability.md) — failure modes, latency, caching
