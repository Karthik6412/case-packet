import type { CaseStatus, Finding } from "@/domain/schemas";

/**
 * Case status is derived from findings by code, never chosen by an agent.
 *  any BLOCKING finding -> BLOCKED
 *  else any ATTENTION   -> NEEDS_ATTENTION
 *  else                 -> READY_FOR_REVIEW
 */
export function deriveStatus(
  findings: readonly Pick<Finding, "severity">[],
): CaseStatus {
  if (findings.some((f) => f.severity === "BLOCKING")) return "BLOCKED";
  if (findings.some((f) => f.severity === "ATTENTION")) return "NEEDS_ATTENTION";
  return "READY_FOR_REVIEW";
}

/**
 * Only READY_FOR_REVIEW cases are eligible for attorney sign-off. This is an
 * eligibility check only; the system has no approval action.
 */
export function isEligibleForAttorneySignoff(status: CaseStatus): boolean {
  return status === "READY_FOR_REVIEW";
}
