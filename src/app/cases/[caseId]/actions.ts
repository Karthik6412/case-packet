"use server";

import { revalidatePath } from "next/cache";
import { replaceDocument, rerunValidation } from "@/service/caseService";
import { getAppContext } from "@/service/context";

/*
 * Server Actions are reachable by direct POST, so each one validates its input
 * and loads everything else on the server. The client sends only a case id; it
 * never supplies document content. (This prototype has no sign-in; a real
 * deployment must authenticate and authorize here.)
 */

function caseIdFrom(formData: FormData): string {
  const id = formData.get("caseId");
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new Error("Missing case.");
  }
  return id;
}

function refresh(caseId: string) {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/");
}

/** Add the corrected document as a new version. Does not re-check the case. */
export async function replaceDocumentAction(formData: FormData): Promise<void> {
  const caseId = caseIdFrom(formData);
  await replaceDocument(getAppContext(), caseId);
  refresh(caseId);
}

/** Check the case again; creates a new run and leaves earlier runs as they were. */
export async function rerunValidationAction(formData: FormData): Promise<void> {
  const caseId = caseIdFrom(formData);
  await rerunValidation(getAppContext(), caseId);
  refresh(caseId);
}
