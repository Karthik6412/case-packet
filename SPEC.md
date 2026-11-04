# SPEC — Case Packet Assembly & Validation

A practice project: a paralegal prepares employment-based immigration case packets for attorney review. All data is synthetic. Implementation status is tracked in IMPLEMENTATION_PLAN.md.

## 1. Problem and user

**User:** a paralegal assembling a packet (resume, passport, sponsor offer letter, employment verification letters, optional payroll records) before an attorney reviews it.
**Pain:** manual cross-checking of names, dates, and required-document lists is slow and error-prone.
**Goal:** an agent assembles and validates the packet, reports what is wrong with evidence, and drafts the follow-up. A human attorney decides on approval, and the agent never does.

## 2. User journey

1. **Select** a synthetic case from a list (fixture-backed).
2. **Run** extraction and assembly. The agent extracts fields from each document, then builds the packet.
3. **Validate** identity consistency, employment dates, and required-document completeness. This is deterministic code.
4. **View** case status (`BLOCKED` / `NEEDS_ATTENTION` / `READY_FOR_REVIEW`), findings, and the evidence behind each finding (document, field, extracted value, source snippet).
5. **Act**: request clarification (LLM-drafted message) or replace a document (new immutable version).
6. **Revalidate**: a new run is created on the same case. Previous runs and document versions remain intact and viewable.

Attorney approval is a separate human step. The system only ever marks a case `READY_FOR_REVIEW` (eligible for attorney review). Cases that are `BLOCKED` or `NEEDS_ATTENTION` cannot reach attorney sign-off.

## 3. Core concepts

| Concept | Rule |
|---|---|
| Case | One stable `caseId` for the life of the matter. |
| Run | One execution of the agent on a case. Each run has its own `runId`. Runs are append-only. |
| Document version | Immutable. Replacing a document adds version N+1 and never mutates N. |
| Finding | A validation result with type, severity, message, and evidence references. Produced only by deterministic validators. |
| Status | Derived from the findings of the latest completed run (see §5). |
| Step / trace | Each executed event is recorded as a step: kind, name, input, output, timing, cost. `kind` is `workflow` (fixed, code-ordered pipeline event) or `agent` (an invocation selected by an LLM). A run is an ordered list of steps. |

## 4. Architecture decisions

- **Stack:** Next.js + TypeScript, SQLite via Drizzle + better-sqlite3, Zod, JSON fixtures.
- **Repository interface:** all persistence goes through a `CaseRepository` interface (cases, documents, runs, steps, findings, feedback). The Drizzle/SQLite implementation is one adapter, so Postgres can replace it without touching the agent or UI.
- **Deterministic vs LLM split:**
  - LLM, small model (Haiku-class): field extraction from document text into Zod-validated structures.
  - Code only: validation, status derivation, and required-document completeness. Whether a known required document is missing is never an LLM judgment.
  - LLM, stronger model (Sonnet-class), bounded uses only: semantic reasoning where deterministic matching is insufficient (e.g., fuzzy-matching a claimed job/employer to a verification letter when normalized names differ) and clarification drafting.
  - LLM judge (stronger model): grades clarification drafts in the eval harness only.
- **Workflow vs agent events:** the pipeline is a fixed workflow: `extract_document` (per document) → `check_document_completeness` → `run_validators` → (`draft_clarification` when completeness findings exist, Milestone B) → `finalize_case`. Every one of these is recorded with `kind: "workflow"`, even those that call an LLM internally, and none is presented as an autonomous agent decision. `kind: "agent"` is reserved for actual model-selected tool calls. None exist in the MVP; they arrive only if a future step lets a model choose its own tools.
- **Trace shape:** `run → steps[{ name, input, output, startedAt, durationMs, costUsd, tokens?, error? }]`, structured so it maps onto Langfuse/Phoenix traces and spans later.
- **Agent runner:** a minimal custom runner (~100–200 lines) with typed tools and a step cap; every executed event is recorded. No agent framework. There is exactly one implementation (`runCase`), used unchanged by the application and by golden-data evaluation; evals differ only in injected dependencies (database, LLM mode).
- **Reproducibility:** LLM calls support `live` and `replay` modes. Replay uses recorded responses keyed by hash of (model, prompt, input), so tests and evals run offline and deterministically.

## 5. Validation and status rules

Status semantics:
- `BLOCKED` = known defect; cannot proceed to attorney sign-off until resolved.
- `NEEDS_ATTENTION` = uncertainty; a human must confirm or resolve before sign-off.
- `READY_FOR_REVIEW` = no open blocking or attention findings; eligible for attorney review. `INFO` findings may still be present: they are recorded and shown but do not change status.

