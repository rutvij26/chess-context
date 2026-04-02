# Tool Reference

Full input/output schemas for all ChessContext MCP tools.

---

## `analyze_position`

Analyze a chess position from a FEN string.

### Input

```typescript
{
  fen: string           // Required. FEN string of the position.
  depth?: number        // Optional. Search depth 1-30. Default: 18.
  num_lines?: number    // Optional. Top moves to return 1-5. Default: 3.
}
```

### Output

```json
{
  "evaluation": {
    "score_cp": 80,
    "score_mate": null,
    "score_text": "Slight advantage for White",
    "depth": 18
  },
  "best_moves": [
    {
      "move_uci": "e2e4",
      "move_san": "e4",
      "eval_cp": 30,
      "eval_mate": null,
      "continuation": ["e5", "Nf3", "Nc6"],
      "explanation": "A developing/positional move improving piece placement. Expected continuation: e5 Nf3 Nc6"
    },
    {
      "move_uci": "d2d4",
      "move_san": "d4",
      "eval_cp": 28,
      "eval_mate": null,
      "continuation": ["d5", "c4", "e6"],
      "explanation": "A developing/positional move improving piece placement. Expected continuation: d5 c4 e6"
    }
  ],
  "position_context": {
    "phase": "opening",
    "move_number": 1,
    "pawn_structures": ["symmetrical"],
    "themes": ["piece_activity", "space_advantage"],
    "material_balance": 0,
    "complexity": "low",
    "narrative": "The game is in the opening phase, where development and center control are the key priorities. The symmetrical pawn structure means the game is balanced — the player with better piece activity will have the edge. Active, well-coordinated pieces give the better side significant attacking and defensive potential. The position is approximately equal."
  }
}
```

### Example Prompts

- *"Analyze this FEN: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"*
- *"What's the best move in this position? [paste FEN]"*
- *"Analyze the position after 1.e4 e5 2.Nf3 Nc6 3.Bb5"*

---

## `analyze_game`

Analyze an entire chess game. Accepts PGN, a Lichess URL, or a Lichess game ID.

### Input

```typescript
{
  pgn?: string          // PGN string of the game
  game_url?: string     // Lichess game URL (e.g. https://lichess.org/abcd1234)
  lichess_id?: string   // Lichess game ID (8 chars, e.g. "abcd1234")
  depth?: number        // Max analysis depth. Default: 18.
}
// At least one of pgn, game_url, or lichess_id is required.
```

### Output

```json
{
  "game_info": {
    "white": "Magnus",
    "black": "Hikaru",
    "result": "1-0",
    "opening": "Ruy Lopez",
    "time_control": "180+2",
    "date": "2024.03.15",
    "platform": "lichess"
  },
  "summary": {
    "total_moves": 48,
    "white_accuracy": 87,
    "black_accuracy": 71,
    "phase_breakdown": {
      "opening": {
        "moves": "1-12",
        "assessment": "Balanced opening, both sides played solidly"
      },
      "middlegame": {
        "moves": "13-35",
        "assessment": "Middlegame featured the key strategic battle"
      },
      "endgame": {
        "moves": "36-48",
        "assessment": "Endgame phase"
      }
    },
    "mistake_categories": {
      "tactical": 2,
      "strategic": 1,
      "opening": 0,
      "endgame": 0
    }
  },
  "critical_moments": [
    {
      "move_number": 22,
      "color": "black",
      "move_played": "Nd4",
      "best_move": "f5",
      "eval_before_cp": 45,
      "eval_after_cp": -120,
      "eval_drop_cp": 165,
      "category": "mistake",
      "explanation": "Nd4 is a mistake, giving away 1.7 pawns of advantage. f5 was the correct continuation."
    }
  ],
  "patterns_detected": [
    "Opening phase contained 1 significant inaccuracy"
  ]
}
```

### Example Prompts

