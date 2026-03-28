# Roadmap

### v0.1 — MVP ✅
- [x] `analyze_position` — FEN → semantic analysis with narrative
- [x] `analyze_game` — PGN/Lichess URL → full game review with critical moments
- [x] `get_player_stats` — Chess.com + Lichess player profiles and repertoires
- [x] `scout_opponent` — pre-game scouting report with strategic recommendations
- [x] LRU position cache + player TTL cache
- [x] Lichess cloud eval routing (instant for known positions)
- [x] Adaptive depth analysis (~60% faster game analysis)
- [x] CI pipeline (TypeScript compile check)

### v0.5 — Hardening
- [ ] Leela Chess Zero support (Docker, strategic analysis layer)
- [ ] Multi-engine disagreement reports
- [ ] `review_game` one-click post-game workflow
- [ ] Expand pawn structures: 10 → 30 canonical types
- [ ] Expand themes: 15 → 50+
- [ ] Redis cache option (persist analysis across restarts)

### v1.0 — Intelligence Expansion
- [ ] `get_opening_theory` — opening narrative with historical context and trends
- [ ] `get_endgame_analysis` — Syzygy tablebase with human-readable winning plan
- [ ] `generate_training_positions` — weakness-targeted practice positions
- [ ] `build_preparation` — full tournament preparation pipeline
- [ ] Play style fingerprint (aggression, positional, tactical, endgame dimensions)
- [ ] Tilt detection from recent game patterns

### v2.0 — Advanced
- [ ] Semantic position search (embedding-based similarity across game databases)
- [ ] Pattern memory across game history (recurring mistake detection)
- [ ] Opening novelty detector (where does a game leave known theory?)
- [ ] Generative position lab (create training positions on demand)
- [ ] Docker Compose deployment for self-hosting with full engine stack
