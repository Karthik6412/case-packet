import { z } from "zod";
import { DocumentTypeSchema, VisaCategorySchema } from "./schemas";

/**
 * The draft packet assembled for attorney review. It is a deterministic view of
 * the case's current documents and their extracted facts. Values that were
 * unreadable or low confidence are null here rather than presented as facts;
 * the findings explain why.
 */
export const PacketSchema = z.object({
  caseId: z.string().min(1),
  clientName: z.string().min(1),
  visaCategory: VisaCategorySchema,
  identity: z.object({
    fullName: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    passportNumber: z.string().nullable(),
  }),
  documents: z.array(
    z.object({
      documentId: z.string(),
      type: DocumentTypeSchema,
      version: z.number().int().min(1),
      filename: z.string(),
      contentHash: z.string(),
    }),
  ),
  /** One entry per job claimed on the resume, with the documents that support it. */
  employmentHistory: z.array(
    z.object({
      employerName: z.string(),
      jobTitle: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      supportingDocuments: z.array(
        z.object({
          documentId: z.string(),
          type: DocumentTypeSchema,
          version: z.number().int().min(1),
        }),
      ),
    }),
  ),
  /** True when no required document is missing. Says nothing about correctness. */
  complete: z.boolean(),
  findingCounts: z.object({
    blocking: z.number().int().min(0),
    attention: z.number().int().min(0),
    info: z.number().int().min(0),
  }),
});
export type Packet = z.infer<typeof PacketSchema>;
