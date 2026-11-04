import type { CaseSnapshot, Finding } from "@/domain/schemas";
import { checkDocumentCompleteness } from "./completeness";
import { validateConsistency } from "./consistency";
import type { ValidationOptions } from "./shared";

export type { ValidationOptions } from "./shared";

/**
 * All deterministic checks in pipeline order: completeness first
 * (`check_document_completeness`), then consistency (`run_validators`).
 * Pure: no I/O, no model calls, no mutation of the input.
 */
export function validateCase(
  snapshot: CaseSnapshot,
  options: ValidationOptions = {},
): Finding[] {
  return [
    ...checkDocumentCompleteness(snapshot, options),
    ...validateConsistency(snapshot, options),
  ];
}
