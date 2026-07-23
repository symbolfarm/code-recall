# Tasks

Read this file at the start of each work session, then consult
`.tasks/LOG.jsonl`. Incomplete tasks have a corresponding file in `.tasks/`.

## Current focus

**CR-3 — Optional AI grading adapter** (`.tasks/CR-3-ai-grading-adapter.md`):
the opt-in, off-by-default feature that grades free-text recall against real
source and asks one follow-up — the "understanding" half of the reveal. Soft
prerequisite: run a guided pass first so the adapter is shaped by where the
structural-only reveal falls short.

Shipped so far: CR-1 (deterministic prototype), CR-2 (Python indexing +
guided pass). See `.tasks/LOG.jsonl` for the audit record and
`.tasks/debriefs/` for what each delivered.
