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
