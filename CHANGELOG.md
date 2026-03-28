# Changelog

All notable changes to ChessContext will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased]

## [0.1.0] — MVP

### Added
- `analyze_position` — semantic position analysis from FEN with narrative
- `analyze_game` — full game review with critical moment detection
- `get_player_stats` — player profiles from Chess.com and Lichess
- `scout_opponent` — pre-game intelligence and strategic recommendations
- LRU position cache (500 entries, no TTL — eval is deterministic)
- Player stats TTL cache (5 minutes, 100 entries)
- Lichess cloud eval routing (instant for known positions, no local engine needed)
- Adaptive depth analysis (depth 12 for quiet positions, 18 for critical)
- Position classifier: game phase, 10 pawn structure types, material balance
- Theme tagger: 15 strategic and tactical themes
- Template-based position narratives
- CI pipeline (TypeScript compile check on push)
