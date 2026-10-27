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

## Hosted Track — free, zero-install remote MCP

Goal: anyone adds one URL (or one click from the Claude connectors directory) and Claude calls
ChessContext on its own, with no local setup. Everything here is **free tier first**; paid
features are deferred (see H5). Items are issue-sized; issue numbers get assigned when filed.

Findings from the current code that shape this track:
- Transport is stdio only (`src/index.ts`). `hono` is already a dependency, so a `/mcp` HTTP route is a small step.
- None of the 12 registered tools declares annotations (`readOnlyHint` / `destructiveHint`), which the connectors directory requires.
- Four tools (`get_mistake_patterns`, `get_style_fingerprint`, `generate_puzzles`, `get_analysis_progress`) read from a Postgres game store that `refresh_games` fills. That assumes one local user. A public server needs per-request or per-session scoping, or stateless variants.
- Engine is a single shared process plus a 500-entry in-memory LRU and a local SQLite file. Fine for one user, not for many.
- Package name (`mcp-chess`) differs from the repo and server name (`chess-context`).

### H1 — Remote-ready _(one URL, no install)_
- [ ] Streamable HTTP transport on `/mcp` (Hono), keep stdio working for local use
- [ ] Add `title` + `readOnlyHint`/`destructiveHint` annotations to all 12 tools (`refresh_games` writes data; the rest are read-only)
- [ ] Stateless mode: `get_mistake_patterns`, `get_style_fingerprint`, `generate_puzzles` accept a username and fetch + analyze within a bounded request, so they work without a pre-filled Postgres store
- [ ] `refresh_games` / `get_analysis_progress` become optional (local mode) or are replaced by an async job: fast partial result plus a job ID and a `get_analysis_result` tool
- [ ] Remove "run `docker compose up -d postgres`" from tool descriptions in hosted mode
- [ ] `/health` endpoint, config for port and allowed origins, container image for deploy
- [ ] Unify naming (`chess-context` vs `mcp-chess`) in `package.json`, bin, docs
- [ ] Fix red CI on `main`

### H1.5 — "How can I improve?" front door _(the first helpful thing, for every level)_
Target user: everyone. One entry point whose output adapts to the detected rating band
(`intelligence/player-level.ts`: beginner / club / advanced) instead of separate products.

