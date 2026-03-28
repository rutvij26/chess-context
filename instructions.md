# ChessContext MCP — Project Instructions & Reference

> **Philosophy:** Chess as a context problem, not a computation problem.
> The MCP provides chess _meaning_; Claude provides the _reasoning_.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Docker Setup](#docker-setup)
5. [MCP Tools Specification](#mcp-tools-specification)
6. [Feature Dimensions](#feature-dimensions)
7. [Implementation Plan](#implementation-plan)
8. [Data Sources & APIs](#data-sources--apis)
9. [Position Classification System](#position-classification-system)
10. [Multi-Engine Synthesis](#multi-engine-synthesis)
11. [Player Profiling System](#player-profiling-system)
12. [Agentic Workflows](#agentic-workflows)
13. [Cost & Licensing](#cost--licensing)
14. [Competitive Differentiation](#competitive-differentiation)
15. [Future Roadmap](#future-roadmap)

---

## Project Overview

**ChessContext** is an intelligence-first Chess MCP (Model Context Protocol server) designed for Claude. Unlike existing chess MCPs that are simple API wrappers around Stockfish, ChessContext treats chess as a rich context domain — synthesizing engine analysis, game databases, player psychology, positional themes, and strategic narratives into structured data that enables Claude to reason about chess in ways no traditional software can.

### What Makes This Different

| Existing Chess MCPs       | ChessContext                                              |
| ------------------------- | --------------------------------------------------------- |
| Single engine (Stockfish) | Multi-engine synthesis (Stockfish + Leela + Tablebases)   |
| Raw FEN/eval numbers      | Semantic position context (themes, difficulty, narrative) |
| Basic move suggestion     | Structured strategic guidance with explanations           |
| Static analysis           | Agentic workflows (auto-review, prep, training)           |
| No player awareness       | Player profiling, opponent scouting, weakness detection   |
| Tool-first                | Intelligence-first                                        |

### Core Principle

The MCP doesn't try to be smart — it provides _structured context_ so Claude can be smart about chess. Every tool returns rich, semantic data that Claude can synthesize into natural language coaching, analysis, and strategic advice.

---

## Architecture

### Three-Layer Design

```
┌─────────────────────────────────────────────────┐
│              LAYER 3: AGENTIC                   │
│  Game Analyzer · Preparation Engine             │
│  Training Pipeline · Repertoire Manager         │
│  Session Stats · Tournament Prep                │
├─────────────────────────────────────────────────┤
│           LAYER 2: INTELLIGENCE                 │
│  Position Classifier · Multi-Engine Synthesizer │
│  Database Contextualizer · Player Profiler      │
│  Theme Tagger · Difficulty Index                │
├─────────────────────────────────────────────────┤
│            LAYER 1: FOUNDATION                  │
│  Stockfish · Leela Chess Zero · Syzygy TB       │
│  Chess.com API · Lichess API · PostgreSQL       │
│  Position Cache · Game Database                 │
└─────────────────────────────────────────────────┘
```

**Layer 1 (Foundation):** Raw compute and data. Engines, databases, APIs, storage.

**Layer 2 (Intelligence):** Meaning-making. Transforms raw engine output and database queries into structured semantic context. This is where FEN becomes "a closed Benoni structure with minority attack potential."

**Layer 3 (Agentic):** Orchestrated workflows. Multi-step processes that combine Layer 1 and 2 to deliver complete analysis, preparation packages, and training plans.

---

## Tech Stack

### Core Components (All Free / Open Source)

| Component        | Technology                              | License     | Notes                            |
| ---------------- | --------------------------------------- | ----------- | -------------------------------- |
| MCP Server       | Node.js (TypeScript) or Python          | -           | MCP protocol implementation      |
| Chess Engine 1   | Stockfish 17                            | GPL         | CPU-based, tactical depth        |
| Chess Engine 2   | Leela Chess Zero                        | GPL         | GPU/CPU, strategic nuance        |
| Endgame Tables   | Syzygy 5-piece (start), 6-piece (later) | Free        | ~1GB / ~150GB                    |
| Database         | PostgreSQL or SQLite                    | Open source | Game storage, position cache     |
| Cache            | Redis (optional)                        | BSD         | Analysis caching                 |
| Chess Logic      | python-chess / chess.js                 | Open source | Move validation, PGN/FEN parsing |
| Containerization | Docker + Docker Compose                 | Free        | Local deployment                 |

### External APIs (Free Tier)

| API       | Rate Limit            | Data Available                                    |
| --------- | --------------------- | ------------------------------------------------- |
| Chess.com | 300 req/min           | Player stats, games, profiles                     |
| Lichess   | Generous (with token) | Player stats, games, puzzles, broadcasts, open DB |

---

## Docker Setup

### Target docker-compose.yml Structure

```yaml
version: "3.8"

services:
  # MCP Server — the main API
  mcp-server:
    build: ./mcp-server
    ports:
      - "3000:3000"
    depends_on:
      - stockfish
      - postgres
    environment:
      - STOCKFISH_HOST=stockfish
      - STOCKFISH_PORT=5000
      - DATABASE_URL=postgresql://chess:chess@postgres:5432/chesscontext
    volumes:
      - ./data/tablebases:/tablebases:ro

  # Stockfish Engine Service
  stockfish:
    build: ./engines/stockfish
    ports:
      - "5000:5000"
    # Expose Stockfish via a simple HTTP/WebSocket API

  # Leela Chess Zero (optional, needs GPU)
  # lc0:
  #   build: ./engines/lc0
  #   ports:
  #     - "5001:5001"
  #   deploy:
  #     resources:
  #       reservations:
  #         devices:
  #           - capabilities: [gpu]

  # Database
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: chess
      POSTGRES_PASSWORD: chess
      POSTGRES_DB: chesscontext
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  # Cache (optional)
  # redis:
  #   image: redis:7-alpine
  #   ports:
  #     - "6379:6379"

volumes:
  pgdata:
```

### Directory Structure

```
chesscontext/
├── docker-compose.yml
├── mcp-server/
│   ├── Dockerfile
│   ├── package.json / requirements.txt
│   ├── src/
│   │   ├── index.ts              # MCP server entry point
│   │   ├── tools/                # MCP tool definitions
│   │   │   ├── analyze_position.ts
│   │   │   ├── analyze_game.ts
│   │   │   ├── get_player_stats.ts
│   │   │   ├── scout_opponent.ts
│   │   │   ├── get_opening_info.ts
│   │   │   └── review_game.ts
│   │   ├── engines/              # Engine communication layer
│   │   │   ├── stockfish.ts
│   │   │   ├── lc0.ts
│   │   │   └── tablebase.ts
│   │   ├── intelligence/         # Layer 2 — semantic analysis
│   │   │   ├── position_classifier.ts
│   │   │   ├── theme_tagger.ts
│   │   │   ├── difficulty_index.ts
│   │   │   ├── critical_moments.ts
│   │   │   └── engine_synthesizer.ts
│   │   ├── data/                 # Database & API integrations
│   │   │   ├── chesscom_api.ts
│   │   │   ├── lichess_api.ts
│   │   │   ├── game_db.ts
│   │   │   └── position_cache.ts
│   │   └── utils/                # Helpers
│   │       ├── fen_parser.ts
│   │       ├── pgn_parser.ts
│   │       └── chess_constants.ts
│   └── tests/
├── engines/
│   ├── stockfish/
│   │   ├── Dockerfile
│   │   └── server.py            # HTTP wrapper around Stockfish UCI
│   └── lc0/
│       ├── Dockerfile
│       └── server.py
├── data/
│   ├── tablebases/              # Syzygy files (download separately)
│   ├── openings/                # Opening classification data
│   └── pawn_structures/         # Pawn structure lookup tables
├── scripts/
│   ├── download_tablebases.sh
│   ├── download_stockfish.sh
│   ├── import_lichess_db.sh
│   └── setup.sh
└── README.md
```

---

## MCP Tools Specification

### MVP Tools (Weeks 1-4)

#### 1. `analyze_position`

Analyze a chess position from FEN.

**Input:**

```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "depth": 25,
  "num_lines": 3
}
```

**Output (semantic, not raw):**

```json
{
  "evaluation": {
    "score_cp": 35,
    "score_text": "Slight advantage for White",
    "confidence": "high",
    "eval_depth": 25
  },
  "best_moves": [
    {
      "move": "c5",
      "move_san": "c5",
      "eval_cp": 30,
      "line": ["c5", "Nf3", "d6", "d4"],
      "explanation_hint": "Sicilian Defense — fights for center control asymmetrically"
    },
    {
      "move": "e5",
      "move_san": "e5",
      "eval_cp": 35,
      "line": ["e5", "Nf3", "Nc6", "Bb5"],
      "explanation_hint": "Symmetrical center — leads to open game (Ruy Lopez, Italian, Scotch)"
    }
  ],
  "position_context": {
    "phase": "opening",
    "move_number": 1,
    "position_type": "open",
    "pawn_structure": "e4_vs_none",
    "themes": ["center_control", "development", "king_safety_neutral"],
    "complexity": "low",
    "tactical_tension": "none",
    "human_difficulty": 2,
    "narrative": "Standard position after 1.e4. Black must choose how to contest the center. The main philosophical divide: 1...e5 (symmetrical, classical) vs 1...c5 (asymmetrical, Sicilian) vs 1...e6/c6 (solid, French/Caro-Kann)."
  }
}
```

#### 2. `analyze_game`

Analyze an entire game from PGN or game URL.

**Input:**

```json
{
  "pgn": "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 ...",
  // OR
  "game_url": "https://www.chess.com/game/live/123456789",
  // OR
  "lichess_id": "abcdefgh",
  "depth": 20
}
```

**Output:**

```json
{
  "game_info": {
    "white": "player1",
    "black": "player2",
    "result": "1-0",
    "opening": "Ruy Lopez, Morphy Defense",
    "time_control": "5+3",
    "date": "2025-03-28"
  },
  "summary": {
    "total_moves": 42,
    "white_accuracy": 82.5,
    "black_accuracy": 74.3,
    "phase_breakdown": {
      "opening": {
        "moves": "1-12",
        "assessment": "Equal, well-played by both"
      },
      "middlegame": {
        "moves": "13-30",
        "assessment": "White gained advantage through superior piece activity"
      },
      "endgame": { "moves": "31-42", "assessment": "White converted cleanly" }
    }
  },
  "critical_moments": [
    {
      "move_number": 15,
      "played": "Bg5",
      "best": "d5",
      "eval_loss_cp": 120,
      "category": "strategic_misjudgment",
      "explanation_hint": "Central break d5 was thematic here — opens the position for White's better-developed pieces. Bg5 is a natural move but doesn't address the key question of the position."
    }
  ],
  "mistake_categories": {
    "tactical": 1,
    "strategic": 2,
    "time_pressure": 1,
    "opening": 0,
    "endgame": 0
  },
  "patterns_detected": [
    "Missed central pawn break (seen in 3 of last 20 games)",
    "Strong endgame conversion (improving trend)"
  ]
}
```

#### 3. `get_player_stats`

Get comprehensive player statistics.

**Input:**

```json
{
  "username": "player123",
  "platform": "chess.com"
}
```

**Output:**

```json
{
  "profile": {
    "username": "player123",
    "ratings": {
      "bullet": { "current": 1450, "peak": 1520, "games": 2300 },
      "blitz": { "current": 1580, "peak": 1650, "games": 4100 },
      "rapid": { "current": 1620, "peak": 1700, "games": 800 }
    },
    "win_rate": { "overall": 52.3, "as_white": 54.1, "as_black": 50.5 }
  },
  "opening_repertoire": {
    "as_white": [
      { "opening": "e4", "frequency": 72, "win_rate": 55 },
      { "opening": "d4", "frequency": 28, "win_rate": 48 }
    ],
    "as_black_vs_e4": [
      { "opening": "Sicilian", "frequency": 45, "win_rate": 51 },
      { "opening": "French", "frequency": 30, "win_rate": 49 }
    ],
    "as_black_vs_d4": [
      { "opening": "King's Indian", "frequency": 55, "win_rate": 47 },
      { "opening": "Queen's Gambit Declined", "frequency": 35, "win_rate": 52 }
    ]
  },
  "recent_form": {
    "last_20_games": {
      "wins": 11,
      "draws": 2,
      "losses": 7,
      "avg_accuracy": 76.2
    },
    "trend": "stable"
  }
}
```

#### 4. `scout_opponent`

Generate a scouting report for an upcoming opponent.

**Input:**

```json
{
  "opponent_username": "rival456",
  "platform": "chess.com",
  "your_color": "white"
}
```

**Output:**

```json
{
  "opponent_profile": {
    /* same as get_player_stats */
  },
  "expected_openings": {
    "most_likely": "Sicilian Najdorf (45%)",
    "second": "French Defense (25%)",
    "surprise": "Caro-Kann (10%, but increasing recently)"
  },
  "strengths": [
    "Tactical accuracy in complex middlegames (85th percentile for rating)",
    "Strong time management in blitz"
  ],
  "weaknesses": [
    "Endgame conversion below rating level (42nd percentile)",
    "Struggles against positional play (lower win rate vs d4 players)",
    "Accuracy drops significantly after move 30"
  ],
  "strategic_recommendation": "Steer toward simplified positions and endgames. Your opponent's tactical strength is dangerous in complex middlegames, but their endgame technique is exploitable. Consider a solid opening that avoids early tactical complications.",
  "opening_suggestion": "Against their likely Sicilian: consider the Rossolimo (3.Bb5) — avoids the sharp Najdorf lines they prefer and leads to strategic positions."
}
```

### V1.0 Tools (Weeks 5-12)

#### 5. `multi_engine_analysis`

Run position through multiple engines and synthesize.

#### 6. `get_opening_theory`

Retrieve opening theory with trends and narrative context.

#### 7. `find_similar_positions`

Semantic position search across the database.

#### 8. `generate_training_positions`

Create targeted practice positions based on weaknesses.

#### 9. `get_endgame_analysis`

Tablebase lookup with human-readable winning plan.

#### 10. `build_preparation`

Full tournament/match preparation pipeline.

---

## Feature Dimensions

### Dimension A: Semantic Intelligence Layers

**Goal:** Every position returns MEANING, not just numbers.

**Key components:**

- **Position Narrative:** Natural language description of what's happening
- **Pawn Structure Classifier:** Map to ~30 canonical types (Carlsbad, Isolani, Hedgehog, etc.)
- **Theme Tagger:** Detect active strategic/tactical themes
- **Difficulty Index:** Rate human difficulty vs engine difficulty
- **Critical Moment Detection:** Find where games pivot
- **Evaluation Confidence:** How stable is the engine's assessment?

**Implementation priority:** Position narrative + theme tagger (MVP), difficulty index (V1.0), the rest progressive.

### Dimension B: Multi-Engine Synthesis

**Goal:** Combine Stockfish (tactical) + Leela (strategic) + Tablebases (endgame) into unified insight.

**Key components:**

- **Engine Disagreement Report:** When engines disagree, that IS the insight
- **Engine-Appropriate Routing:** Best engine for each position type
- **Consensus Confidence Score:** 0 (total disagreement) to 1 (full consensus)
- **Depth-Adjusted Eval Timeline:** How eval changes with depth (reveals hidden tactics)
- **Style-Based Analysis:** "Analyze like Tal" vs "Analyze like Karpov"

**Implementation priority:** Basic multi-engine (V1.0), disagreement report (V1.0), style-based (V2+).

### Dimension C: Contextual Databases

**Goal:** Not "here are 100,000 games" but "here's what matters about this position's history."

**Key components:**

- **Opening Trend Analysis:** How lines evolve over time by rating band
- **Semantic Game Search:** Find games by pattern, not just moves
- **Opening Narrative Generator:** History + ideas + current theory as a story
- **Endgame Oracle with Explanation:** Tablebase result + human-understandable plan
- **Novelty Detector:** Where does a game leave known theory?
- **Cross-Platform Aggregation:** Unified player data from Chess.com + Lichess + FIDE

### Dimension D: Player Psychology & Profiling

**Goal:** Understand the human behind the rating.

**Key components:**

- **Play Style Fingerprint:** Multi-dimensional profile (aggression, positional, tactical, endgame, etc.)
- **Opponent Scouting Report:** Comprehensive pre-game intelligence
- **Tilt Detection:** Identify when a player is tilting from recent game patterns
- **Weakness-Targeted Training:** Generate positions targeting specific weaknesses
- **Comparative Analysis:** "Your play vs GM in this position type"
- **Move Prediction:** Estimate opponent's likely moves based on history

### Dimension E: Agentic Workflows

**Goal:** Multi-step automated processes, not single queries.

**Key components:**

- **One-Click Post-Game Review:** Fetch → Analyze → Tag → Report (flagship feature)
- **Adaptive Training Plan:** Personalized weekly study schedule
- **Opening Repertoire Manager:** Living document with theory monitoring
- **Tournament Preparation Pipeline:** Opponent list → complete prep package
- **Spaced Repetition Trainer:** Positions with SRS scheduling
- **Game Collection Curator:** Instructive games selected for learning value

### Dimension F: Real-Time Game Integration

**Goal:** Participate in the game lifecycle, not just analyze after.

**Key components:**

- **Pre-Game Preparation Packet:** Auto-generate before a match
- **Post-Game Instant Debrief:** Immediate key takeaways
- **Session Statistics Dashboard:** Aggregate multi-game stats
- **Live Training Mode:** Real-time commentary during practice games (ethical, unrated only)

### Dimension G: Moonshot Features (V2+)

- Pattern memory across games (long-term recurring mistake detection)
- Generative position lab (create training positions on demand)
- "Ghost Game" simulator (simulate historical matchups)
- Opening innovation detector (flag new theory from live events)
- Explanatory engine (structured "why" for every move recommendation)

---

## Implementation Plan

### MVP — Weeks 1-4

**Week 1: Foundation**

- [ ] Set up Docker Compose (Stockfish + MCP server + PostgreSQL)
- [ ] Implement Stockfish UCI wrapper (HTTP API over the engine)
- [ ] Basic MCP protocol server (stdio transport)
- [ ] `analyze_position` tool — FEN in, eval + top moves out

**Week 2: Game Analysis**

- [ ] PGN parser integration
- [ ] `analyze_game` tool — full game analysis, move by move
- [ ] Chess.com game URL fetching (API integration)
- [ ] Lichess game fetching
- [ ] Basic critical moment detection (eval delta threshold)

**Week 3: Intelligence Layer**

- [ ] Pawn structure classifier (rule-based, ~30 structures)
- [ ] Position theme tagger (isolated pawns, passed pawns, open files, castling, piece activity)
- [ ] Position phase detector (opening / middlegame / endgame)
- [ ] Wrap all engine output in semantic context objects
- [ ] Position narrative generator (template-based to start)

**Week 4: Player Integration**

- [ ] Chess.com API integration (player stats, game history, opening stats)
- [ ] Lichess API integration
- [ ] `get_player_stats` tool
- [ ] Basic opponent scouting (`scout_opponent` tool)
- [ ] Post-game review workflow (`review_game` — combines analyze_game + player context)

### V1.0 — Weeks 5-12

**Weeks 5-6: Multi-Engine**

- [ ] Leela Chess Zero Docker container (GPU or CPU fallback)
- [ ] Multi-engine analysis pipeline
- [ ] Engine disagreement detection and reporting
- [ ] Consensus confidence scoring
- [ ] Engine routing based on position type

**Weeks 7-8: Advanced Intelligence**

- [ ] Position difficulty index (correlate engine eval with human accuracy)
- [ ] Enhanced theme tagger (50+ themes)
- [ ] Novelty detector (compare game moves against opening database)
- [ ] Opening trend analysis
- [ ] Syzygy tablebase integration with explanation layer

**Weeks 9-10: Player Profiling**

- [ ] Play style fingerprint (analyze 50+ games for multi-dimensional profile)
- [ ] Weakness detection system
- [ ] Tilt detection from recent game patterns
- [ ] Comparative analysis ("your move vs GM moves in this structure")

**Weeks 11-12: Agentic Workflows**

- [ ] One-click full post-game review (flagship workflow)
- [ ] Tournament preparation pipeline
- [ ] Basic training position generator
- [ ] Session statistics aggregator
- [ ] Opening repertoire summary

---

## Data Sources & APIs

### Chess.com API

- **Base URL:** `https://api.chess.com/pub/`
- **Rate limit:** 300 requests/minute
- **Key endpoints:**
  - `/player/{username}` — profile
  - `/player/{username}/stats` — ratings
  - `/player/{username}/games/{YYYY}/{MM}` — monthly game archives
  - `/player/{username}/games/archives` — list of all archive months
- **Auth:** None required
- **Notes:** Games returned in PGN format. No position search.

### Lichess API

- **Base URL:** `https://lichess.org/api/`
- **Rate limit:** 15 req/s (unauthenticated), more with token
- **Key endpoints:**
  - `/api/user/{username}` — profile
  - `/api/user/{username}/perf/{perfType}` — rating history
  - `/api/games/user/{username}` — export games (PGN/JSON, streaming)
  - `/api/cloud-eval` — cloud evaluation (free!)
  - `/api/tablebase/standard?fen=...` — Syzygy tablebase lookup (free!)
- **Auth:** OAuth2 token for higher rate limits
- **Notes:** Lichess cloud eval and tablebase APIs are huge — free engine analysis and endgame lookups without running your own engines.

### Lichess Open Database

- **URL:** `https://database.lichess.org/`
- **Format:** PGN, compressed (zstd)
- **Size:** ~100GB+ per month of games
- **Use:** Download and import for local position/opening statistics

### Syzygy Tablebases

- **5-piece:** ~1GB — download from `https://tablebase.lichess.ovh/tables/standard/`
- **6-piece:** ~150GB
- **7-piece:** ~140TB (impractical for local, use API)
- **API alternative:** Lichess tablebase API (free, no local storage needed)

---

## Position Classification System

### Pawn Structure Types (~30 canonical)

```
SYMMETRIC:
  - open_symmetric        (no center pawns)
  - closed_center         (locked e4/d5 or d4/e5 pawns)

KING_PAWN:
  - sicilian_e4_d6        (e4 vs d6 — Sicilian structures)
  - french_e4_d5_e5       (e4/e5 chain vs d5 — French)
  - caro_kann_e4_d5       (e4 vs d5 exchange — Caro-Kann)
  - advance_french        (e5 chain — space advantage)
  - open_italian          (e4 vs e5, d4 break made)

QUEEN_PAWN:
  - carlsbad              (d4/e3 vs d5/e6 — classic QGD)
  - isolani_white         (White IQP on d4)
  - isolani_black         (Black IQP on d5)
  - hanging_pawns         (c4+d4 or c5+d5 without support)
  - stonewall             (e3/f4/d4 — Dutch/London)
  - benoni                (d5 vs e5 — Modern Benoni)
  - kings_indian          (d4+c4 vs d6+e5 — KID)
  - grunfeld              (d4+c4 vs d5 exchange)
  - catalan               (d4+c4+g3 structures)
  - queens_gambit_accepted (d4 vs open c-file)
  - slav                  (d4+c4 vs d5+c6)

FLANK:
  - english               (c4 based, no d4)
  - hedgehog              (a6/b6/d6/e6 — compact Black setup)
  - maroczy_bind          (c4+e4 — space bind)

SPECIAL:
  - doubled_pawns         (structural weakness present)
  - opposite_wings        (opposite side pawn storms)
  - passed_pawn_race      (both sides have passers)
  - pure_piece_play       (minimal pawn structure — endgame)
```

### Position Themes (50+ tactical/strategic)

```
TACTICAL:
  - fork_threat, pin, skewer, discovered_attack, double_attack
  - back_rank_weakness, overloaded_piece, deflection
  - sacrifice_opportunity, zwischenzug, trapped_piece

STRATEGIC:
  - minority_attack, pawn_break_available, weak_squares
  - outpost, good_bishop_vs_bad_bishop, bishop_pair
  - rook_on_open_file, rook_on_7th_rank, centralized_knight
  - space_advantage, piece_activity_imbalance

STRUCTURAL:
  - isolated_pawn, backward_pawn, doubled_pawns
  - passed_pawn, connected_passed_pawns, outside_passed_pawn
  - pawn_chain, pawn_majority, pawn_island_count

KING_SAFETY:
  - castled_kingside, castled_queenside, uncastled_king
  - exposed_king, fianchetto_intact, fianchetto_broken
  - pawn_storm_threat, h_file_attack, greek_gift_potential

POSITIONAL:
  - prophylaxis_needed, transition_moment, simplification_favorable
  - opposite_colored_bishops, same_colored_bishops
  - knight_vs_bishop_favorable, exchange_sacrifice_theme
```

---

## Multi-Engine Synthesis

### Engine Characteristics

| Engine           | Strength                                  | Best For                                  | Weakness                            |
| ---------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------- |
| Stockfish        | Raw calculation, tactics                  | Sharp positions, forced lines, exact eval | Can miss long-term strategic nuance |
| Leela Chess Zero | Positional understanding, long-term plans | Quiet positions, strategic decisions      | Slower, can miss sharp tactics      |
| Syzygy TB        | Perfect endgame play                      | Positions with ≤5/6/7 pieces              | Only works for simplified positions |

### Synthesis Logic

```
IF position has ≤ 6 pieces:
  → Tablebase lookup (definitive answer)
ELIF position is tactically sharp (multiple captures/checks available):
  → Prioritize Stockfish (deep tactical calculation)
ELIF position is quiet/strategic (no immediate tactics):
  → Prioritize Leela (positional evaluation)
ELSE:
  → Run both, compare:
    IF they agree: high confidence, report consensus
    IF they disagree: FLAG as interesting — report both perspectives
```

### Disagreement Classification

When engines disagree on the best move, classify the disagreement:

- **Tactical vs Strategic:** One sees a tactic, the other prefers quiet play
- **Short-term vs Long-term:** Different time horizons
- **Risk assessment:** One sees compensation for sacrifice, the other doesn't
- **Horizon effect:** One engine hasn't searched deep enough

---

## Player Profiling System

### Style Fingerprint Dimensions

```
AGGRESSION:      0-100 (sacrifice frequency, pawn storm frequency, king attacks)
POSITIONAL:      0-100 (piece maneuvering, prophylaxis, slow plans)
TACTICAL_ACUITY: 0-100 (accuracy in sharp positions vs quiet ones)
ENDGAME:         0-100 (conversion rate, accuracy in endgames)
OPENING_DEPTH:   0-100 (how long they stay in theory, diversity of repertoire)
TIME_MANAGEMENT: 0-100 (time usage patterns, accuracy under pressure)
RESILIENCE:      0-100 (performance from worse positions, comeback rate)
CONSISTENCY:     0-100 (variance in performance across games)
```

### Calculation Methods

- **Aggression:** Count sacrifices (material given up without immediate recovery) per game, normalize by rating band
- **Tactical Acuity:** Compare accuracy in positions classified as "tactical" vs "strategic"
- **Endgame:** Win rate from positions where user had advantage going into endgame
- **Time Management:** Correlation between remaining time and move accuracy
- **Resilience:** Win/draw rate from positions evaluated as -1.0 or worse

---

## Agentic Workflows

### Flagship: One-Click Post-Game Review

```
User: "Review my last game on chess.com"

Step 1: Fetch game from Chess.com API (game_url or latest game)
Step 2: Parse PGN, extract moves and metadata
Step 3: Run each position through analysis pipeline:
  - Engine evaluation (Stockfish, optionally Leela)
  - Position classification (phase, structure, themes)
  - Accuracy calculation per move
Step 4: Identify critical moments (eval swings > 50cp)
Step 5: Classify mistakes (tactical/strategic/time/opening/endgame)
Step 6: Cross-reference with player profile (recurring patterns)
Step 7: Generate structured review object
Step 8: Return to Claude for narrative synthesis
```

### Tournament Preparation Pipeline

```
User: "Prepare me for a tournament. My opponents are X, Y, Z."

For each opponent:
  Step 1: Fetch their game history
  Step 2: Generate play style fingerprint
  Step 3: Identify their opening repertoire
  Step 4: Find weaknesses
  Step 5: Recommend opening choices
  Step 6: Curate positions to study

Synthesize into preparation package.
```

---

## Cost & Licensing

### Everything is Free for Local Use

| Component         | License            | Cost |
| ----------------- | ------------------ | ---- |
| Stockfish         | GPL                | $0   |
| Leela Chess Zero  | GPL                | $0   |
| Syzygy Tablebases | Free               | $0   |
| Lichess Data      | CC-BY-SA           | $0   |
| Chess.com API     | Free tier          | $0   |
| PostgreSQL        | PostgreSQL License | $0   |
| Docker            | Apache 2.0         | $0   |

### GPL Implications

- If you distribute the MCP with Stockfish/Leela embedded, the distribution must be GPL
- If you run them as separate services (Docker containers) and communicate via API, this is generally considered acceptable for non-GPL server code
- Safest approach: keep engines as separate Docker containers, communicate via HTTP

### If You Ever Go Cloud

- Stockfish compute: ~$150-300/month per instance
- Leela GPU: ~$400-800/month per GPU
- Database: ~$200-500/month
- Total for small deployment: ~$1,000-2,000/month
- Cross that bridge when you get there

---

## Competitive Differentiation

### vs "Stockfish + Plugin" MCPs

They give numbers. We give understanding. Their output: "best move: Nf3 (+0.4)." Our output: rich semantic context about WHY, connected to the player's level, the position type, the opponent, and historical precedent.

### vs Professional Chess Software (ChessBase, etc.)

ChessBase is powerful but siloed — separate workflows for analysis, openings, databases. ChessContext integrates everything into unified, contextual responses. More importantly, it's conversational — "Why did I lose?" gets an answer that previously required hours of manual analysis.

### vs Human Chess Coaches

A coach sees one game at a time. ChessContext sees ALL your games, detects patterns across thousands of positions, and never forgets. It can't replace the human relationship, but it can provide superhuman pattern recognition and 24/7 availability.

### Why This Only Works with LLMs

The killer capability is SYNTHESIS. No traditional tool can combine engine analysis + database stats + player psychology + positional themes into a coherent narrative. Each source is useful alone; the combination creates emergent insights. Only an LLM can produce: "You lost because you entered a position type that's theoretically fine but practically difficult at your level, against an opponent whose style exploits exactly the kind of complexity that arose."

---

## Future Roadmap

### V2.0 — Advanced Intelligence

- Semantic game search (position similarity vectors)
- Generative position lab
- Pattern memory across game history
- Opening innovation detector
- Fully explanatory engine ("why" for every move)

### V3.0 — Platform

- Web UI dashboard (game review, training, prep)
- Mobile companion app
- Multi-user support (chess clubs, teams)
- Integration with OTB tournament software
- Real-time event coverage analysis

### Moonshots

- Train custom neural network on user's games
- "Ghost Game" simulator (historical player matchups)
- Collaborative analysis (multiple users + Claude)
- Chess960 / variants support
- Integration with physical chess boards (DGT)

---

_Last updated: March 28, 2026_
_Version: 0.1 (Pre-MVP)_
