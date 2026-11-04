import type { CaseStatus } from "@/domain/schemas";
import { STATUS_LABEL } from "@/service/format";

const TONE: Record<CaseStatus, string> = {
  BLOCKED: "blocked",
  NEEDS_ATTENTION: "attention",
  READY_FOR_REVIEW: "ready",
};

const ICON: Record<CaseStatus, string> = {
  BLOCKED: "■",
  NEEDS_ATTENTION: "▲",
  READY_FOR_REVIEW: "●",
};

/** Status is always text plus a shape, never colour alone. */
export function StatusBadge({ status, label }: { status: CaseStatus | null; label?: string }) {
  const tone = status ? TONE[status] : "none";
  return (
    <span className={`badge badge-${tone}`}>
      <span aria-hidden="true">{status ? ICON[status] : "○"}</span>
      {label ?? (status ? STATUS_LABEL[status] : "Not checked yet")}
    </span>
  );
}
