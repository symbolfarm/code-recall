# Code Recall

Code Recall is a local-first VS Code prototype for learning a codebase through
active recall. It builds a deterministic atlas from TypeScript/JavaScript ASTs;
it does not use an AI model, embeddings, telemetry, or a remote indexing
service.

## Prototype features

- A **Code Atlas** tree of files, classes, interfaces, functions, methods,
  enums, and type aliases, with direct source navigation.
- A file-level graph whose edges are resolved local imports.
- A graph recall mode that conceals file labels until you try to name them from
  their position and connections.
- Component recall prompts followed by deterministic source facts and an
  `Again / Hard / Good / Easy` self-rating.
- Per-workspace review state stored in VS Code's local workspace storage.

Free-text answers are intentionally not graded. The learner compares their
answer with the revealed signature, containment count, and source location.

## Run it

```sh
npm install
npm test
```

Open this folder in VS Code and press `F5`. In the Extension Development Host,
open a TypeScript or JavaScript project and select the Code Recall icon in the
activity bar. Use the title-bar buttons to re-index, open the graph, or review a
due component.

## Graph schema

Stable node IDs use repository-relative paths and qualified symbol names, for
example `file:src/indexer.ts` and
`function:src/indexer.ts#collectSourceFiles`. Current edge types are
`contains` and `imports`.

## Current limitations

- Only TypeScript and JavaScript syntax is indexed.
- Declarations inside function bodies and variable-bound arrow functions are
  not yet nodes.
- Imports are links only when a relative specifier resolves directly to an
  indexed source file; path aliases and package edges are omitted.
- The graph uses a simple static grid intended for small prototypes.
- Scheduling is deliberately small and inspectable, not a full FSRS
  implementation.
- Renames change stable IDs; structural reconciliation is future work.

## Privacy boundary

Indexing and review data stay on the machine. The extension declares no network
capability and has no AI dependency. An optional AI feedback adapter, if ever
added, should consume an explicit user-selected component and remain separate
from graph construction.

