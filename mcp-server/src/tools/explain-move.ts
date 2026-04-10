import { Chess } from "chess.js";
import { config } from "../config.js";
import { getEval, waitUntilRouterReady } from "../engines/engine-router.js";
import {
  evalForSideToMove,
  categorise,
} from "../intelligence/critical-moments.js";
import {
  classifyPhase,
  classifyPawnStructure,
  getMaterialBalance,
} from "../intelligence/position-classifier.js";
import { tagThemes } from "../intelligence/theme-tagger.js";
import { generateNarrative } from "../intelligence/narrative-generator.js";
import { detectPlayerLevel } from "../intelligence/player-level.js";
import { getStats as getChessComStats } from "../data/chesscom-api.js";
import { getProfile as getLichessProfile } from "../data/lichess-api.js";
import {
  resolvePgn,
  extractHeader,
  lineToEvalCp,
} from "./analyze-game.js";
import { uciToSan, pvToSan } from "./analyze-position.js";
import type {
  ExplainMoveInput,
  MoveExplanation,
  BoardData,
  BoardMove,
  BoardArrow,
  GamePhase,
  ChessTheme,
  PawnStructure,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Arrow color by classification
// ---------------------------------------------------------------------------

function classToColor(
  classification: MoveExplanation["classification"]
): string {
  switch (classification) {
    case "best":
      return "#4caf50";
    case "good":
    case "excellent":
      return "#8bc34a";
    case "inaccuracy":
      return "#ffeb3b";
    case "mistake":
      return "#ff9800";
    case "blunder":
    case "missed_win":
    case "miss":
      return "#f44336";
    default:
      return "#4caf50";
  }
}

// ---------------------------------------------------------------------------
// Move intent builder
// ---------------------------------------------------------------------------

interface VerboseMove {
  from: string;
  to: string;
  flags: string;
  piece: string;
  captured?: string;
  promotion?: string;
  san: string;
}

function buildMoveIntent(
  playedMove: VerboseMove,
  themes: ChessTheme[],
  phase: GamePhase,
  level: "beginner" | "club" | "advanced"
): string {
  const themeSet = new Set(themes);
  const piece = playedMove.piece.toUpperCase();
  const flags = playedMove.flags;

  // Castling
  if (flags.includes("k") || flags.includes("q")) {
    return "Castles to improve king safety and connect the rooks.";
  }

  // Promotion
  if (flags.includes("p") && playedMove.promotion) {
    const promPiece = playedMove.promotion.toUpperCase();
    return `Promotes the pawn to a ${promPiece === "Q" ? "queen" : promPiece === "R" ? "rook" : promPiece === "B" ? "bishop" : "knight"}, gaining a powerful piece.`;
  }

  const parts: string[] = [];

  // Capture
  if (flags.includes("c") || flags.includes("e")) {
    const captured = playedMove.captured?.toUpperCase() ?? "piece";
    const capturedName =
      captured === "Q" ? "queen" :
      captured === "R" ? "rook" :
      captured === "B" ? "bishop" :
      captured === "N" ? "knight" :
      captured === "P" ? "pawn" : "piece";
    parts.push(`Captures the ${capturedName} on ${playedMove.to}`);
  }

  // Check
  if (flags.includes("+") || playedMove.san?.endsWith("+")) {
    parts.push("giving check");
  }

  // Development (opening phase, piece moving from back rank)
  if (phase === "opening" && (piece === "N" || piece === "B")) {
    if (["1", "8"].some((r) => playedMove.from.endsWith(r))) {
      const pieceName = piece === "N" ? "knight" : "bishop";
      parts.push(`Develops the ${pieceName} toward the center`);
    }
  }

  // Thematic cross-references
  if (parts.length === 0) {
    if (piece === "K" || piece === "Q" || piece === "R") {
      const pieceName =
        piece === "K" ? "king" : piece === "Q" ? "queen" : "rook";
      parts.push(`Moves the ${pieceName} to ${playedMove.to}`);
    } else if (piece === "P") {
      parts.push(`Advances the pawn to ${playedMove.to}`);
    } else {
      parts.push(`Moves to ${playedMove.to}`);
    }
  }

  if (themeSet.has("fork_potential") && (piece === "N" || piece === "Q")) {
    parts.push("creating a fork threat");
  }
  if (themeSet.has("king_safety") && phase !== "endgame") {
    parts.push("while keeping an eye on king safety");
  }
  if (themeSet.has("open_file") && piece === "R") {
    parts.push("seizing the open file");
  }
  if (themeSet.has("back_rank") && (piece === "R" || piece === "Q")) {
    parts.push("targeting back-rank weaknesses");
  }

  // level is used only for future expansion — suppress unused warning
  void level;

  return parts.join(", ") + ".";
}

// ---------------------------------------------------------------------------
// Assessment builder
// ---------------------------------------------------------------------------

function buildAssessment(
  classification: MoveExplanation["classification"],
  evalDropCp: number,
  playedSan: string,
  bestSan: string,
  level: "beginner" | "club" | "advanced"
): string {
  const pawns = (evalDropCp / 100).toFixed(1);
  switch (classification) {
    case "best":
      return "This was the best move in the position.";
    case "excellent":
    case "good":
      return level === "advanced"
        ? `A good move — only ${pawns} pawns below the engine's top choice.`
        : "A good move, very close to the engine's top choice.";
    case "inaccuracy":
      return level === "beginner"
        ? `A slight inaccuracy. ${bestSan} was a bit more accurate.`
        : `A slight inaccuracy (−${pawns} pawns). ${bestSan} was more precise.`;
    case "mistake":
      return level === "beginner"
        ? `A mistake. ${bestSan} was the right move here.`
        : `A mistake that gave away ${pawns} pawns of advantage. ${bestSan} was correct.`;
    case "blunder":
      return level === "beginner"
        ? `A blunder — this loses a lot. ${bestSan} was needed.`
        : `A blunder losing ${pawns} pawns of advantage. ${bestSan} was necessary.`;
    case "missed_win":
      return level === "beginner"
        ? `This lets a winning position slip away. ${bestSan} would have kept the advantage.`
        : `Missed win — had a decisive advantage but ${playedSan} lets it escape. ${bestSan} would have maintained the win.`;
    case "miss":
      return `A missed opportunity. ${bestSan} was stronger.`;
    default:
      return `${playedSan} was played.`;
  }
}

// ---------------------------------------------------------------------------
// Best-move explanation builder
// ---------------------------------------------------------------------------

function buildWhyBetter(
  bestSan: string,
  bestUci: string,
  fenBefore: string,
  themes: ChessTheme[],
  phase: GamePhase,
  level: "beginner" | "club" | "advanced"
): string {
  const themeSet = new Set(themes);
  const from = bestUci.slice(0, 2);
  const to = bestUci.slice(2, 4);

  const board = new Chess(fenBefore);
  const promoChar = bestUci[4];
  let move: ReturnType<typeof board.move> | null = null;
  try {
    move = board.move(
      promoChar !== undefined
        ? { from, to, promotion: promoChar }
        : { from, to }
    );
  } catch {
    return `${bestSan} was the engine's top recommendation.`;
  }
  if (!move) return `${bestSan} was the engine's top recommendation.`;

  const parts: string[] = [];

  if (move.flags.includes("c") || move.flags.includes("e")) {
    const captured = move.captured?.toUpperCase() ?? "piece";
    const name =
      captured === "Q" ? "queen" :
      captured === "R" ? "rook" :
      captured === "B" ? "bishop" :
      captured === "N" ? "knight" : "pawn";
    parts.push(`wins the ${name} on ${to}`);
  }

  if (move.flags.includes("+")) {
    parts.push("gives check");
  }

  if (themeSet.has("fork_potential")) {
    parts.push("creates a fork threat");
  }
  if (themeSet.has("king_safety") && phase !== "endgame") {
    parts.push("improves king safety");
  }
  if (themeSet.has("piece_activity")) {
    parts.push("activates a key piece");
  }
  if (themeSet.has("open_file")) {
    parts.push("controls the open file");
  }

  if (parts.length === 0) {
    if (phase === "opening") parts.push("improves piece development and central control");
    else if (phase === "endgame") parts.push("improves king activity and pawn structure");
    else parts.push("maintains better piece coordination");
  }

  const sentence = `${bestSan} ${parts.join(" and ")}.`;
  return level === "beginner"
    ? sentence
    : `${sentence} The engine evaluates this as significantly stronger.`;
}

// ---------------------------------------------------------------------------
// Takeaway builder
// ---------------------------------------------------------------------------

function buildTakeaway(
  classification: MoveExplanation["classification"],
  phase: GamePhase,
  themes: ChessTheme[],
  structures: PawnStructure[],
  level: "beginner" | "club" | "advanced"
): string {
  const themeSet = new Set(themes);

  if (classification === "best" || classification === "excellent" || classification === "good") {
    return level === "beginner"
      ? "Good move! Keep thinking about piece safety and central control."
      : "Well played — this confirms your understanding of this position type.";
  }

  // Blunder-specific
  if (classification === "blunder" || classification === "missed_win") {
    if (phase === "opening") {
      return level === "beginner"
        ? "After each opening move, check: does my move hang a piece? Can my opponent attack something for free?"
        : "Before committing to an opening move, verify no tactical shot is available to your opponent.";
    }
    if (themeSet.has("fork_potential")) {
      return level === "beginner"
        ? "Always check if your opponent's knight can jump to a square attacking two pieces at once."
        : "Scan for knight fork possibilities before every move — they are easy to miss under time pressure.";
    }
    if (themeSet.has("back_rank")) {
      return level === "beginner"
        ? "Watch out for back-rank checkmate threats — make sure your king has an escape square."
        : "Back-rank weaknesses require prophylaxis — an escape square or rook on the first rank.";
    }
    if (themeSet.has("king_safety")) {
      return level === "beginner"
        ? "Keep your king safe — avoid moves that open lines toward your own king."
        : "Evaluate king safety before every tactical sequence — an unsafe king changes everything.";
    }
  }

  // Mistake
  if (classification === "mistake") {
    if (themeSet.has("piece_activity")) {
      return level === "beginner"
        ? "Try to keep your pieces on active squares where they control important areas."
        : "Piece activity often outweighs material equality — prefer active moves.";
    }
    if (phase === "endgame") {
      return level === "beginner"
        ? "In endgames, every pawn and king move matters — take your time."
        : `In endgames with ${structures[0] ?? "this structure"}, precision is critical — calculate forcing lines.`;
    }
  }

  // Inaccuracy
  if (classification === "inaccuracy") {
    if (phase === "opening") {
      return level === "beginner"
        ? "Study the main ideas of this opening — knowing the key moves helps avoid inaccuracies."
        : "Review the critical branching points in this variation — small inaccuracies here compound later.";
    }
  }

  // Generic fallback
  return level === "beginner"
    ? "After each move, ask: does this improve my position? Is anything hanging?"
    : "Use this as a pattern to recognise — understanding why the engine's choice is better builds intuition.";
}

// ---------------------------------------------------------------------------
// boardData builder
// ---------------------------------------------------------------------------

function buildBoardData(
  pgn: string,
  targetPly: number,
  classification: MoveExplanation["classification"],
  evalAfterCp: number,
  playedFrom: string,
  playedTo: string,
  bestUci: string,
  isBestMove: boolean,
  assessment: string,
  orientation: "white" | "black"
): BoardData | null {
  try {
    const board = new Chess();
    board.loadPgn(pgn);
    const history = board.history({ verbose: true });

    const replayBoard = new Chess();
    const initialFen = replayBoard.fen();
    const moves: BoardMove[] = [];

    for (let i = 0; i < history.length; i++) {
      const move = history[i];
      if (!move) continue;
      replayBoard.move(move.san);
      const fen = replayBoard.fen();
      const uci = move.from + move.to + (move.promotion ?? "");
      const arrows: BoardArrow[] = [];

      if (i === targetPly) {
        // Arrow for played move
        arrows.push({
          from: playedFrom,
          to: playedTo,
          color: classToColor(classification),
          label: null,
          width: "thick",
        });
        // Arrow for best move (if different)
        if (!isBestMove && bestUci.length >= 4) {
          arrows.push({
            from: bestUci.slice(0, 2),
            to: bestUci.slice(2, 4),
            color: "#4caf50",
            label: "Best",
            width: "normal",
          });
        }
      }

      moves.push({
        ply: i + 1,
        san: move.san,
        fen,
        uci,
        eval: i === targetPly ? evalAfterCp : null,
        classification: i === targetPly
          ? (classification === "missed_win" ? "blunder" : classification)
          : null,
        annotation:
          i === targetPly
            ? assessment.slice(0, 200)
            : null,
        arrows,
        clock: null,
      });
    }

    const white = extractHeader(pgn, "White");
    const black = extractHeader(pgn, "Black");
    const whiteEloStr = extractHeader(pgn, "WhiteElo");
    const blackEloStr = extractHeader(pgn, "BlackElo");
    const eco = extractHeader(pgn, "ECO");
    const openingName = extractHeader(pgn, "Opening");
    const timeControl = extractHeader(pgn, "TimeControl");
    const result = extractHeader(pgn, "Result");

    const isKnown = (val: string) => val !== "Unknown";

    return {
      meta: { initialFen, orientation },
      moves,
      players: {
        white: {
          name: isKnown(white) ? white : "White",
          rating: isKnown(whiteEloStr) ? parseInt(whiteEloStr, 10) : null,
        },
        black: {
          name: isKnown(black) ? black : "Black",
          rating: isKnown(blackEloStr) ? parseInt(blackEloStr, 10) : null,
        },
      },
      opening:
        isKnown(eco) && isKnown(openingName)
          ? { eco, name: openingName, moves: "" }
          : null,
      result: isKnown(result) ? result : "*",
      timeControl: isKnown(timeControl) ? timeControl : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Player rating helper
// ---------------------------------------------------------------------------

async function fetchPlayerRatingForLevel(
  username: string,
  platform: "chess.com" | "lichess"
): Promise<number | null> {
  try {
    if (platform === "chess.com") {
      const stats = await getChessComStats(username);
      return (
        stats.chess_rapid?.last?.rating ??
        stats.chess_blitz?.last?.rating ??
        stats.chess_bullet?.last?.rating ??
        null
      );
    } else {
      const profile = await getLichessProfile(username);
      const perfs = profile.perfs;
      return (
        perfs?.rapid?.rating ??
        perfs?.blitz?.rating ??
        perfs?.bullet?.rating ??
        null
      );
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleExplainMove(
  input: ExplainMoveInput
): Promise<MoveExplanation> {
  // 1. Resolve PGN
  if (
    input.pgn === undefined &&
    input.game_url === undefined &&
    input.lichess_id === undefined &&
    input.username === undefined
  ) {
    throw new Error(
      "Please provide a game source: pgn, game_url, lichess_id, or username."
    );
  }

  const pgn = await resolvePgn(input);

  // 2. Parse & navigate to target ply
  const board = new Chess();
  board.loadPgn(pgn);
  const history = board.history({ verbose: true });

  const targetPly =
    (input.move_number - 1) * 2 + (input.color === "black" ? 1 : 0);

  if (targetPly >= history.length || targetPly < 0) {
    throw new Error(
      `Move ${input.move_number} ${input.color} is out of range — this game has ${Math.ceil(history.length / 2)} full moves.`
    );
  }

  // fenBefore is the position BEFORE the target move
  const replayBoard2 = new Chess();
  for (let i = 0; i < targetPly; i++) {
    const h = history[i];
    if (h) replayBoard2.move(h.san);
  }
  const fenBefore = replayBoard2.fen();

  const replayBoard3 = new Chess();
  for (let i = 0; i <= targetPly; i++) {
    const h = history[i];
    if (h) replayBoard3.move(h.san);
  }
  const fenAfter = replayBoard3.fen();

  const playedMove = history[targetPly];
  if (!playedMove) {
    throw new Error(`No move found at ply ${targetPly}.`);
  }
  const playedUci =
    playedMove.from + playedMove.to + (playedMove.promotion ?? "");

  // 3. Wait for engine
  await waitUntilRouterReady(config.stockfish.readinessTimeout);

  // 4. Evaluate in parallel
  const depth = input.depth ?? config.stockfish.defaultDepth;
  const [linesBefore, linesAfter] = await Promise.all([
    getEval(fenBefore, depth, 3),
    getEval(fenAfter, depth, 1),
  ]);

  const evalBeforeCp =
    linesBefore.length > 0 && linesBefore[0] ? lineToEvalCp(linesBefore[0]) : 0;
  const evalAfterCp =
    linesAfter.length > 0 && linesAfter[0] ? lineToEvalCp(linesAfter[0]) : 0;

  // 5. Normalize eval drop (side-to-move, immune to Issue #85)
  const evalBeforeStm = evalForSideToMove(evalBeforeCp, input.color);
  const evalAfterStm = evalForSideToMove(evalAfterCp, input.color);
  // bestUci needs to be known before evalDrop for the isBestMove check below.
  // We compute it early here so we can zero out the drop when the best move was played.
  const bestUciEarly = linesBefore[0]?.pv[0] ?? "";
  const isBestMoveEarly = bestUciEarly === playedUci;
  // If the player played the best move, eval drop is defined as 0 regardless of
  // centipawn rounding differences between the two evaluations.
  const evalDropCp = isBestMoveEarly ? 0 : Math.max(0, evalBeforeStm - evalAfterStm);

  // 6. Classify
  const bestUci = bestUciEarly;
  const isBestMove = isBestMoveEarly;
  const hadWinning = evalBeforeStm >= 300;
  const isNowLosing = evalAfterStm <= -50;

  let classification: MoveExplanation["classification"];
  if (isBestMove) {
    classification = "best";
  } else {
    const cat = categorise(evalDropCp, hadWinning, isNowLosing);
    classification =
      cat === "missed_win"
        ? "missed_win"
        : cat === "blunder"
        ? "blunder"
        : cat === "mistake"
        ? "mistake"
        : cat === "inaccuracy"
        ? "inaccuracy"
        : "good";
  }

  // 7. Convert best move UCI → SAN, build continuations
  const fenBoard = new Chess(fenBefore);
  const bestSan = bestUci ? uciToSan(fenBoard, bestUci) : "";
  const bestContinuation =
    linesBefore[0]?.pv
      ? pvToSan(new Chess(fenBefore), linesBefore[0].pv.slice(0, 4))
      : [];

  const altLine = linesBefore[1];
  const altUci = altLine?.pv[0] ?? "";
  const altSan = altUci ? uciToSan(new Chess(fenBefore), altUci) : "";
  const altContinuation = altLine?.pv
    ? pvToSan(new Chess(fenBefore), altLine.pv.slice(0, 4))
    : [];

  // 8. Position context
  const posBoard = new Chess(fenBefore);
  const phase = classifyPhase(posBoard);
  const structures = classifyPawnStructure(posBoard);
  const themes = tagThemes(posBoard, phase);
  const { advantage: materialBalance } = getMaterialBalance(posBoard);
  const narrative = generateNarrative(
    phase,
    structures,
    themes,
    evalBeforeCp,
    null
  );

  // 9. Player level
  let level: "beginner" | "club" | "advanced";
  if (input.player_level) {
    level = input.player_level;
  } else if (input.username && input.platform) {
    const rating = await fetchPlayerRatingForLevel(
      input.username,
      input.platform
    );
    level = rating !== null ? detectPlayerLevel(rating) : "club";
  } else {
    level = "club";
  }

  // 10. Build move intent
  const moveIntent = buildMoveIntent(
    playedMove as VerboseMove,
    themes,
    phase,
    level
  );

  // 11. Build assessment
  const assessment = buildAssessment(
    classification,
    evalDropCp,
    playedMove.san,
    bestSan,
    level
  );

  // 12. Build best move explanation
  const bestMoveResult: MoveExplanation["best_move"] = isBestMove
    ? null
    : {
        san: bestSan,
        uci: bestUci,
        eval_cp: linesBefore[0]?.score_cp ?? null,
        eval_mate: linesBefore[0]?.score_mate ?? null,
        continuation: bestContinuation,
        why_better: buildWhyBetter(
          bestSan,
          bestUci,
          fenBefore,
          themes,
          phase,
          level
        ),
      };

  // Alternative (second engine line)
  const alternativeResult: MoveExplanation["alternative"] =
    altSan && altUci && altUci !== playedUci && altUci !== bestUci
      ? {
          san: altSan,
          uci: altUci,
          eval_cp: altLine?.score_cp ?? null,
          eval_mate: altLine?.score_mate ?? null,
          continuation: altContinuation,
        }
      : null;

  // 13. Takeaway
  const takeaway = buildTakeaway(classification, phase, themes, structures, level);

  // 14. boardData
  const boardData = buildBoardData(
    pgn,
    targetPly,
    classification,
    evalAfterCp,
    playedMove.from,
    playedMove.to,
    bestUci,
    isBestMove,
    assessment,
    input.color
  );

  // fenAfter is computed but used only for potential future expansion
  void fenAfter;

  // 15. Return
  return {
    move_number: input.move_number,
    color: input.color,
    move_played: playedMove.san,
    move_played_uci: playedUci,
    classification,
    eval_before_cp: evalBeforeCp,
    eval_after_cp: evalAfterCp,
    eval_drop_cp: evalDropCp,
    move_intent: moveIntent,
    assessment,
    best_move: bestMoveResult,
    alternative: alternativeResult,
    position_context: {
      phase,
      themes,
      pawn_structures: structures,
      material_balance: materialBalance,
      narrative,
    },
    takeaway,
    player_level: level,
    board_data: boardData,
  };
}
