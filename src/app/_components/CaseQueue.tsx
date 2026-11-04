import Link from "next/link";
import { connection } from "next/server";
import { getCaseQueue } from "@/service/caseService";
import { getAppContext } from "@/service/context";
import { StatusBadge } from "./StatusBadge";

/** Reads the database, so it renders at request time (inside <Suspense>). */
export async function CaseQueue() {
  await connection();
  const { items, counts } = await getCaseQueue(getAppContext());

  return (
    <>
      <ul className="counts" aria-label="Cases by status">
        <li className="count count-blocked">
          <span className="count-number">{counts.blocked}</span> Blocked
        </li>
        <li className="count count-attention">
          <span className="count-number">{counts.needsAttention}</span> Needs attention
        </li>
        <li className="count count-ready">
          <span className="count-number">{counts.ready}</span> Ready for review
        </li>
        {counts.unchecked > 0 && (
          <li className="count count-none">
            <span className="count-number">{counts.unchecked}</span> Not checked yet
          </li>
        )}
      </ul>

      {items.length === 0 ? (
        <p className="empty">
          {"No cases yet. Load the sample cases with the seed command (npm run seed), then refresh."}
        </p>
      ) : (
        <ol className="queue">
          {items.map((c) => (
            <li key={c.caseId}>
              <Link href={`/cases/${encodeURIComponent(c.caseId)}`} className="queue-row">
                <span className="queue-client">
                  <strong>{c.clientName}</strong>
                  <small className="mono">{c.caseId}</small>
                </span>
                <span className="queue-type">{c.caseType}</span>
                <span className="queue-status">
                  <StatusBadge status={c.status} />
                </span>
                <span className="queue-issue">{c.mainIssue}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
