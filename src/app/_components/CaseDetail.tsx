import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getCaseView, type ActionKind } from "@/service/caseService";
import { getAppContext } from "@/service/context";
import type { FindingView } from "@/service/findingView";
import { ClarificationPanel } from "./ClarificationPanel";
import { StatusBadge } from "./StatusBadge";
import { SubmitButton } from "./SubmitButton";
import {
  replaceDocumentAction,
  rerunValidationAction,
} from "../cases/[caseId]/actions";

/**
 * The case page, in three levels of detail:
 *  1. Decision summary: client, case ID, status, main issue, next step, actions.
 *  2. Evidence: each finding with the conflicting values side by side.
 *  3. Audit trail: run history and step details, collapsed by default.
 */
export async function CaseDetail({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  await connection();
  const view = await getCaseView(getAppContext(), caseId);
  if (!view) notFound();

  const emphasis = (a: ActionKind): "primary" | "secondary" =>
    view.primaryAction === a ? "primary" : "secondary";

  return (
    <>
      {/* 1. Decision summary */}
      <section className="card summary" aria-labelledby="case-title">
        <div className="summary-head">
          <div>
            <h1 id="case-title">{view.clientName}</h1>
            <p className="meta">
              Case ID <span className="mono">{view.caseId}</span> · {view.caseType}
            </p>
          </div>
          <StatusBadge status={view.status} />
        </div>

        <div className="issue">
          <h2 className="eyebrow">Main issue</h2>
          {view.mainIssue ? (
            <>
              <p className="issue-title">{view.mainIssue.title}</p>
              <p>{view.mainIssue.explanation}</p>
            </>
          ) : (
            <p className="issue-title">
              {view.status === null ? "This case has not been checked yet." : "No open issues."}
            </p>
          )}
          <p className="next-step">
            <strong>Recommended next step:</strong> {view.nextStep}
          </p>
        </div>

        {view.notices.map((n) => (
          <p key={n} className="notice" role="status">
            {n}
          </p>
        ))}

        <div className="actions" aria-label="Actions">
          {view.replace.available && (
            <div className="action">
              <form action={replaceDocumentAction}>
                <input type="hidden" name="caseId" value={view.caseId} />
                <SubmitButton variant={emphasis("replace")} pendingLabel="Replacing…">
                  Replace document
                </SubmitButton>
              </form>
              <p className="hint">{view.replace.description}</p>
            </div>
          )}
          <div className="action">
            <form action={rerunValidationAction}>
              <input type="hidden" name="caseId" value={view.caseId} />
              <SubmitButton variant={emphasis("rerun")} pendingLabel="Checking…">
                {view.rerunLabel}
              </SubmitButton>
            </form>
            <p className="hint">Checks every current document again and records a new run.</p>
          </div>
          {view.clarification && (
            <ClarificationPanel
              subject={view.clarification.subject}
              body={view.clarification.body}
              emphasized={view.primaryAction === "clarify"}
            />
          )}
        </div>

        {view.runSummary.length > 0 && (
          <div className="history-strip">
            <h2 className="eyebrow">Check history</h2>
            <ul>
              {view.runSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 2. Evidence */}
      <section className="card" aria-labelledby="findings-title">
        <h2 id="findings-title">What we found</h2>
        {view.findings.length === 0 ? (
          <p className="muted">
            {view.status === null
              ? "Nothing to show until the case is checked."
              : "No issues were found in the documents checked."}
          </p>
        ) : (
          <div className="findings">
            {view.findings.map((f) => (
              <FindingCard key={f.key} finding={f} />
            ))}
          </div>
        )}

        <h3 className="eyebrow docs-title">Documents reviewed</h3>
        {view.documents.length === 0 ? (
          <p className="muted">No documents received yet.</p>
        ) : (
          <ul className="docs">
            {view.documents.map((d) => (
              <li key={`${d.name}-${d.filename}`}>
                <strong>{d.name}</strong> · version {d.currentVersion}
                <span className="muted"> · {d.filename}</span>
                {d.earlierVersions > 0 && (
                  <span className="muted">
                    {" "}
                    (replaces {d.earlierVersions === 1 ? "an earlier version" : `${d.earlierVersions} earlier versions`}, which {d.earlierVersions === 1 ? "is" : "are"} kept)
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Audit trail */}
      <details className="card audit">
        <summary>
          Audit trail <span className="muted">({view.runs.length} {view.runs.length === 1 ? "run" : "runs"})</span>
        </summary>
        <ol className="runs">
          {view.runs.map((r) => (
            <li key={r.runId} className="run">
              <div className="run-head">
                <strong>Run {r.number}</strong>
                <span className="muted">{r.when}</span>
                <StatusBadge status={r.status} label={r.statusLabel} />
              </div>
              <p>{r.headline}</p>
              <p className="muted">Documents used: {r.documents.join(", ") || "none"}</p>
              <details className="steps-box">
                <summary>Show steps</summary>
                <ol className="steps">
                  {r.steps.map((s) => (
                    <li key={s.number}>
                      <div className="step-line">
                        <span>
                          {s.number}. {s.label}
                        </span>
                        <span className={s.outcome === "Failed" ? "step-failed" : "muted"}>
                          {s.outcome} · {s.duration}
                        </span>
                      </div>
                      <details className="tech">
                        <summary>Technical details</summary>
                        {s.technical.error && <p className="step-failed">Error: {s.technical.error}</p>}
                        <pre>{`Input\n${s.technical.input}\n\nOutput\n${s.technical.output}`}</pre>
                      </details>
                    </li>
                  ))}
                </ol>
                {r.failureNote && (
                  <details className="tech">
                    <summary>Why this run did not finish</summary>
                    <pre>{r.failureNote}</pre>
                  </details>
                )}
              </details>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}

function FindingCard({ finding: f }: { finding: FindingView }) {
  const tone = f.severity === "BLOCKING" ? "blocking" : f.severity === "ATTENTION" ? "attention" : "info";
  return (
    <article className={`finding finding-${tone}`}>
      <header>
        <span className={`pill pill-${tone}`}>{f.severityLabel}</span>
        <h3>{f.title}</h3>
      </header>
      <p>{f.explanation}</p>
      {f.sides.length > 0 && (
        <div className="compare" role="group" aria-label="Side-by-side comparison">
          {f.sides.map((s, i) => (
            <div key={`${s.document}-${i}`} className="side">
              <p className="side-doc">
                {s.document}
                {s.version && <small> · {s.version}</small>}
              </p>
              <p className="side-label">{s.label}</p>
              <p className="side-value">{s.value}</p>
              {s.quote && <p className="side-quote">From the document: “{s.quote}”</p>}
            </div>
          ))}
        </div>
      )}
      <p className="rec">
        <strong>Recommended action:</strong> {f.recommendation}
      </p>
    </article>
  );
}
