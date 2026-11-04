import { z } from "zod";
import {
  CaseSchema,
  CaseStatusSchema,
  DocumentVersionSchema,
  ExtractionSchema,
  FindingTypeSchema,
  StepKindSchema,
} from "@/domain/schemas";

/**
 * A fixture document carries its text and a pre-baked extraction. The extraction
 * stands in for the small-model call until LLM integration (plan step 7).
 */
export const FixtureDocumentSchema = DocumentVersionSchema.extend({
  extraction: ExtractionSchema,
});
export type FixtureDocument = z.infer<typeof FixtureDocumentSchema>;

/**
 * Expected finding. documentIds lists the documents it cites; an absent document
 * is written "missing:<DOCUMENT_TYPE>".
 */
export const ExpectedFindingSchema = z.object({
  type: FindingTypeSchema,
  documentIds: z.array(z.string()).min(1),
});
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>;

export const ExpectedOutcomeSchema = z.object({
  status: CaseStatusSchema,
  findings: z.array(ExpectedFindingSchema),
});

export const FixtureSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  case: CaseSchema,
  documents: z.array(FixtureDocumentSchema).min(1),
  expected: ExpectedOutcomeSchema.extend({
    /** Ordered pipeline events a run must record. */
    workflowPath: z.array(
      z.object({ kind: StepKindSchema, name: z.string().min(1) }),
    ),
  }),
  /** A corrected document (version N+1) and the outcome after revalidating with it. */
  replacement: z
    .object({
      document: FixtureDocumentSchema,
      expected: ExpectedOutcomeSchema,
    })
    .optional(),
});
export type Fixture = z.infer<typeof FixtureSchema>;
