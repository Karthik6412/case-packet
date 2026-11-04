# ACCEPTANCE CRITERIA

Each criterion is testable. `[MVP]` must pass for the demo. `[DEFER]` is out of scope for now. IDs are stable for referencing in tests.

## A. Data model and history

- **A1 [MVP]** A case has one `caseId` for its lifetime. Every run row references it, and no operation changes a case's ID.
- **A2 [MVP]** Each execution creates a new `runId`. After N revalidations the case has exactly N+1 runs, and all are retrievable.
- **A3 [MVP]** Runs are append-only: no repository method updates or deletes a completed run, its steps, or its findings. (Test: the repository interface exposes no such methods.)
- **A4 [MVP]** Documents are versioned. Replacing a document inserts version N+1 and leaves version N's content and hash unchanged. Each run records which document versions it used.
- **A5 [MVP]** After replace + revalidate, the earlier run still shows its original findings and status, and the new run shows updated ones.
- **A6 [MVP]** All persistence goes through the `CaseRepository` interface. No module outside the adapter imports Drizzle or better-sqlite3. (Test: lint/import check.)

## B. Extraction

- **B1 [MVP]** Extraction uses the small model only, and output is parsed with a Zod schema. Schema failure triggers one retry, then an `EXTRACTION_LOW_CONFIDENCE` finding, and never a crash.
- **B2 [MVP]** Each extracted field carries a value, a confidence, and a source snippet (evidence).
- **B3 [MVP]** In replay mode, extraction for all fixtures runs offline and returns identical output on repeat runs.

## C. Deterministic validation

- **C1 [MVP]** Validators are pure functions: same extracted data in, same findings out, with no network or model calls. (Test: run with the LLM client stubbed to throw; validation still passes.)
- **C2 [MVP]** Name comparison normalizes case, diacritics, and whitespace. "JOSÉ  Garcia" equals "Jose Garcia". A different surname yields `IDENTITY_MISMATCH`.
- **C3 [MVP]** Employment-date tolerance, for each pair of sources for the same employer (start dates, and end dates when both exist): difference 0 days → no finding; 1–7 days → one `EMPLOYMENT_DATE_DISCREPANCY` (INFO) ; more than 7 days → one blocking `EMPLOYMENT_DATE_CONFLICT`. Both finding types carry both source values and provenance (documentId, version, field, snippet) and state the delta in days. Boundaries 0, 1, 7 and 8 days are tested. INFO never changes status. A discrepancy is never silently dropped.
- **C4 [MVP]** Required documents (EB-2): resume, passport, sponsor offer letter, and one employment verification letter per claimed job on the resume. Each absent one yields one blocking `MISSING_REQUIRED_DOCUMENT`. Payroll records are optional: their absence yields no finding. This is decided by deterministic code only; no LLM is consulted for completeness.
- **C4a [MVP]** A claimed job with no EVL and no unmatched EVL → `MISSING_REQUIRED_DOCUMENT` (evidence cites the resume claim and the absent document type). A claimed job and an EVL that cannot be paired by normalized employer name, or an EVL whose employer is not on the resume → `AMBIGUOUS_EMPLOYER_MATCH` and not a missing-document finding.
- **C5 [MVP]** Every finding includes ≥1 evidence reference (documentId, version, field, value, snippet; plus the job index for resume claims).
- **C6 [MVP]** Status derivation: any blocking finding → `BLOCKED`; else any attention finding → `NEEDS_ATTENTION`; else `READY_FOR_REVIEW`; INFO is ignored. Mapping by finding type: material employment-date conflict, name/DOB mismatch, and missing required document → `BLOCKED`; low-confidence extraction and ambiguous employer match → `NEEDS_ATTENTION`; minor date discrepancy → no status change. Covered by a table-driven test with all combinations.
- **C7 [MVP]** A required field that is missing or below the confidence threshold (default 0.7, a prototype heuristic) yields one `EXTRACTION_LOW_CONFIDENCE`, and that field is excluded from cross-document comparison so it does not also yield a conflict. An optional field with a value below the threshold also yields one.
- **C8 [MVP]** Employer names that normalize equal (case, punctuation, corporate suffixes such as Inc/Ltd/Limited) pair a claimed job with an EVL; see C4a for the unpaired cases.
- **C9 [MVP]** Only `READY_FOR_REVIEW` is eligible for attorney sign-off; `BLOCKED` and `NEEDS_ATTENTION` are not. (Eligibility is a pure function; no approval action exists, see D6.)
- **C10 [MVP]** LLM use is bounded: the LLM may only resolve semantic matches (e.g., claimed job to verification letter) or draft clarifications. It cannot add or remove a finding or set a status.