- [ ] `improve_my_game` — input: a username (Chess.com or Lichess), optional time control.
      Fetches the last ~20 rated games, then returns:
      1. **Top 3 recurring leaks**, ranked by rating points lost (reuses `get_mistake_patterns`,
         `find_opening_gaps`, critical-moment classification), each with one plain sentence,
         two example positions, and a confidence tag (engine-verified vs heuristic).
      2. **One drill per leak**: puzzles built from the player's own blunders (`generate_puzzles`).
      3. **A short plan** for the next 7 days (what to practice, what to play, what to avoid).
      4. **A "re-run in a week" hook** so progress is measurable (feeds `get_improvement_tracker`, #92).
- [ ] Level-adaptive voice: beginner = plain English and basics (hanging pieces, checks/captures/threats);
      club = opening gaps, endgames, time use; advanced = engine lines and theory. Default to the simplest tier when unsure.
- [ ] Fast first answer: cloud eval + cached positions first, deeper engine pass as a follow-up; no fixed-depth waits on the critical path.
- [ ] Stateless: works from the username alone, no `refresh_games` or Postgres required (depends on H1 stateless mode).
- [ ] Routing description written for natural phrasings ("how can I improve", "why do I keep losing", "what should I work on").
- [ ] Evaluation: run it on real accounts across rating bands and check that its leaks match what stronger players or the games themselves show; keep notes in `docs/`.

### H2 — Protect and scale _(compute is the only real cost)_
- [ ] Shared eval cache (Redis; was deferred as #12) keyed by FEN + depth + multiPV; cache hits never touch the engine
- [ ] Engine job queue with a global concurrency cap; engine workers separate from the API service
- [ ] Per-IP token-bucket rate limits and per-request cost caps (max PGN size, max plies, max depth)
- [ ] Graceful degradation: lower depth under load instead of failing
- [ ] Upstream protection: request coalescing and backoff for Chess.com / Lichess, shared `LICHESS_TOKEN`
- [ ] Input hardening: validate FENs; allow only chess.com / lichess.org hosts for URL inputs (SSRF guard); treat usernames and PGN comments in output as untrusted text
- [ ] Metrics + alerts: cache hit rate, queue depth, engine-seconds per day, upstream 429s, monthly spend cap

### H3 — Directory submission
- [ ] Rewrite tool names and descriptions for automatic routing ("use when the user shares a game link, PGN, FEN, or asks about their rating, openings, or an opponent")
- [ ] Accept forgiving inputs everywhere (bare username, URL, PGN, FEN; fall back to latest game)
- [ ] Server-level `instructions` string telling Claude when and how to chain tools
- [ ] Privacy policy, documentation URL, support contact, icon
- [ ] Test every tool as a custom connector in Claude, then submit through the developer portal
- [ ] Optional: small skill/plugin that tells Claude when to reach for ChessContext

### H4 — Launch and distribution
- [ ] 30-60 s demo video of a real game review (replace illustrative README examples with real output)
- [ ] Seed 5-10 real users before public launch; fix what breaks
- [ ] Announce: r/chess, r/chessbeginners, Lichess + Chess.com forums, Show HN, MCP lists
- [ ] Pick one sharp positioning claim (e.g. "find why you lose from your own games") and lead with it

### H5 — Deferred
- [ ] Accounts, credits and billing: deferred; no decision until the legal/administrative questions around charging are settled

Housekeeping: remove the personal local path from the Claude Desktop example in `CLAUDE.md`.

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

### v0.6 — Post-Game Intelligence ✅ _(7 tools total)_
3 new tools. All output adapts explanation depth to detected player level
(beginner / club player / advanced).

- [x] `review_game` — one-click post-game debrief: accuracy by phase, key turning point,
      what to study next. Beginners get plain English; club players get engine lines.
      → [#13](https://github.com/rutvij26/chess-context/issues/13)
- [x] `get_mistake_patterns` — scan last N games for recurring mistake types:
      "you consistently blunder when castling queenside under time pressure".
      Uses Chess.com / Lichess game history. Free, no API keys required.
      → [#14](https://github.com/rutvij26/chess-context/issues/14)
- [x] `get_style_fingerprint` — characterize a player across 5 dimensions:
      aggression, positional sense, tactical sharpness, endgame skill, time management.
      Derived from last 50 rated games. Works on both platforms.
      → [#15](https://github.com/rutvij26/chess-context/issues/15)

### v0.7 — Opening & Training ✅ _(10 tools total)_
3 new tools — reaches 10 total registered MCP tools.

- [x] `get_opening_theory` — opening narrative for any position: name, key ideas, main
      continuations, historical context. Uses Lichess Opening Explorer (free).
      Explanation adapts to player level.
      → [#16](https://github.com/rutvij26/chess-context/issues/16)
- [x] `find_opening_gaps` — analyze a player's repertoire and surface positions they haven't
      studied where opponents commonly deviate and win.
      "Your Italian Game collapses after 5.d3 Nc6 6.c3 — 7 losses from this position."
      → [#17](https://github.com/rutvij26/chess-context/issues/17)
- [x] `generate_puzzles` — extract tactical puzzles from a player's own games: positions
      where they missed a tactic or blundered. Returns FEN + solution + difficulty estimate.
      Free, offline-capable once game data is fetched.
      → [#18](https://github.com/rutvij26/chess-context/issues/18)

### v1.0 — ELO Climber _(public release, rich artifact output)_
Theme: every tool asks "how does this help me climb?". Targets public release with clean onboarding.
All position-returning tools include a `boardData` artifact payload for interactive SVG board rendering.

#### Fix first
- [ ] **BUG** `analyze_game` eval POV not normalized → [#85](https://github.com/rutvij26/chess-context/issues/85)

#### New tools
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
- [x] `explain_move` — given any game (PGN / chess.com URL / lichess URL / username) + move
      number, explain why the move was played, what the best alternative was, and what to
      remember → [#87](https://github.com/rutvij26/chess-context/issues/87)
- [ ] `get_improvement_tracker` — week-over-week accuracy, blunder rate trend, ELO trajectory
      with plain-English narrative → [#92](https://github.com/rutvij26/chess-context/issues/92)
- [ ] `get_coach` — context-aware improvement advisor with `frequency: daily | weekly | monthly`.
      Pre-game advisor + post-session debrief + structured study plan, all in one tool.
      → [#88](https://github.com/rutvij26/chess-context/issues/88)
- [ ] `reanalyze_games` — bulk re-run Stockfish analysis on stored games; useful after engine
      upgrades or to fill coverage gaps → [#89](https://github.com/rutvij26/chess-context/issues/89)

#### Infrastructure
- [ ] `refresh_games` bulk sync — date-range params, incremental mode, 200+ game support,
      fix `fetchGameByUrl` 50-game cap → [#90](https://github.com/rutvij26/chess-context/issues/90)
- [ ] Board artifact standard — all position tools return `boardData` (FENs, arrows, classifications,
      annotations) so Claude renders self-contained interactive SVG board artifacts → [#91](https://github.com/rutvij26/chess-context/issues/91)

### v2.0 — Advanced / Self-Hosting
- [ ] Docker Compose deployment with native Stockfish + Leela Chess Zero → [#25](https://github.com/rutvij26/chess-context/issues/25)
- [ ] Multi-engine disagreement reports (Stockfish vs Leela on the same position) → [#26](https://github.com/rutvij26/chess-context/issues/26)
- [ ] Semantic position search (embedding-based similarity across game databases) → [#27](https://github.com/rutvij26/chess-context/issues/27)
- [ ] Opening novelty database (track where every game left theory, across all your games) → [#28](https://github.com/rutvij26/chess-context/issues/28)
- [ ] Generative position lab (create targeted training positions on demand) → [#29](https://github.com/rutvij26/chess-context/issues/29)
- [ ] Play style matchmaking (find grandmaster games that match your style) → [#30](https://github.com/rutvij26/chess-context/issues/30)
