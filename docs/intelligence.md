# Intelligence Layer Internals

This document is the authoritative reference for the `mcp-server/src/intelligence/` module. It describes exactly what each function does and how every rule, threshold, and detection condition is implemented.

## Overview

The intelligence layer is composed of four pure TypeScript modules:

| File | Primary export | Purpose |
|------|---------------|---------|
| `position-classifier.ts` | `classifyPhase`, `classifyPawnStructure`, `getMaterialBalance` | Board state analysis |
| `theme-tagger.ts` | `tagThemes` | Tactical and strategic theme detection |
| `critical-moments.ts` | `detectCriticalMoments`, `computeAccuracy` | Blunder/mistake detection and accuracy scoring |
| `narrative-generator.ts` | `generateNarrative` | Human-readable game commentary |

**Design properties shared by all four files:**

- **Pure functions** — no I/O, no side effects, no mutable shared state.
- **Imports** — only `chess.js` types and project types from `src/types/index.ts`.
- **Testable in isolation** — pass a `Chess` instance (or plain data) and get deterministic output; no mocks required.

---

## `position-classifier.ts`

### Game Phase Detection — `classifyPhase(board: Chess): GamePhase`

Inspects piece counts and move history to return `"opening"`, `"middlegame"`, or `"endgame"`.

**Evaluation order (first match wins):**

| Priority | Condition | Result |
|----------|-----------|--------|
| 1 (endgame) | Both queens gone (`!hasWhiteQueen && !hasBlackQueen`) | `"endgame"` |
| 1 (endgame) | Total minor+major pieces ≤ 4 (kings excluded) | `"endgame"` |
| 1 (endgame) | Total pieces on board ≤ 8 | `"endgame"` |
| 2 (opening) | Move number ≤ 12 **AND** both queens present **AND** total pieces ≥ 24 | `"opening"` |
| 3 (fallthrough) | Everything else | `"middlegame"` |

`totalMinorMajor` is calculated as:
```
counts.total - counts.white["p"] - counts.black["p"] - 2  // subtract both kings
```

Move number is derived from `Math.ceil(board.history().length / 2)`.

**Example:**

```typescript
import { Chess } from "chess.js";
import { classifyPhase } from "./src/intelligence/position-classifier.js";

const board = new Chess();
console.log(classifyPhase(board)); // "opening" — start position, move 0
```

---

### Pawn Structure Detection — `classifyPawnStructure(board: Chess): PawnStructure[]`

Returns an array of all detected `PawnStructure` values. Multiple structures can coexist. Detection runs per-square for per-color checks, then adds global center and hanging-pawn checks.

The function builds internal "pawn maps": for each side, `pawnMap[file]` is an array of rank indices where that side has a pawn. Ranks use the `board.board()` array convention (index 0 = rank 8, index 7 = rank 1).

#### Detected per-color, per-file

| Structure | Detection rule |
|-----------|---------------|
| `doubled` | `myPawns[file].length > 1` — more than one pawn on the same file |
| `isolated` | No friendly pawns on the adjacent left file **and** no friendly pawns on the adjacent right file |
| `passed` | No enemy pawns on the same or either adjacent file **ahead** of this pawn (in the direction of advance). Also requires `ranks.length === 1` (not doubled). White advances toward rank 0; black advances toward rank 7. |
| `backward` | Cannot be supported by an adjacent friendly pawn one rank behind it (`canBeSupported = false`), **and** the pawn is not yet advanced (white: rank > 3; black: rank < 4), **and** it is also isolated (`!hasLeft && !hasRight`) |
| `chain` | A friendly pawn exists diagonally behind this pawn: `myPawns[file-1].includes(rank + 1)` (white) or `myPawns[file+1].includes(rank + 1)` (white), using `rank - 1` instead for black |

#### Detected globally

| Structure | Detection rule |
|-----------|---------------|
| `hanging` | White has pawns on the c-file (index 2) **and** d-file (index 3), **and** no pawns on b-file (index 1) or e-file (index 4). Only checked for white. |
| `symmetrical` | White has pawns on both e4 and d4 **and** black has pawns on both e5 and d5 |
| `closed_center` | `(whiteOnE4 && blackOnD5)` **or** `(whiteOnD4 && blackOnE5)` — opposing pawns blocking the center |
| `open_center` | Neither side has a pawn on e4/d4 (white) or e5/d5 (black): `whiteCenterPawns === 0 && blackCenterPawns === 0` |
| `semi_open_center` | `Math.abs(whiteCenterPawns - blackCenterPawns) >= 1` — one side has more central pawns than the other |