## D. Agent harness and trace

- **D1 [MVP]** The pipeline is a fixed workflow: `extract_document` (per document) → `check_document_completeness` → `run_validators` → `finalize_case`, with `draft_clarification` added after validation when completeness findings exist (Milestone B). There is no approval tool and no LLM-selected tool.
- **D2 [MVP]** Every executed event is persisted as a step with: `kind` (`workflow` | `agent`), name, input, output, startedAt, durationMs, costUsd (0 for non-LLM steps), and error if any. Steps have an ordered index within the run.
- **D2a [MVP]** All pipeline steps are `kind: "workflow"`, including LLM-backed ones (extraction, drafting). `kind: "agent"` is reserved for actual model-selected tool calls, of which the MVP has none. The expected path in fixtures records kind alongside name.
- **D3 [MVP]** Step records are those actually executed. A run's steps are never synthesized after the fact.
- **D4 [MVP]** The harness enforces a max step count (default 20). Exceeding it ends the run as failed with a recorded reason.
- **D5 [MVP]** Run→steps serializes to JSON matching the documented trace shape (`run{id, caseId, startedAt, durationMs, totalCostUsd, steps[]}`). A schema test validates this.
- **D6 [MVP]** The agent cannot set a status. Status is computed by deterministic code from findings. Attempting to record approval anywhere is impossible by interface (no such field or method).
- **D7 [MVP]** Model use: extraction steps record the small model ID; `draft_clarification` records the stronger model ID.
- **D8 [MVP]** One runner implementation (`runCase`) serves both the application and golden-data evaluation. The eval imports and calls it; there is no eval-only copy of the pipeline. Differences are limited to injected dependencies (repository instance, LLM mode). (Test: the eval and the API route reference the same function.)

## E. Document completeness and clarification

- **E1 [MVP]** `check_document_completeness` is a `workflow` step recorded on every run, between extraction and `run_validators`. Its output is the deterministic list of completeness findings (missing documents and unpaired employer matches). There is no `decide_missing_document` step and no LLM choice about whether to request a document.
- **E2 [MVP-B]** When completeness findings exist, a `draft_clarification` workflow step (stronger model) follows validation and the draft is stored on the run. When none exist, no draft step is recorded.
- **E3 [MVP]** The status is `BLOCKED` while a required document is missing, regardless of any draft.

## F. Fixtures and expected outcomes

- **F1 [MVP]** Fixture format is JSON validated by Zod: case metadata, documents (type, text), expected status, expected findings (type + evidence fields), expected tool path.
- **F2 [MVP]** `clean` → `READY_FOR_REVIEW`, zero findings. Resume claims two jobs, each with a matching EVL; passport and sponsor offer letter present. Workflow path: extract×N → check_document_completeness → run_validators → finalize_case.
- **F3 [MVP]** `date-conflict` → `BLOCKED`, exactly one `EMPLOYMENT_DATE_CONFLICT` between the resume claim and the EVL, with evidence from both documents, same workflow path. The fixture includes a corrected replacement resume (version 2); after replacement and revalidation the new run is `READY_FOR_REVIEW` with zero findings.
- **F4 [MVP-B]** `missing-doc` → `BLOCKED`, one `MISSING_REQUIRED_DOCUMENT` (an EVL for a claimed job), path includes `check_document_completeness` and `draft_clarification`.
- **F5 [MVP]** All fixture data is synthetic and contains no real personal data.

