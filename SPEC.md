# SPEC — Case Packet Assembly & Validation

A practice project: a paralegal prepares employment-based immigration case packets for attorney review. All data is synthetic. Documentation only at this stage; nothing is implemented.

## 1. Problem and user

**User:** a paralegal assembling a packet (identity docs, employer letter, pay records, etc.) before an attorney reviews it.
**Pain:** manual cross-checking of names, dates, and required-document lists is slow and error-prone.
**Goal:** an agent assembles and validates the packet, reports what is wrong with evidence, and drafts the follow-up. A human attorney decides on approval, and the agent never does.

## 2. User journey

1. **Select** a synthetic case from a list (fixture-backed).
2. **Run** extraction and assembly. The agent extracts fields from each document, then builds the packet.
3. **Validate** identity consistency, employment dates, and required-document completeness. This is deterministic code.
4. **View** case status (`BLOCKED` / `NEEDS_ATTENTION` / `READY_FOR_REVIEW`), findings, and the evidence behind each finding (document, field, extracted value, source snippet).
5. **Act**: request clarification (agent-drafted message) or replace a document (new immutable version).
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
  - LLM, stronger model (Sonnet-class), bounded uses only: semantic reasoning where deterministic matching is insufficient (e.g., fuzzy-matching a claimed job/employer to a verification letter when normalized names differ), the single agent decision, and clarification drafting.
  - LLM judge (stronger model): grades clarification drafts in the eval harness only.
- **Workflow vs agent events:** the pipeline (extract each document → validate → finalize) is a fixed workflow. Its steps are recorded with `kind: "workflow"` and are never presented as autonomous agent decisions. Only the one LLM-selected invocation below is recorded with `kind: "agent"`.
- **Agent decision point:** when code detects a missing required document, the agent chooses `request_document` or `continue_without`. The choice is recorded as a `kind: "agent"` tool invocation with its rationale.
- **Trace shape:** `run → steps[{ name, input, output, startedAt, durationMs, costUsd, tokens?, error? }]`, structured so it maps onto Langfuse/Phoenix traces and spans later.
- **Agent runner:** a minimal custom runner (~100–200 lines) with typed tools and a step cap; every executed event is recorded. No agent framework. There is exactly one implementation (`runCase`), used unchanged by the application and by golden-data evaluation; evals differ only in injected dependencies (database, LLM mode).
- **Reproducibility:** LLM calls support `live` and `replay` modes. Replay uses recorded responses keyed by hash of (model, prompt, input), so tests and evals run offline and deterministically.

## 5. Validation and status rules

Status semantics:
- `BLOCKED` = known defect; cannot proceed to attorney sign-off until resolved.
- `NEEDS_ATTENTION` = uncertainty; a human must confirm or resolve before sign-off.
- `READY_FOR_REVIEW` = no open findings; eligible for attorney review.

Findings (deterministic):

| Finding type | Severity | Status effect | Trigger |
|---|---|---|---|
| `MISSING_REQUIRED_DOCUMENT` | blocking | `BLOCKED` | A required document type for the case's visa category has no current version. |
| `IDENTITY_MISMATCH` | blocking | `BLOCKED` | Name or date of birth differs across documents beyond normalization (case, diacritics, name order, middle name/initial). |
| `EMPLOYMENT_DATE_CONFLICT` | blocking | `BLOCKED` | Employment start dates in two documents differ by more than the tolerance (default 7 days). Smaller differences are not material and produce no finding. |
| `EXTRACTION_LOW_CONFIDENCE` | attention | `NEEDS_ATTENTION` | A required field is missing or below the confidence threshold (default 0.7). |
| `AMBIGUOUS_EMPLOYER_MATCH` | attention | `NEEDS_ATTENTION` | Employer names differ after normalization and no resolution is available. A later step may let the stronger model propose a match; a proposed match is an input to validation, never a status decision. |

Status: any blocking finding → `BLOCKED`; else any attention finding → `NEEDS_ATTENTION`; else `READY_FOR_REVIEW`. Only `READY_FOR_REVIEW` is eligible for attorney sign-off.

## 6. Scope: MVP vs deferred vs production

### Must work for the MVP
- Three fixtures: **clean** (→ `READY_FOR_REVIEW`), **employment-date conflict** (→ `BLOCKED`; replacing the conflicting document and revalidating → `READY_FOR_REVIEW`), **missing required document** (→ `BLOCKED`, exercises the decision point).
- A minimal evaluation assertion over the first two fixtures from Milestone A; the full eval dashboard, metrics, and judge follow in Milestone B.
- Extraction with the small model (replayable), deterministic validators, status derivation.
- One Case ID with multiple Run IDs; immutable document versions; full step trace per run.
- Agent decision point recorded as a tool invocation.
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
