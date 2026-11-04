# IMPLEMENTATION PLAN

Smallest sequence to a working end-to-end demo. Each step ends in something runnable and checkable. Steps 1–6 are **Milestone A** (vertical slice: clean case + one date conflict, no LLM needed to run). Steps 7–10 complete the **MVP**.

**Status semantics:** `BLOCKED` = known defect, cannot reach attorney sign-off until resolved. `NEEDS_ATTENTION` = uncertainty, a human must confirm or resolve first. `READY_FOR_REVIEW` = no open findings, eligible for attorney review. Material employment-date conflict, name/DOB mismatch and missing required document → `BLOCKED`; low-confidence extraction and ambiguous match → `NEEDS_ATTENTION`.

**Cross-cutting rules:** (1) Required-document completeness is deterministic code, never an LLM. (2) Trace steps carry `kind`: fixed pipeline events are `workflow`; only LLM-selected invocations are `agent`. (3) One runner (`runCase`) serves the app and the eval; no duplicate implementation.

## Dependencies (each justified)
- `next`, `react`, `typescript`: required stack.
- `drizzle-orm`, `better-sqlite3`, `drizzle-kit`: required storage stack; `drizzle-kit` only for schema push.
- `zod`: required structured validation.
- `@anthropic-ai/sdk`: the model calls (extraction, decision, drafting, judge).
- `vitest`: test runner. Needed for the quality gates; `tsx` to run the eval CLI. No other libraries (no agent framework, no UI kit, no queue, no ORM beyond Drizzle).

## Layout
```
src/
  domain/        types + Zod schemas (case, document, finding, step, run)
  validators/    pure deterministic functions + status derivation
  repo/          CaseRepository interface; sqlite/ (Drizzle adapter + schema)
  llm/           client wrapper: live | replay modes, cost calc, model roles
  agent/         runCase (single runner), tools, decision point
  eval/          runner, metrics, judge, feedback, report
  app/           Next.js routes + pages
fixtures/        clean.json, date-conflict.json, missing-doc.json (+ replacement docs)
recordings/      replayed LLM responses (committed)
```

## Sequence

### Milestone A — vertical slice

**1. Scaffold and domain types**
Create the Next.js + TS (strict) project and add the dependencies above. Define Zod schemas/types for `Case`, `DocumentVersion`, `ExtractedField`, `Finding`, `Step`, `Run`.
*Done when:* `tsc --noEmit` passes.

**2. Fixtures (clean + date-conflict)**
Write the two JSON fixtures with document text, expected status/findings/tool path, and the replacement document for the date conflict. Add the fixture loader that validates with Zod.
*Done when:* loader test passes (F1, F5).

**3. Deterministic validators and status derivation**
Implement identity, employment-date (tolerance-based materiality), employer-match, low-confidence and required-document checks, plus the status function and attorney-eligibility helper. Table-driven tests. Validators consume pre-extracted data, so no LLM is needed. A fixtures test applies `validateCase` + `deriveStatus` to both fixtures and asserts expected status and findings (the first form of K1).
*Done when:* C1–C9 tests and K1 (deterministic form) pass.

**4. Repository interface + SQLite adapter**
Define `CaseRepository`: create/get cases; add document version; start run, append step, complete run; save findings; list runs. No update/delete for completed runs. Drizzle schema, `drizzle-kit push` for the dev DB, and a seed command loading fixtures.
*Done when:* A1–A4, A6 tests pass against in-memory SQLite.

**5. Agent runner (no LLM yet)**
Implement `runCase`: the step-recording runner (timing, cost, errors, step cap) with the fixed workflow tools `extract_document` (initially reading pre-baked extraction from the fixture), `run_validators`, `finalize_case`, recorded as `kind: "workflow"`. This is the only runner; the app and the eval both call it (D8).
Add the **minimal eval assertion** (K1): a test runs the `clean` and `date-conflict` fixtures through `runCase` and asserts status, findings, and workflow tool path.
*Done when:* K1 passes via `runCase` and D1–D5, D8, F2, F3 pass.

**6. Minimal UI slice**
Pages: case list, case detail (status, findings + evidence, run history, step trace). Route handlers: run case, replace document, revalidate. Wire "replace document → revalidate" for the date-conflict case.
*Done when:* demo flow works by hand: select date-conflict case → Run 1 is `BLOCKED` because of an employment-date conflict, with evidence from both documents → replace the conflicting document → Run 2 is `READY_FOR_REVIEW` → Run 1 and its findings/trace remain available and unchanged (G1–G3, G5, A5, I3).

### Milestone B — complete MVP

**7. LLM client and real extraction**
Wrapper with `live`/`replay` modes (hash-keyed recordings), cost from token usage, and model roles (`extraction` → small model, `judgment` → stronger model). Replace the pre-baked extraction with Haiku-class calls parsed by Zod (one retry, then low-confidence finding). Record the responses for all fixtures.
*Done when:* fixtures pass in replay offline with identical output (B1–B3, D7).

**8. Missing-doc fixture and the decision point**
Add the `missing-doc` fixture. Missing-ness is already detected deterministically by the validators. Implement `decide_missing_document` (judgment model, Zod output, the only `kind: "agent"` step) and `draft_clarification`. Optionally add bounded fuzzy employer matching (judgment model) feeding validators as an input. Store the draft on the run. Show the draft in the UI ("request clarification", G4).
*Done when:* E1–E4 and F4 pass; status stays `BLOCKED`.

**9. Eval harness and metrics**
Extend the Milestone A assertion into a CLI that runs all fixtures through the same `runCase` (D8) in replay mode, against a separate database, and prints the per-run and aggregate metrics (H1–H3). Expected-vs-actual comparison logic is unit tested, including empty-set recall/precision.
*Done when:* `npm run eval` reports all-pass on the three fixtures. Mutate one validator to confirm the report flags the failure.

**10. Judge and human feedback**
Judge prompt for the clarification draft (clear / polite / right document) → `pass|fail|unsure` + reason. Feedback storage (append-only) and a tiny UI/CLI to mark agree/disagree on findings and judge verdicts. Report judge-human agreement and unsure queue (H4–H8).
*Done when:* with a few seeded human labels, the report shows agreement and the unsure count.

Final check: run the I-gates (typecheck, tests, e2e) and the manual demo script.

## Order rationale
Deterministic core first (3–5) means the riskiest correctness logic is tested before any model enters. The vertical slice (6) is demoable with zero API cost. LLMs arrive in 7–8, behind replay, so tests stay offline and free.

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| LLM extraction flakiness breaks evals | Replay recordings; Zod validation with retry; low-confidence finding as the fallback path. |
| Scope creep into real documents/uploads | Fixtures supply text; J1 is explicitly deferred. |
| Judge looks authoritative but is uncalibrated | `unsure` escalates to humans; agreement metric tracks trust. |
| Storage lock-in | A6 import-boundary check. |

## Progress
Plan approved with the corrections above. Steps 1–3 are in progress; the UI, SQLite adapter, and LLM integration are not started.