## G. UI behaviors

- **G1 [MVP]** Case list shows each case's ID, name, and latest status.
- **G2 [MVP]** Case detail shows: status badge, findings list, evidence per finding, run history, and the step trace of the selected run.
- **G3 [MVP]** "Run" starts a run and displays the result without a manual refresh.
- **G4 [MVP]** "Request clarification" shows the stored draft for the latest run (if any) and records that the paralegal reviewed it. Nothing is sent externally.
- **G5 [MVP]** "Replace document" offers the fixture's replacement version, creates version N+1, and prompts to revalidate. Revalidating creates a new run (A2, A5).
- **G6 [MVP]** No UI control or API route approves a case. The UI states that attorney approval is a separate step.
- **G7 [MVP]** Failed runs display the failure reason, and the case keeps its previous status.

## H. Evaluation harness

- **H1 [MVP]** The `eval` script runs every fixture through the same `runCase` used by the application (D8), in replay mode, and exits non-zero if any run crashes.
- **H2 [MVP]** Per-run report: status match (bool), findings match (exact set of type+key evidence), expected tool-path match (ordered tool-name sequence equality), finding **recall** and **precision** (both defined as 1.0 when expected/actual sets are empty and equal), step count, latency (ms), cost (USD).
- **H3 [MVP]** Aggregate report: pass rates per metric, mean recall/precision, and mean/total latency and cost.
- **H4 [MVP]** The LLM judge grades only clarification drafts, on: clear, polite, asks for the right document. The output label is `pass` | `fail` | `unsure`, with a short reason. The judge is never used for status or findings.
- **H5 [MVP]** `unsure` verdicts are queued for human review and are excluded from automatic pass/fail counts, but reported separately.
- **H6 [MVP]** Human feedback: a person can record `agree` | `disagree` on (a) each finding and (b) each judge verdict. Feedback is stored with a timestamp and is append-only.
- **H7 [MVP]** The report includes judge-human agreement = agreements / (human-labeled non-unsure judge verdicts), plus the count of labeled items. It prints "n/a" when there are none.
- **H8 [MVP]** The judge's model is the stronger model, and its calls are recorded with cost and are replayable.

## I. Quality gates

- **I1 [MVP]** `tsc --noEmit` passes with `strict`.
- **I2 [MVP]** Unit tests cover validators (C), status derivation (C6), repository immutability (A3, A4), and trace shape (D5).
- **I3 [MVP]** One end-to-end test runs the fixture flow: run `date-conflict` (Run 1: `BLOCKED`, evidence from both documents) → replace the conflicting document → revalidate (Run 2: `READY_FOR_REVIEW`) → assert two runs, document v2, and that Run 1's findings and trace are unchanged (deep-equal to a snapshot taken before replacement).

## K. Milestone A minimal evaluation assertion

- **K1 [MVP-A]** From the first working runner onward, an automated test runs the `clean` and `date-conflict` fixtures through `runCase` and asserts, per fixture: final status equals expected, finding set (type + evidence documents) equals expected, and the ordered workflow tool path equals expected. Before the runner exists (steps 1–3), the same assertions run against the deterministic pipeline (`checkDocumentCompleteness` + `validateConsistency` via `validateCase`, then `deriveStatus`) over the fixtures' pre-extracted data.
- **K2 [MVP-A]** The full metrics report (recall/precision, latency, cost, dashboard) and the LLM judge are not required in Milestone A (see H).

## J. Explicitly deferred

- **J1 [DEFER]** Real file upload or OCR.
- **J2 [DEFER]** Sending clarification messages.
- **J3 [DEFER]** Langfuse/Phoenix exporter (only shape compatibility is required, via D5).
- **J4 [DEFER]** Auth and multi-user concurrency.
- **J5 [DEFER]** Postgres adapter (only the interface boundary, via A6).