- *"Review my last Lichess game: https://lichess.org/abcd1234"*
- *"Analyze this game and tell me where I went wrong: [paste PGN]"*
- *"What were the critical moments in lichess game xK2mNpQr?"*

---

## `get_player_stats`

Fetch comprehensive statistics for a Chess.com or Lichess player.

### Input

```typescript
{
  username: string                      // Player username
  platform: "chess.com" | "lichess"    // Which platform to query
}
```

### Output

```json
{
  "username": "hikaru",
  "platform": "chess.com",
  "ratings": {
    "bullet": { "current": 3290, "peak": 3348, "games": 18000 },
    "blitz":  { "current": 3215, "peak": 3271, "games": 45000 },
    "rapid":  { "current": 3065, "peak": 3100, "games": 2300 }
  },
  "win_rate": {
    "overall": 63,
    "as_white": 66,
    "as_black": 60
  },
  "opening_repertoire": {
    "as_white": [
      { "opening": "e4", "frequency": 78, "win_rate": 67, "sample_size": 39 },
      { "opening": "d4", "frequency": 22, "win_rate": 55, "sample_size": 11 }
    ],
    "as_black_vs_e4": [
      { "opening": "e4 c5", "frequency": 55, "win_rate": 62, "sample_size": 27 },
      { "opening": "e4 e5", "frequency": 30, "win_rate": 58, "sample_size": 15 }
    ],
    "as_black_vs_d4": [
      { "opening": "d4 Nf6", "frequency": 70, "win_rate": 60, "sample_size": 14 }
    ]
  },
  "recent_form": {
    "last_n_games": 20,
    "wins": 14,
    "draws": 3,
    "losses": 3,
    "rating_trend": "rising"
  }
}
```

### Example Prompts

- *"Get hikaru's stats on chess.com"*
- *"What openings does DrNykterstein play on Lichess?"*
- *"How is [username]'s recent form on Lichess?"*

---

## `refresh_games`

Fetch and store a player's recent games from Chess.com or Lichess into the local game store, then queue them for engine analysis in the background.

Run this before using `get_mistake_patterns` or `get_style_fingerprint` — those tools read from the stored analyses.

### Input

```typescript
{
  username: string                      // Player username
  platform: "chess.com" | "lichess"    // Which platform to fetch from
  count?: number                        // Games to fetch. Default: 20, max: 50.
}
```

### Output

```json
{
  "username": "notsobrillantmove",
  "platform": "chess.com",
  "fetched": 20,
  "new_games": 5,
  "queued_for_analysis": 5,
  "already_analyzed": 15,
  "status": "processing",
  "note": "Analysis running in the background. Allow ~30–60s per 20 games on first run, near-instant on reruns (eval cache)."
}
```

Returns immediately. Analysis runs in the background via a `setImmediate` queue — the server stays responsive to other MCP calls while Stockfish processes each game.

### Requires

