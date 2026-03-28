# Roadmap

### Known Issues
- [ ] **BUG [`analyze_game` timeout]** — Times out if called before Stockfish WASM initializes
      (~30–60s after server start). Positions not in Lichess cloud DB get eval=0, producing
      meaningless accuracy scores and zero critical moments.
      Workaround: wait ~60s after connecting. Fix: v0.5 readiness gate + eval cache.
- [ ] **PERF [`analyze_game` sequential fallback]** — Cloud-eval misses fall back to
      single-threaded WASM sequentially. Lower-rated games can hit the 50s timeout.
      Fix: v0.5 Worker Thread spike.
- [ ] **DATA [`get_player_stats` / `scout_opponent` opening names]** — PGN clock annotations
      (`{[%clk ...]}`) leaked into opening name strings. Fixed in latest commit.

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

### v0.5 — Hardening _(engine reliability, no new tools)_
- [ ] Engine readiness gate — tool calls block until Stockfish is initialized
- [ ] Disk-backed eval cache (SQLite via better-sqlite3, survives restarts)
- [ ] Lichess cloud eval concurrency: 4 → 10 concurrent requests
- [ ] Adaptive depth: depth 10 quiet / depth 16 critical (currently 12/18)
- [ ] MCP progress notifications for game analysis ("Evaluating position 34/80…")
- [ ] Spike: multi-threaded Stockfish WASM in Node.js Worker Thread
- [ ] Expand pawn structures: 10 → 30 canonical types
- [ ] Expand themes: 15 → 50+
- [ ] Redis cache option (optional upgrade from SQLite)

### v0.6 — Post-Game Intelligence _(7 tools total)_
3 new tools. All output adapts explanation depth to detected player level
(beginner / club player / advanced).

- [ ] `review_game` — one-click post-game debrief: accuracy by phase, key turning point,
      what to study next. Beginners get plain English; club players get engine lines.
- [ ] `get_mistake_patterns` — scan last N games for recurring mistake types:
      "you consistently blunder when castling queenside under time pressure".
      Uses Chess.com / Lichess game history. Free, no API keys required.
- [ ] `get_style_fingerprint` — characterize a player across 5 dimensions:
      aggression, positional sense, tactical sharpness, endgame skill, time management.
      Derived from last 50 rated games. Works on both platforms.

### v0.7 — Opening & Training _(10 tools total)_
3 new tools — reaches 10 total registered MCP tools.

- [ ] `get_opening_theory` — opening narrative for any position: name, key ideas, main
      continuations, historical context. Uses Lichess Opening Explorer (free).
      Explanation adapts to player level.
- [ ] `find_opening_gaps` — analyze a player's repertoire and surface positions they haven't
      studied where opponents commonly deviate and win.
      "Your Italian Game collapses after 5.d3 Nc6 6.c3 — 7 losses from this position."
- [ ] `generate_puzzles` — extract tactical puzzles from a player's own games: positions
      where they missed a tactic or blundered. Returns FEN + solution + difficulty estimate.
      Free, offline-capable once game data is fetched.

### v1.0 — Advanced Player Tools
- [ ] `get_endgame_analysis` — Syzygy tablebase via Lichess free API (≤7 pieces):
      win/draw/loss verdict + human-readable winning plan
- [ ] `detect_tilt` — identify tilt indicators from recent game patterns:
      accelerating time usage, rising blunder rate, result streaks
- [ ] `get_performance_by_opening` — deep win/draw/loss breakdown per opening line,
      filtered by time control and color. Deeper than `get_player_stats` opening repertoire.
- [ ] `get_tournament_prep` — full pre-game pipeline: `scout_opponent` +
      `find_opening_gaps` + `get_style_fingerprint` in one formatted briefing document
- [ ] `get_novelty_detector` — find the move where a game left known theory and assess
      whether the novelty was an improvement or a mistake
- [ ] `compare_games` — surface what changed between two games by the same player
      (useful for "did my opening improve after studying this line?")

### v2.0 — Advanced / Self-Hosting
- [ ] Docker Compose deployment with native Stockfish + Leela Chess Zero
- [ ] Multi-engine disagreement reports (Stockfish vs Leela on the same position)
- [ ] Semantic position search (embedding-based similarity across game databases)
- [ ] Opening novelty database (track where every game left theory, across all your games)
- [ ] Generative position lab (create targeted training positions on demand)
- [ ] Play style matchmaking (find grandmaster games that match your style)
