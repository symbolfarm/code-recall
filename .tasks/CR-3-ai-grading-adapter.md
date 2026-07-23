# CR-3: Optional AI grading adapter

**Status:** todo (open) · **Priority:** high · **Blocked by:** none
**Prerequisite (soft):** run a guided pass (CR-2) on a real codebase first, so
the adapter is shaped by where the structural-only reveal actually falls short.

## Why

The recall loop today reveals *structural* facts only (signature, containment
count, source location) and never grades the learner's free-text answer — a
deliberate CR-1 decision. That verifies recall of **where things live and how
they connect**, but cannot tell the learner whether they understood **what the
code does**. For a pre-release comprehension review (the retention-bench use
case), that behavioural gap is exactly the high-value part. This adapter fills
it: it grades the learner's free-text recall against the real source and asks
one targeted follow-up.

Framing (agreed with Toby, 2026-07-22): a recall tool is a *comprehension
audit*, and this adapter is the highest-leverage remaining feature for the
"understanding" half. Approved as an opt-in fast-follow.

## Requirements

1. **Opt-in, OFF by default.** Gated behind a setting (e.g.
   `codeRecall.ai.enabled`, default `false`). With it off, behaviour is
   byte-identical to today's structural reveal. The shipped extension stays
   pure/local by default; the user flips it on for their own pass. This
   preserves the privacy boundary and the deterministic, AI-free core.

2. **Separate from graph construction.** The indexer stays AI-free and
   deterministic. The adapter consumes an explicit, already-selected component
   (the current recall node) — it never participates in indexing. (Honours the
   README privacy boundary and the CR-1 architectural-layer decision.)

3. **Grade against real source.** On a recall, after the learner submits their
   free-text answer, send to a model: the node's actual source text, its
   signature, and containment — plus the learner's answer. Get back (a) a brief
   assessment of what they got right / missed / got wrong *relative to the
   source*, and (b) one targeted follow-up question. Show this alongside the
   deterministic reveal.

4. **Self-rating stays the source of truth.** The AI does NOT auto-set the
   Again/Hard/Good/Easy rating or drive scheduling — it assists the learner's
   own judgement. This keeps the "free-text is intentionally not auto-graded"
   ethos; the model is a study partner, not an examiner.

5. **Provider = VS Code Language Model API** (`vscode.lm.selectChatModels`) as
   the default backend: no API-key management, uses the user's existing model
   access. **Graceful degradation:** if no language model is available, fall
   back to the structural-only reveal with a one-time notice — never break the
   review loop. Leave a clean seam for a future settings-configured API-key
   backend (e.g. Anthropic direct); do not build that now.

6. **Privacy disclosure.** When the backend is remote, the component's source
   and the learner's answer leave the machine. The setting description must say
   so plainly. Default stays local/off.

## Implementation notes / dependencies

- **Source extraction.** The adapter needs the node's real source text. The TS
  path already stores char offsets (`location.start/end`); the Python path
  currently sets `start/end = 0` (see `src/pythonIndexer.ts`). The Python
  extractor already computes `endLine` but discards it — store an end line (or
  real offsets) so the adapter can slice `[location.line, endLine]` from the
  file. This is the one indexing-side change required.
- **Testability.** The live model call isn't headless-testable, but source
  extraction, prompt assembly, and the degrade path should be pure and unit
  tested. Put the model call behind an injectable interface so tests cover
  assembly without a network/model.
- Likely new module `src/aiAdapter.ts`; `runRecall` in `src/extension.ts` grows
  an optional "if enabled, grade" step between answer submission and the reveal.

## Acceptance criteria

- Setting off → behaviour identical to current structural reveal (regression-safe).
- Setting on + model available → after answering, learner sees a source-grounded
  assessment + one follow-up, then self-rates as today.
- Setting on + no model → one-time graceful notice, structural fallback, loop intact.
- Indexer remains AI-free; no network calls during indexing.

## Out of scope

Auto-scoring / auto-rating; embeddings or semantic search; any AI use inside
graph construction; the API-key backend (seam only).