### Required documents (EB-2, deterministic)
- **Required:** resume; passport biographical page; sponsor offer letter; **one employment verification letter (EVL) per claimed job** listed on the resume.
- **Optional supporting evidence:** payroll records. Absence is never a finding. When present they are compared like any other source.
- A claimed job is matched to an EVL by normalized employer name (case, punctuation, corporate suffixes). Completeness is code, never an LLM judgment:
  - a claimed job with no EVL, and no unmatched EVL left → `MISSING_REQUIRED_DOCUMENT`;
  - a claimed job and an EVL that cannot be paired by name → `AMBIGUOUS_EMPLOYER_MATCH` (uncertain, not missing);
  - an EVL whose employer is not on the resume → `AMBIGUOUS_EMPLOYER_MATCH`.

### Findings (deterministic)

| Finding type | Severity | Status effect | Trigger |
|---|---|---|---|
| `MISSING_REQUIRED_DOCUMENT` | blocking | `BLOCKED` | A required document (above) is absent. |
| `IDENTITY_MISMATCH` | blocking | `BLOCKED` | Name or date of birth differs across documents beyond normalization (case, diacritics, name order, middle name/initial). |
| `EMPLOYMENT_DATE_CONFLICT` | blocking | `BLOCKED` | Start (or end) dates for the same employer differ by more than 7 days across sources. |
| `EMPLOYMENT_DATE_DISCREPANCY` | info | none | The same dates differ by 1–7 days. Recorded, never discarded. |
| `EXTRACTION_LOW_CONFIDENCE` | attention | `NEEDS_ATTENTION` | A required field is missing or below the confidence threshold, or an optional field has a value but is below it. |
| `AMBIGUOUS_EMPLOYER_MATCH` | attention | `NEEDS_ATTENTION` | See "Required documents". A later step may let the stronger model propose a match; a proposed match is an input to validation, never a status decision. |

Status: any blocking finding → `BLOCKED`; else any attention finding → `NEEDS_ATTENTION`; else `READY_FOR_REVIEW`. `INFO` is ignored for status. Only `READY_FOR_REVIEW` is eligible for attorney sign-off.

### Employment-date tolerance (explicit prototype rules)
Applied to each pair of sources for the same employer (resume job claim, EVL, payroll record), for start dates and, when both sources give one, end dates:

| Difference | Result |
|---|---|
| 0 days | no finding |
| 1–7 days | `EMPLOYMENT_DATE_DISCREPANCY` (INFO), with both source values and their provenance (document, version, field, snippet); status unchanged |
| more than 7 days | `EMPLOYMENT_DATE_CONFLICT` (BLOCKING), with both source values and their provenance |

A discrepancy is never silently discarded. The 7-day boundary is a prototype heuristic.

### Heuristics are not calibrated guarantees
The 0.7 confidence threshold, the 7-day boundary, and the name-matching rule (first and last token) are prototype heuristics chosen for the demo. They are named constants, not calibrated against real data, and production would tune them with attorney-labeled cases.

## 6. Scope: MVP vs deferred vs production

### Must work for the MVP
- Three fixtures: **clean** (→ `READY_FOR_REVIEW`), **employment-date conflict** (→ `BLOCKED`; replacing the conflicting document and revalidating → `READY_FOR_REVIEW`), **missing required document** (→ `BLOCKED`, exercises completeness and the clarification draft).
- A minimal evaluation assertion over the first two fixtures from Milestone A; the full eval dashboard, metrics, and judge follow in Milestone B.
- Extraction with the small model (replayable), deterministic validators, status derivation.
- One Case ID with multiple Run IDs; immutable document versions; full step trace per run.
- Every pipeline event recorded as a `workflow` step, including `check_document_completeness`. No `agent`-kind events are required.
- UI: case list, case detail (status, findings with evidence, run history, trace view), "request clarification" with a drafted message, "replace document" from a fixture-provided replacement version, "revalidate".
- Eval harness over all fixtures with the metrics in ACCEPTANCE_CRITERIA, LLM judge for clarification drafts (pass/fail/unsure), and human agree/disagree feedback with a judge-human agreement report.

### Deferred (not needed for the demo)
- More visa categories and document types beyond the minimum.
- Real OCR/PDF parsing (fixtures supply document text).
- Sending clarification messages (the draft is stored only).
- Trace export to Langfuse/Phoenix (shape is compatible, exporter is not built).
- Concurrency control beyond a single-writer assumption.
- UI polish, pagination, search.

### What would change for production
- Postgres adapter behind the existing repository interface; migrations managed explicitly.
- Authentication, authorization, per-tenant isolation, audit logging, and PII encryption at rest.
- Real file upload, storage, virus scanning, and OCR/parsing pipeline.
- Background job queue for runs; idempotency and retries; rate limiting.
- Attorney-approval workflow as a separate authenticated role and action.
- Real trace export and monitoring; a larger golden dataset built from de-identified real cases; the judge calibrated against attorney labels.
- Data retention and legal-hold policy for runs and document versions.

## 7. Non-goals
Real uploads, auth, deployment infrastructure, extra frameworks or services, any autonomous approval or filing.
