# CR-1 Build the deterministic recall prototype

**Priority:** high
**Blocked by:** nothing
**Touches:** `package.json`, `tsconfig.json`, `src/**`, `test/**`, `README.md`, `.vscode/**`, `.gitignore`

## Context

AI-generated projects are difficult to internalize. The product hypothesis is
that a deterministic code graph with progressively concealed facts can support
active recall without requiring AI analysis or generated quizzes.

## Goal

Ship a runnable VS Code extension that indexes TypeScript locally, exposes its
structure and links, and provides self-rated recall exercises with durable
local progress.

## Acceptance criteria

- [ ] TypeScript files, declarations, containment, and imports are extracted from ASTs without AI.
- [ ] A VS Code view supports source navigation and deterministic recall/reveal exercises.
- [ ] A graph view shows file import links and supports concealed-label recall mode.
- [ ] Review outcomes persist locally and influence due-review ordering.
- [ ] No source code leaves the machine and no AI service is required.
- [ ] Type checking and relevant tests pass.
- [ ] Setup and prototype limitations are documented.

## Relevant files

- `src/model.ts`
- `src/indexer.ts`
- `src/extension.ts`
- `src/graphView.ts`
- `test/indexer.test.ts`

## Decisions already made

- Begin with TypeScript and JavaScript; use the TypeScript compiler AST.
- Keep graph construction deterministic and local.
- Treat any eventual AI evaluation as a separate optional adapter.
- Use self-assessment for prose answers rather than pretending to grade them.

## Out of scope

- AI integration, embeddings, or generated summaries.
- Full semantic call graphs and cross-language indexing.
- Marketplace packaging and publishing.
- Production-scale graph layout.
