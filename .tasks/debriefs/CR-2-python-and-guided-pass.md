# Debrief: CR-2 Index Python and add a guided review pass

**Completed:** 2026-07-22
**Commit:** b030c449 (backfilled to the log 2026-07-23)

## What shipped

Made Code Recall usable for reviewing the retention-bench (Python) release:

- **Python indexing** via the stdlib `ast` module shelled out to `python3`
  (`src/pythonIndexer.ts`), emitting the same CodeNode/CodeEdge model as the TS
  path: classes, methods, top-level functions with reconstructed signatures,
  and local import edges (relative + absolute-from-root resolution).
- `buildGraph` now dispatches by extension and skips `.venv`/`__pycache__`/
  `*.egg-info`; the TS `resolveImport` was scoped back to TS extensions; the
  O(n^2) file-node lookup in the TS pass now uses the shared `byId` map.
- **Guided pass** (`Review Codebase`): walks components most-depended-on first
  (import in-degree), scoped Modules / +declarations / Everything, with progress
  and Escape-to-pause; seeds the spaced deck so `Review Due` resumes it.
- Tests for Python indexing and tour ordering; README updated. Verified
  end-to-end on retention-bench (506 nodes; tour leads with `__init__.py`,
  `_clbench.py`, `system.py`).

## Design decisions

- **`ast`, not tree-sitter.** Ground-truth-accurate for Python, dependency-free,
  and still deterministic + headless-testable — everything wanted from
  tree-sitter, for the actual target. tree-sitter is reserved for a future
  multi-language push, not this release.
- **Guided pass ordered by import in-degree.** Central modules are the ones
  worth being able to explain; the tour is the on-ramp that seeds the SRS deck
  (which was otherwise empty until a component had been recalled once).

## Descoped / deferred

Optional AI grading adapter → filed as CR-3. Multi-language via tree-sitter and
rename reconciliation remain out of scope.

## Follow-ups

- CR-3: optional AI grading adapter (the comprehension half of the reveal).
