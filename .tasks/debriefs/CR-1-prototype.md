# Debrief: CR-1 Build the deterministic recall prototype

**Completed:** 2026-07-20
**Commit:** e877a109809030fd77d31c7d99070975e2ee6206

## What shipped

A runnable VS Code extension indexes TypeScript and JavaScript with the
TypeScript compiler AST, models files and named declarations, resolves local
import edges, provides source navigation, renders a file graph with concealed
labels, and runs self-rated recall reviews stored in local workspace state.
Four unit tests cover indexing, filtering, import resolution, and scheduling.

## Descoped / deferred

Semantic call graphs, path aliases, variable-bound functions, cross-language
adapters, rename reconciliation, and optional AI feedback remain outside this
prototype. These are documented limitations rather than hidden partial
features.

## Design decisions

- Review prose is never automatically scored. Deterministic facts are revealed
  and the learner rates their own recall.
- Review state uses VS Code workspace storage instead of repository files so
  private learning history does not dirty the codebase under study.
- The initial graph uses a dependency-free static grid. This keeps the
  extension offline and makes graph interaction testable before investing in a
  sophisticated layout engine.
- File nodes use repository-relative IDs and symbol nodes use qualified-name
  IDs. Rename reconciliation is explicitly deferred.

## Observations

The AST supplies containment and signatures reliably, while exact call graphs
would require type-checker/reference analysis and substantially more language
specificity. Separating those layers should remain an architectural boundary.

## Follow-ups

No follow-up tasks were filed; the deferred capabilities should be prioritized
after hands-on use validates the recall interaction.