`DATABASE_URL` env var pointing to a running PostgreSQL instance. See [Installation — PostgreSQL setup](#postgresql-game-store-optional).

### Example Prompts

- *"Refresh my Chess.com games: notsobrillantmove"*
- *"Fetch my last 50 Lichess games for rootviz and analyze them"*

---

## `review_game`

Post-game debrief for a specific game. Analyzes accuracy by phase, identifies the key turning point, and provides study recommendations. Output depth adapts to the player's rating.

### Input

```typescript
{
  pgn?: string              // PGN string of the game
  game_url?: string         // Chess.com or Lichess game URL
  lichess_id?: string       // Lichess game ID (8 chars)
  player_username?: string  // Whose perspective to review from
  depth?: number            // Analysis depth. Default: 18.
}
// At least one of pgn, game_url, or lichess_id is required.
```

### Output

```json
{
  "game_info": {
    "white": "notsobrillantmove",
    "black": "opponent",
    "result": "0-1",
    "opening": "Sicilian Defense",
    "platform": "chess.com"
  },
  "player": {
    "username": "notsobrillantmove",
    "color": "white",
    "rating": 1050,
    "level": "club"
  },
  "phase_performance": [
    { "phase": "opening",     "accuracy": 82, "grade": "B", "moves": "1-13",  "note": "Solid development, no early mistakes" },
    { "phase": "middlegame",  "accuracy": 61, "grade": "D", "moves": "14-34", "note": "2 mistakes, 1 blunder — critical phase" },
    { "phase": "endgame",     "accuracy": 78, "grade": "C", "moves": "35-52", "note": "Decent technique but advantage was lost earlier" }
  ],
  "turning_point": {
    "move_number": 22,
    "move_played": "Nd4",
    "best_move": "f5",
    "eval_drop_cp": 280,
    "explanation": "Nd4 handed back the initiative. f5 would have kept the attack alive."
  },
  "overall_accuracy": 72,
  "study_recommendations": [
    "Review the Sicilian middlegame — your piece coordination broke down around move 20.",
    "Practice tactical puzzles focusing on knight maneuvers."
  ],
  "narrative": "A solid opening gave way to middlegame difficulties. The game turned at move 22 with Nd4, after which the advantage gradually transferred to Black."
}
```

Output detail adapts by level: beginners get plain English only; club players (1000–1800) see engine lines for critical moments; advanced players (1800+) get full technical detail.

### Example Prompts

- *"Review my last game from https://www.chess.com/game/live/12345 — I'm notsobrillantmove"*
- *"Give me a post-game debrief for this Lichess game: [URL]"*

---

## `get_mistake_patterns`

Scan a player's stored game analyses and identify recurring mistake patterns — not just "you blundered 5 times" but systematic weaknesses.

### Input

```typescript
{
  username: string                          // Player username
  platform: "chess.com" | "lichess"        // Which platform
  num_games?: number                        // Games to scan. Default: 20, max: 50.
  time_control?: "bullet" | "blitz" | "rapid"  // Optional filter
}
```

### Output

```json
{
  "username": "notsobrillantmove",
  "games_analyzed": 18,
  "games_available": 20,
  "patterns": [
    {
      "pattern_type": "blunder_cluster_time_pressure",
      "frequency": 7,
      "phase": "middlegame",
      "description": "You blundered 11 times across 7 games in moves 30–50, typically when the clock is low. Your accuracy drops significantly under time pressure.",
      "example_game_index": 2,
      "suggested_study": "Practice time management — make faster, simpler moves when low on time. Solve 1-minute tactical puzzles to speed up threat detection."
    },
    {
      "pattern_type": "hanging_pieces",
      "frequency": 5,
      "phase": "middlegame",
      "description": "You left pieces en prise or hanging in 5 games (6 total instances), losing significant material in the middlegame.",
      "suggested_study": "Before every move, do a quick safety check: scan all your pieces and ask 'is each piece defended?'"
    }
  ],
  "overall_summary": "Analyzed 18 games: 14 blunders and 9 mistakes detected. Found 2 recurring patterns — the top priority is \"blunder cluster time pressure\"."
}
```

Detected patterns (v0.6):

| Pattern | Description |
|---------|-------------|
| `blunder_cluster_time_pressure` | Blunders concentrated in moves 30–50 across ≥2 games — proxy for clock trouble |
| `opening_preparation_gap` | Mistakes in the first 15 moves across ≥3 games, grouped by opening ECO |
| `endgame_technique` | Player had eval >+150cp in endgame, game result was draw/loss |
| `hanging_pieces` | eval drop ≥300cp in middlegame (moves 12–30) across ≥2 games |
| `repeated_opening_collapse` | Same ECO leading to eval <-100cp by move 15 in ≥3 games |

### Requires

`DATABASE_URL` + `refresh_games` run first to populate the game store.

### Example Prompts

- *"What mistakes am I repeating? username: notsobrillantmove, chess.com"*
- *"Find my blitz-specific mistake patterns on Lichess"*

---

## `get_style_fingerprint`

Characterize a player's chess style across 5 dimensions derived from stored game analyses.

### Input

```typescript
{
  username: string                      // Player username
  platform: "chess.com" | "lichess"    // Which platform
  num_games?: number                    // Games to analyze. Default: 50.
}
```

### Output

```json
{
  "username": "rootviz",
  "platform": "lichess",
  "games_analyzed": 47,
  "fingerprint": {
    "aggression": 72,
    "positional_sense": 58,
    "tactical_sharpness": 65,
    "endgame_skill": 44,
    "time_management": 61
  },
  "style_label": "Aggressive Tactician",
  "description": "You play aggressively, pushing pawns and seeking tactical complications. Your tactical vision is sharp and you find combinations reliably. Endgame conversion is an area to work on — winning positions sometimes slip away."
}
```

**Dimension scoring:**

| Dimension | Derived from | Range |
|-----------|--------------|-------|
| `aggression` | Pawn advances past rank 5 + piece sacrifice events per game | 0–100 |
| `positional_sense` | Strategic accuracy (inaccuracies/moves in non-tactical positions) | 0–100 |
| `tactical_sharpness` | % of critical moments where best move was found (eval_drop < 30cp) | 0–100 |
| `endgame_skill` | Win conversion rate when entering endgame with >+150cp advantage | 0–100 |
| `time_management` | Avg clock % remaining at move 30 (Lichess only) | 0–100 or `null` |

`time_management` is always `null` for Chess.com players (no clock data in PGN export).

**Style labels:** Aggressive Tactician · Dynamic Imbalance Seeker · Sharp Gambiteer · Solid Positional Player · Reactive Defender · Balanced All-Rounder

### Requires

`DATABASE_URL` + `refresh_games` run first to populate the game store.

### Example Prompts

- *"What's my chess style? rootviz on Lichess"*
- *"Give me a style fingerprint for notsobrillantmove on chess.com"*

---

## `scout_opponent`

Generate a pre-game scouting report with strategic recommendations.

### Input

```typescript
{
  opponent_username: string             // Opponent's username
  platform: "chess.com" | "lichess"    // Which platform
  your_color: "white" | "black"        // The color you will be playing
}
```

### Output

```json
{
  "opponent_profile": { /* same shape as get_player_stats output */ },
  "expected_openings": [
    {
      "opening": "Sicilian Defense",
      "frequency_percent": 45,
      "win_rate": 51,
      "trend": "stable"
    },
    {
      "opening": "French Defense",
      "frequency_percent": 25,
      "win_rate": 47,
      "trend": "stable"
    }
  ],
  "strengths": [
    "Strong results as White (58% win rate)",
    "Currently in good form — 12W/2D/6L in last 20 games"
  ],
  "weaknesses": [
    "Struggles as Black — only 43% win rate",
    "Poor results with French Defense (38% win rate in 8 games)"
  ],
  "strategic_recommendation": "Prepare specifically for their most frequent opening (Sicilian Defense, played 45% of games). Your opponent struggles as Black — play actively and aim for an initiative early.",
  "opening_suggestion": "Your opponent most often plays e4 as White. Prepare your response to this carefully — their win rate is high with it (61%)."
}
```

### Example Prompts

- *"Scout my opponent 'rival456' on chess.com before our match, I'm playing white"*
- *"What should I know about playing against [username] on Lichess? I'll be black"*
- *"Prepare me to face [username] — what openings should I expect?"*

---

## Output Reference

### Type Schema

All types are defined in `mcp-server/src/types/index.ts`. This section documents each output type in prose.

#### `PositionAnalysis` (returned by `analyze_position`)

| Field | Type | Description |
|-------|------|-------------|
| `evaluation.score_cp` | `number \| null` | Centipawn score, positive = white advantage. Null when mate is found. |
| `evaluation.score_mate` | `number \| null` | Mate in N moves. Positive = white is mating. Null when no forced mate. |
| `evaluation.score_text` | `string` | Human-readable summary (e.g. "Slight advantage for White") |
| `evaluation.depth` | `number` | Depth the engine searched to |
| `best_moves[]` | `TopMove[]` | Top N moves ranked by engine score |
| `best_moves[].move_uci` | `string` | Move in UCI notation (e.g. "e2e4") |
| `best_moves[].move_san` | `string` | Move in SAN notation (e.g. "e4") |
| `best_moves[].eval_cp` | `number \| null` | Centipawn eval after this move |
| `best_moves[].eval_mate` | `number \| null` | Mate distance after this move |
| `best_moves[].continuation` | `string[]` | Expected reply sequence in SAN |
| `best_moves[].explanation` | `string` | One-sentence move description |
| `position_context.phase` | `"opening" \| "middlegame" \| "endgame"` | Current game phase |
| `position_context.move_number` | `number` | Full move number |
| `position_context.pawn_structures` | `string[]` | Active pawn structure labels |
| `position_context.themes` | `string[]` | Active strategic/tactical themes |
| `position_context.material_balance` | `number` | Centipawns. Positive = white material lead. |
| `position_context.complexity` | `"low" \| "medium" \| "high"` | Position complexity estimate |
| `position_context.narrative` | `string` | 2–4 sentence human-readable position summary |

#### `GameAnalysis` (returned by `analyze_game`)

| Field | Type | Description |
|-------|------|-------------|
| `game_info.white` | `string` | White player username |
| `game_info.black` | `string` | Black player username |
| `game_info.result` | `string` | Game result: "1-0", "0-1", or "1/2-1/2" |
| `game_info.opening` | `string` | Opening name (ECO lookup) |
| `game_info.time_control` | `string` | Time control string |
| `game_info.date` | `string` | Game date |
| `game_info.platform` | `string` | Source platform |
| `summary.total_moves` | `number` | Total half-moves in the game |
| `summary.white_accuracy` | `number` | White's accuracy (0–100) |
| `summary.black_accuracy` | `number` | Black's accuracy (0–100) |
| `summary.phase_breakdown` | `object` | Move ranges and assessment per phase |
| `summary.mistake_categories.tactical` | `number` | Count of tactical errors |
| `summary.mistake_categories.strategic` | `number` | Count of strategic errors |
| `critical_moments[]` | `CriticalMoment[]` | Significant mistakes and missed wins |
| `critical_moments[].move_number` | `number` | Full move number |
| `critical_moments[].color` | `"white" \| "black"` | Who made the error |
| `critical_moments[].move_played` | `string` | The move played (SAN) |
| `critical_moments[].best_move` | `string` | Engine's best alternative (SAN) |
| `critical_moments[].eval_before_cp` | `number` | Eval before the move (cp) |
| `critical_moments[].eval_after_cp` | `number` | Eval after the move (cp) |
| `critical_moments[].eval_drop_cp` | `number` | How much eval dropped |
| `critical_moments[].category` | `"inaccuracy" \| "mistake" \| "blunder" \| "missed_win"` | Error category |
| `critical_moments[].explanation` | `string` | One-sentence explanation |
| `patterns_detected` | `string[]` | Summary strings for recurring patterns |

#### `PlayerStats` (returned by `get_player_stats`)

| Field | Type | Description |
|-------|------|-------------|
| `username` | `string` | Player username |
| `platform` | `"chess.com" \| "lichess"` | Platform |
| `ratings` | `object` | Per time-control: `{ current, peak, games }` |
| `win_rate.overall` | `number` | Overall win % |
| `win_rate.as_white` | `number` | Win % with white pieces |
| `win_rate.as_black` | `number` | Win % with black pieces |
| `opening_repertoire.as_white` | `OpeningEntry[]` | White opening frequencies |
| `opening_repertoire.as_black_vs_e4` | `OpeningEntry[]` | Black responses to 1.e4 |
| `opening_repertoire.as_black_vs_d4` | `OpeningEntry[]` | Black responses to 1.d4 |
| `recent_form.last_n_games` | `number` | Sample size |
| `recent_form.wins/draws/losses` | `number` | Results breakdown |
| `recent_form.rating_trend` | `"rising" \| "falling" \| "stable"` | Rating direction |

#### `ReviewGameOutput` (returned by `review_game`)

| Field | Type | Description |
|-------|------|-------------|
| `game_info` | `object` | White, black, result, opening, platform |
| `player.username` | `string` | Reviewed player's username |
| `player.color` | `"white" \| "black"` | Player's color |
| `player.rating` | `number \| null` | Player's rating at time of game |
| `player.level` | `"beginner" \| "club" \| "advanced"` | Detected level (beginner <1000, club 1000–1800, advanced >1800) |
| `phase_performance[]` | `PhaseGrade[]` | Per-phase accuracy + letter grade (A–F) |
| `phase_performance[].phase` | `string` | Phase name |
| `phase_performance[].accuracy` | `number` | Accuracy % for that phase |
| `phase_performance[].grade` | `string` | Letter grade (A ≥90, B ≥80, C ≥70, D ≥60, F <60) |
| `phase_performance[].moves` | `string` | Move range (e.g. "14-34") |
| `phase_performance[].note` | `string` | One-sentence phase summary |
| `turning_point` | `object \| null` | Move with largest eval_drop_cp |
| `overall_accuracy` | `number` | Player's overall accuracy (0–100) |
| `study_recommendations` | `string[]` | 1–3 actionable study suggestions |
| `narrative` | `string` | 2–3 sentence plain-language debrief |

#### `GetMistakePatternsOutput` (returned by `get_mistake_patterns`)

| Field | Type | Description |
|-------|------|-------------|
| `username` | `string` | Player username |
| `games_analyzed` | `number` | Games actually scanned |
| `games_available` | `number` | Total analyses in the store |
| `patterns[]` | `MistakePattern[]` | Detected patterns, sorted by frequency |
| `patterns[].pattern_type` | `string` | Pattern identifier (e.g. `"blunder_cluster_time_pressure"`) |
| `patterns[].frequency` | `number` | Number of games where pattern appeared |
| `patterns[].phase` | `"opening" \| "middlegame" \| "endgame"` | Phase the pattern occurs in |
| `patterns[].description` | `string` | Specific description with counts |
| `patterns[].example_game_index` | `number` | Index into stored analyses for an example |
| `patterns[].suggested_study` | `string` | Actionable study recommendation |
| `overall_summary` | `string` | One-sentence summary of findings |

#### `GetStyleFingerprintOutput` (returned by `get_style_fingerprint`)

| Field | Type | Description |
|-------|------|-------------|
| `username` | `string` | Player username |
| `platform` | `"chess.com" \| "lichess"` | Platform |
| `games_analyzed` | `number` | Games used for the fingerprint |
| `fingerprint.aggression` | `number` | 0–100 aggression score |
| `fingerprint.positional_sense` | `number` | 0–100 positional accuracy score |
| `fingerprint.tactical_sharpness` | `number` | 0–100 tactical opportunity conversion rate |
| `fingerprint.endgame_skill` | `number` | 0–100 endgame win conversion rate |
| `fingerprint.time_management` | `number \| null` | 0–100 avg clock % at move 30. Always null for Chess.com. |
| `style_label` | `string` | One of 6 archetypes |
| `description` | `string` | 2–3 sentence style narrative |

#### `RefreshGamesOutput` (returned by `refresh_games`)

| Field | Type | Description |
|-------|------|-------------|
| `username` | `string` | Player username |
| `platform` | `"chess.com" \| "lichess"` | Platform |
| `fetched` | `number` | Games fetched from API |
| `new_games` | `number` | Games inserted (not already in store) |
| `queued_for_analysis` | `number` | New games queued for background analysis |
| `already_analyzed` | `number` | Games that already had analyses (skipped) |
| `status` | `"processing" \| "idle"` | Background pipeline state |
| `note` | `string` | Timing guidance |

#### `ScoutReport` (returned by `scout_opponent`)

| Field | Type | Description |
|-------|------|-------------|
| `opponent_profile` | `PlayerStats` | Full stats (same shape as `get_player_stats`) |
| `expected_openings[]` | `object[]` | Most likely openings vs your color |
| `expected_openings[].opening` | `string` | Opening name |
| `expected_openings[].frequency_percent` | `number` | How often played (%) |
| `expected_openings[].win_rate` | `number` | Opponent's win rate with it |
| `expected_openings[].trend` | `"increasing" \| "decreasing" \| "stable"` | Recent usage trend |
| `strengths` | `string[]` | 2–3 identified strengths |
| `weaknesses` | `string[]` | 2–3 identified weaknesses |
| `strategic_recommendation` | `string` | Tailored pre-game advice |
| `opening_suggestion` | `string` | Opening preparation advice |

---

### Before vs After: Raw Engine Output vs Enriched Context

To illustrate what this server adds, here is what a raw Stockfish output looks like versus the enriched context:

**Raw Stockfish output (what you'd get from the engine directly):**
```json
{
  "depth": 18,
  "score_cp": 42,
  "pv": ["e2e4", "e7e5", "g1f3"]
}
```

**Enriched MCP context (what `analyze_position` returns):**
```json
{
  "evaluation": {
    "score_cp": 42,
    "score_mate": null,
    "score_text": "Approximately equal",
    "depth": 18
  },
  "best_moves": [{
    "move_uci": "e2e4",
    "move_san": "e4",
    "eval_cp": 42,
    "eval_mate": null,
    "continuation": ["e5", "Nf3"],
    "explanation": "Central pawn grab controlling d5 and f5"
  }],
  "position_context": {
    "phase": "opening",
    "move_number": 1,
    "pawn_structures": ["symmetrical"],
    "themes": ["piece_activity", "space_advantage"],
    "material_balance": 0,
    "complexity": "low",
    "narrative": "The game is in the opening phase, where development and center control are key priorities. The symmetrical pawn structure means the game is balanced — the player with better piece activity will have the edge. Active, well-coordinated pieces give the better side significant attacking potential. The position is approximately equal."
  }
}
```

---

### End-to-End Pipeline Walkthrough

Here is the full data flow for an `analyze_game` call:

```
1. Input: PGN string / Lichess URL / game ID
       │
       ▼
2. analyze-game.ts (Tool layer)
   - Parse and validate input (Zod schema)
   - Fetch PGN if URL/ID provided
   - Replay game with chess.js, extract positions
       │
       ▼
3. engine-router.ts (Foundation — for each position)
   - Check SQLite eval cache → hit: skip engine call
   - Try Docker Stockfish (100–200ms/position)
   - Fallback: WASM pool → single WASM
   - Optional: Lichess cloud eval (if ENABLE_LICHESS_CLOUD=true)
       │
       ▼
4. Adaptive depth (two-pass)
   - Pass 1: all positions at quietDepth (default 10) — fast sweep
   - Identify critical positions: eval swing > quietThreshold (30cp)
   - Pass 2: re-evaluate critical positions at criticalDepth (default 16)
       │
       ▼
5. Intelligence layer (for each position)
   - position-classifier.ts: classifyPhase(), classifyPawnStructure(), getMaterialBalance()
   - theme-tagger.ts: tagThemes()
   - narrative-generator.ts: generateNarrative()
       │
       ▼
6. critical-moments.ts
   - detectCriticalMoments(): classify blunders, mistakes, inaccuracies, missed wins
   - computeAccuracy(): % moves within 30cp of best, per player
       │
       ▼
7. MCP JSON response
   - Structured GameAnalysis object
   - All fields populated, no raw centipawn arrays
       │
       ▼
8. Claude
   - Receives enriched JSON
   - Generates natural language analysis
   - Does NOT call any engine or API
```
