# Contributing to ChessContext

Thanks for your interest in contributing.

## How to Contribute

### Adding a New Chess Theme

1. Add the theme name to the `CHESS_THEMES` array in `mcp-server/src/types/index.ts`
2. Add detection logic in `mcp-server/src/intelligence/theme-tagger.ts` — follow the existing pattern (pure function, uses `chess.js` board inspection)
3. Add a narrative sentence template for the theme in `mcp-server/src/intelligence/narrative-generator.ts`
4. Test by feeding a position where the theme should appear to `analyze_position`

### Adding a New Pawn Structure

1. Add the name to `PAWN_STRUCTURES` in `src/types/index.ts`
2. Add detection logic in `src/intelligence/position-classifier.ts` inside `classifyPawnStructure()`
3. Add a narrative template in `narrative-generator.ts`

### Adding a New MCP Tool

1. Define input/output types in `src/types/index.ts`
2. Create `src/tools/your-tool-name.ts` — implement the handler
3. Register the tool in `src/index.ts` using `server.registerTool()`
4. Add the tool to `docs/tools.md` with example input/output
5. Add to the roadmap checklist in `README.md`

## Development Setup

```bash
git clone https://github.com/your-username/mcp-chess.git
cd mcp-chess/mcp-server
npm install
npm run dev    # runs with tsx (no build step)
npm run build  # compile to dist/
```

## Code Style

- TypeScript strict mode — no `any`, no type assertions without justification
- Immutable data — intelligence layer functions are pure (no side effects)
- Files stay under 400 lines; split when they grow larger
- Errors must be explicit — no swallowed exceptions

## Pull Request Checklist

- [ ] `npm run build` passes with zero errors
- [ ] New tool has an entry in `docs/tools.md`
- [ ] New theme/structure has a narrative template
- [ ] No hardcoded values — use `config.ts`