Board coordinate mapping for center squares (board array, 0-indexed):
- e4 → file index 4, rank index 4
- d4 → file index 3, rank index 4
- e5 → file index 4, rank index 3
- d5 → file index 3, rank index 3

**Example:**

```typescript
import { Chess } from "chess.js";
import { classifyPawnStructure } from "./src/intelligence/position-classifier.js";

const board = new Chess("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3");
console.log(classifyPawnStructure(board)); // may include "symmetrical", "closed_center", etc.
```

---

### Material Balance — `getMaterialBalance(board: Chess)`

Returns `{ white: number, black: number, advantage: number }` in centipawns.

**Piece values used:**

| Piece | Centipawn value |
|-------|----------------|
| Pawn (`p`) | 100 |
| Knight (`n`) | 320 |
| Bishop (`b`) | 330 |
| Rook (`r`) | 500 |
| Queen (`q`) | 900 |
| King (`k`) | 0 |

`advantage` = `white - black`. Positive means white is ahead; negative means black is ahead.

**Example:**

```typescript
import { Chess } from "chess.js";
import { getMaterialBalance } from "./src/intelligence/position-classifier.js";

const board = new Chess();
const balance = getMaterialBalance(board);
// { white: 3990, black: 3990, advantage: 0 }
```

---

### Complexity Estimate — `estimateComplexity(board, evalSwing)`

Returns `"low"`, `"medium"`, or `"high"`.

| Result | Condition |
|--------|-----------|
| `"high"` | `evalSwing > 150` **or** legal move count > 50 |
| `"medium"` | `evalSwing > 60` **or** legal move count > 30 |
| `"low"` | Everything else |

---

## `theme-tagger.ts`

### Theme Detection — `tagThemes(board: Chess, phase: GamePhase): ChessTheme[]`

Runs all 15 detectors and returns an array of all themes that trigger. The `phase` parameter is passed through to `rankThemes` in the narrative generator but is **not** used to gate detection here — all detectors always run.

#### Theme trigger conditions

