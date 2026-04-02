# Roadmap

### Known Issues
- [x] **BUG [`analyze_game` timeout]** — Fixed in v0.5: readiness gate (#4) blocks tool calls
      until Stockfish is initialized. SQLite cache (#5) serves warmed positions instantly.
      → [#1](https://github.com/rutvij26/chess-context/issues/1) ✅
- [ ] **PERF [`analyze_game` sequential fallback]** — Cloud-eval misses fall back to
      single-threaded WASM sequentially. Lower-rated games can hit the 50s timeout.
      Worker Thread spike deferred (#9 closed). Mitigated by cloud eval concurrency=10 (#6).
      → [#2](https://github.com/rutvij26/chess-context/issues/2)
- [x] **DATA [`get_player_stats` / `scout_opponent` opening names]** — PGN clock annotations
      (`{[%clk ...]}`) leaked into opening name strings. Fixed in latest commit.
      → [#3](https://github.com/rutvij26/chess-context/issues/3) ✅

---

### v0.1 — MVP ✅ _(4 tools)_
- [x] `analyze_position` — FEN → semantic analysis, narrative, best moves
- [x] `analyze_game` — PGN/Lichess URL → game review with critical moments (see Known Issues)
- [x] `get_player_stats` — Chess.com + Lichess ratings, openings, recent form
- [x] `scout_opponent` — pre-game scouting report with strategic recommendations
- [x] LRU position cache + player TTL cache
- [x] Lichess cloud eval routing (instant for known positions)
- [x] Adaptive depth analysis (~60% faster game analysis)
- [x] CI pipeline (TypeScript compile check)

### v0.5 — Hardening ✅ _(engine reliability, no new tools)_
- [x] Engine readiness gate — tool calls block until Stockfish is initialized → [#4](https://github.com/rutvij26/chess-context/issues/4)
- [x] Disk-backed eval cache (SQLite via better-sqlite3, survives restarts) → [#5](https://github.com/rutvij26/chess-context/issues/5)
- [x] Lichess cloud eval concurrency: 4 → 10 concurrent requests → [#6](https://github.com/rutvij26/chess-context/issues/6)
- [x] Adaptive depth: depth 10 quiet / depth 16 critical (currently 12/18) → [#7](https://github.com/rutvij26/chess-context/issues/7)
- [x] MCP progress notifications for game analysis ("Evaluating position 34/80…") → [#8](https://github.com/rutvij26/chess-context/issues/8)
- [ ] ~~Spike: multi-threaded Stockfish WASM in Node.js Worker Thread~~ → deferred, mitigated by #6 → [#9](https://github.com/rutvij26/chess-context/issues/9)
- [ ] ~~Expand pawn structures: 10 → 30 canonical types~~ → deferred to v0.6 → [#10](https://github.com/rutvij26/chess-context/issues/10)
- [ ] ~~Expand themes: 15 → 50+~~ → deferred to v0.6 → [#11](https://github.com/rutvij26/chess-context/issues/11)
- [ ] ~~Redis cache option (optional upgrade from SQLite)~~ → deferred to v1.0 → [#12](https://github.com/rutvij26/chess-context/issues/12)

### v0.6 — Post-Game Intelligence _(7 tools total)_
3 new tools. All output adapts explanation depth to detected player level
(beginner / club player / advanced).

- [ ] `review_game` — one-click post-game debrief: accuracy by phase, key turning point,
      what to study next. Beginners get plain English; club players get engine lines.
      → [#13](https://github.com/rutvij26/chess-context/issues/13)
- [ ] `get_mistake_patterns` — scan last N games for recurring mistake types:
      "you consistently blunder when castling queenside under time pressure".
      Uses Chess.com / Lichess game history. Free, no API keys required.
      → [#14](https://github.com/rutvij26/chess-context/issues/14)
- [ ] `get_style_fingerprint` — characterize a player across 5 dimensions:
      aggression, positional sense, tactical sharpness, endgame skill, time management.
      Derived from last 50 rated games. Works on both platforms.
      → [#15](https://github.com/rutvij26/chess-context/issues/15)

### v0.7 — Opening & Training _(10 tools total)_
3 new tools — reaches 10 total registered MCP tools.

- [ ] `get_opening_theory` — opening narrative for any position: name, key ideas, main
      continuations, historical context. Uses Lichess Opening Explorer (free).
      Explanation adapts to player level.
      → [#16](https://github.com/rutvij26/chess-context/issues/16)
- [ ] `find_opening_gaps` — analyze a player's repertoire and surface positions they haven't
      studied where opponents commonly deviate and win.
      "Your Italian Game collapses after 5.d3 Nc6 6.c3 — 7 losses from this position."
      → [#17](https://github.com/rutvij26/chess-context/issues/17)
- [ ] `generate_puzzles` — extract tactical puzzles from a player's own games: positions
      where they missed a tactic or blundered. Returns FEN + solution + difficulty estimate.
      Free, offline-capable once game data is fetched.
      → [#18](https://github.com/rutvij26/chess-context/issues/18)

### v1.0 — Advanced Player Tools
- [ ] `get_endgame_analysis` — Syzygy tablebase via Lichess free API (≤7 pieces):
      win/draw/loss verdict + human-readable winning plan → [#19](https://github.com/rutvij26/chess-context/issues/19)
- [ ] `detect_tilt` — identify tilt indicators from recent game patterns:
      accelerating time usage, rising blunder rate, result streaks → [#20](https://github.com/rutvij26/chess-context/issues/20)
- [ ] `get_performance_by_opening` — deep win/draw/loss breakdown per opening line,
      filtered by time control and color. Deeper than `get_player_stats` opening repertoire.
      → [#21](https://github.com/rutvij26/chess-context/issues/21)
- [ ] `get_tournament_prep` — full pre-game pipeline: `scout_opponent` +
      `find_opening_gaps` + `get_style_fingerprint` in one formatted briefing document
      → [#22](https://github.com/rutvij26/chess-context/issues/22)
- [ ] `get_novelty_detector` — find the move where a game left known theory and assess
      whether the novelty was an improvement or a mistake → [#23](https://github.com/rutvij26/chess-context/issues/23)
- [ ] `compare_games` — surface what changed between two games by the same player
      (useful for "did my opening improve after studying this line?") → [#24](https://github.com/rutvij26/chess-context/issues/24)

### v2.0 — Advanced / Self-Hosting
- [ ] Docker Compose deployment with native Stockfish + Leela Chess Zero → [#25](https://github.com/rutvij26/chess-context/issues/25)
- [ ] Multi-engine disagreement reports (Stockfish vs Leela on the same position) → [#26](https://github.com/rutvij26/chess-context/issues/26)
- [ ] Semantic position search (embedding-based similarity across game databases) → [#27](https://github.com/rutvij26/chess-context/issues/27)
- [ ] Opening novelty database (track where every game left theory, across all your games) → [#28](https://github.com/rutvij26/chess-context/issues/28)
- [ ] Generative position lab (create targeted training positions on demand) → [#29](https://github.com/rutvij26/chess-context/issues/29)
- [ ] Play style matchmaking (find grandmaster games that match your style) → [#30](https://github.com/rutvij26/chess-context/issues/30)