| Theme | Trigger condition |
|-------|------------------|
| `king_safety` | Either king has fewer than 2 shield pawns (own-color pawns within 1 file of the king, on the king's forward side) |
| `pawn_storm` | Either side has ≥ 2 pawns past the opponent's 5th rank: white pawns on rank ≥ 5, or black pawns on rank ≤ 4 |
| `space_advantage` | Either side controls ≥ 10 squares past the opponent's 4th rank (white: destination rank ≥ 5; black: destination rank ≤ 4) — measured by counting legal moves with qualifying destination squares |
| `piece_activity` | Total legal moves from `board.moves()` > 35 |
| `bishop_pair` | Either side has ≥ 2 bishops |
| `knight_outpost` | Either side has a knight that: (a) is advanced (white: rank ≥ 5; black: rank ≤ 4), (b) is protected by a friendly pawn diagonally behind it, and (c) is not attacked by any enemy piece (`board.isAttacked(square, opp) === false`) |
| `open_file` | Any file has no white pawn **and** no black pawn on it |
| `weak_squares` | Either king has ≥ 3 adjacent squares (within 1 rank and 1 file) that are attacked by the opponent |
| `pin` | The current side-to-move's king square is attacked by the opponent (`board.isAttacked(kingSquare, opponent) === true`) |
| `fork_potential` | Any knight move lands on a square from which the knight would attack ≥ 2 opponent non-pawn pieces simultaneously |
| `back_rank` | Either side: king is on its back rank (white: rank 1; black: rank 8) **and** has zero pawns within 1 file of the king's file |
| `opposite_colored_bishops` | Exactly one white bishop and one black bishop remain, and they are on opposite square colors `((file + rank) % 2)` |
| `rook_on_seventh` | Either side has a rook on its 7th rank (white: rank 7; black: rank 2) |
| `connected_rooks` | Either side has two rooks on the same rank or file with no pieces between them |
| `material_imbalance` | For any piece type (N, B, R, Q), one side has a different count than the other, **and** the total minor/major material difference is < 200 cp (imbalance without a clear material lead) |

**Note on `pin`:** The detector does not implement a full pin analysis. It uses king check status as a proxy — it fires when the side-to-move's king is currently attacked (in check), not when a piece is literally pinned.

**Example:**

```typescript
import { Chess } from "chess.js";
import { classifyPhase } from "./src/intelligence/position-classifier.js";
import { tagThemes } from "./src/intelligence/theme-tagger.js";

const board = new Chess();
const phase = classifyPhase(board);
const themes = tagThemes(board, phase);
console.log(themes); // e.g. ["piece_activity"]
```

---

### Phase-Based Theme Ranking

`rankThemes(themes, phase)` is used internally by `generateNarrative`. It sorts the detected themes by phase relevance and returns the top 2.

**Priority lists:**

| Phase | Ordered priority |
|-------|-----------------|
| `opening` | `king_safety`, `open_center`, `piece_activity`, `bishop_pair`, `space_advantage` |
| `middlegame` | `king_safety`, `pin`, `fork_potential`, `back_rank`, `rook_on_seventh`, `knight_outpost`, `pawn_storm`, `weak_squares` |
| `endgame` | `passed`, `rook_on_seventh`, `connected_rooks`, `opposite_colored_bishops`, `king_safety` |

Themes not on the priority list for the current phase are sorted after all prioritized themes. Themes with equal priority position retain their original order.

---

## `critical-moments.ts`

### Eval Normalization

All eval comparisons are done from the **side-to-move perspective**:

```
evalForSideToMove(evalCp, color) = color === "white" ? evalCp : -evalCp
```

`evalBefore` and `evalAfter` in `MoveRecord` are stored from **white's absolute perspective** (positive = white better). The normalization flips the sign for black's moves so that "better for the moving side" is always positive.

### Critical Moment Detection — `detectCriticalMoments(moves: MoveRecord[]): CriticalMoment[]`

Iterates every move and computes the eval drop from the moving side's perspective:

```
evalDrop = evalForSideToMove(evalBefore, color) - evalForSideToMove(evalAfter, color)
```

A move is skipped if `evalDrop < config.analysis.inaccuracyThreshold` (50 cp).

#### Move categories and thresholds (from `src/config.ts`)

| Category | Condition | Threshold (cp) |
|----------|-----------|---------------|
| `missed_win` | `evalBefore >= 300` (was winning) **and** `evalAfter <= -50` (now losing) | — |
| `blunder` | `evalDrop >= 200` | `config.analysis.blunderThreshold` |
| `mistake` | `evalDrop >= 100` | `config.analysis.mistakeThreshold` |
| `inaccuracy` | `evalDrop >= 50` | `config.analysis.inaccuracyThreshold` |
| `good` | `evalDrop < 50` | — |

`missed_win` is checked first — it takes priority over the cp-based thresholds.

The resulting `CriticalMoment` object includes:
- `move_number`, `color`, `move_played`, `best_move`
- `eval_before_cp`, `eval_after_cp`, `eval_drop_cp` (all from white's absolute perspective)
- `category`, `explanation` (human-readable sentence)

**Example:**

```typescript
import { detectCriticalMoments, MoveRecord } from "./src/intelligence/critical-moments.js";

const moves: MoveRecord[] = [
  {
    moveNumber: 15,
    color: "white",
    san: "Bxf7+",
    fenBefore: "...",
    fenAfter: "...",
    evalBefore: 50,
    evalAfter: -250,
    bestMoveSan: "Nf5",
  },
];

const moments = detectCriticalMoments(moves);
// [{ category: "blunder", eval_drop_cp: 300, ... }]
```

---

### Accuracy Computation — `computeAccuracy(moves: MoveRecord[], color: "white" | "black"): number`

Filters to only the given side's moves, then counts how many had an eval drop of less than 30 cp (side-to-move perspective).

```
accuracy = round((accurateMoves / totalMoves) * 100)
```

- Returns `100` if the player made zero moves.
- "Accurate" means `evalDrop < 30` cp (strictly less than, not ≤).

**Example:**

```typescript
import { computeAccuracy } from "./src/intelligence/critical-moments.js";

const accuracy = computeAccuracy(moves, "white"); // 0–100
```

---

### Mistake Categorization by Phase — `categoriseMistakesByPhase(moments)`

Groups `blunder` and `mistake` moments (inaccuracies and good moves excluded) into four buckets using move number as a phase proxy:

| Bucket | Move number condition |
|--------|-----------------------|
| `opening` | `move_number <= 12` |
| `endgame` | `move_number >= 35` |
| `tactical` | Middlegame (`13–34`) and category is `blunder` |
| `strategic` | Middlegame (`13–34`) and category is `mistake` |

---

## `narrative-generator.ts`

### Narrative Generation — `generateNarrative(...): string`

Assembles up to 4 sentences into a single paragraph. The sentences are joined with a single space.

**Function signature:**

```typescript
generateNarrative(
  phase: GamePhase,
  structures: PawnStructure[],
  themes: ChessTheme[],
  scoreCp: number | null,
  scoreMate: number | null
): string
```

**4-sentence structure:**

| Slot | Content | Always present? |
|------|---------|----------------|
| 1 | Phase sentence (from `PHASE_SENTENCES`) | Yes |
| 2 | Primary pawn structure sentence (from `STRUCTURE_SENTENCES`, using `structures[0]`) | Only if `structures` is non-empty |
| 3–4 | Top 1–2 themes ranked by `rankThemes(themes, phase)` | Only for detected themes |
| Last | Evaluation sentence | Only if `scoreCp` or `scoreMate` is non-null |

#### Evaluation range strings

| Condition | Template |
|-----------|----------|
| `scoreMate > 0` | `"White has forced checkmate in N moves."` |
| `scoreMate < 0` | `"Black has forced checkmate in N moves."` |
| `scoreCp >= 300` | `"White has a decisive advantage (+X.X)."` |
| `scoreCp <= -300` | `"Black has a decisive advantage (X.X)."` |
| `scoreCp >= 100` | `"White has a clear advantage (+X.X)."` |
| `scoreCp <= -100` | `"Black has a clear advantage (X.X)."` |
| `scoreCp >= 25` | `"White holds a slight edge (+X.X)."` |
| `scoreCp <= -25` | `"Black holds a slight edge (X.X)."` |
| `-24 to +24` | `"The position is approximately equal."` |

Score is formatted to one decimal place (e.g., `+1.5`).

**Example:**

```typescript
import { generateNarrative } from "./src/intelligence/narrative-generator.js";

const narrative = generateNarrative(
  "middlegame",
  ["isolated"],
  ["king_safety", "open_file"],
  150,
  null
);
// "The position has entered the middlegame, where strategic plans and tactical
//  opportunities take center stage. An isolated pawn creates a dynamic imbalance —
//  the owner gains active piece play, while the opponent has a long-term target to
//  attack. King safety is a critical factor — the exposed king must be sheltered
//  before launching any aggressive plans. White has a clear advantage (+1.5)."
```

---

## Known Limitations

### Rule-based heuristics

All detectors are hand-coded heuristics. They can produce false positives or false negatives:

- **`king_safety`**: Counts shield pawns naively; does not consider castled vs. uncastled positions or open diagonals toward the king.
- **`pawn_storm`**: Counts advanced pawns by rank only; does not verify that the storm is aimed at the opponent's king.
- **`space_advantage`**: Counts destination squares of legal moves past the 4th rank; does not discount moves that hang pieces.
- **`fork_potential`**: Checks pre-move board state for pieces within knight range of a knight's destination; it may miss forks on squares currently occupied, or over-count defended targets.
- **`pin`**: Implemented as a check-detection proxy (fires when the current king is in check), not a true pin detector.
- **`material_imbalance`**: The < 200 cp "no clear lead" threshold is a rough proxy; it does not account for positional compensation.

### Opening detection for off-book positions

`classifyPhase` uses move count (≤ 12) and piece count (≥ 24) as opening signals. An unusual position that transposes from a long opening into an early middlegame may be misclassified if the piece count drops below 24 quickly through early trades.

### Pawn structure reflects current state only

`classifyPawnStructure` reports the structural features present in the current position. It does not track how the structure evolved, so it cannot distinguish a strategically significant weakness from a temporary one.

### `rankThemes` uses fixed priority lists

The phase-based priority lists in `narrative-generator.ts` are static. A theme absent from the priority list for the detected phase will always appear after all listed themes, even if it is strategically the most relevant idea in the position.
