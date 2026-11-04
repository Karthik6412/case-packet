import { runCase } from "@/agent/runCase";
import type { CaseStatus } from "@/domain/schemas";
import { seedFixtureCase } from "@/fixtures/seed";
import type { AppContext } from "./context";

export interface SeedResult {
  caseId: string;
  clientName: string;
  skipped: boolean;
  runNumber: number | null;
  status: CaseStatus | null;
}

/**
 * Load every fixture case and validate it once (Run 1). Cases that already
 * exist are left alone, so this is safe to repeat.
 */
export async function seedDemo(ctx: AppContext): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const fixture of ctx.fixtures) {
    const { caseId, clientName } = fixture.case;
    if (await ctx.repo.getCase(caseId)) {
      results.push({ caseId, clientName, skipped: true, runNumber: null, status: null });
      continue;
    }
    await seedFixtureCase(ctx.repo, fixture);
    const run = await runCase({ caseId }, ctx);
    results.push({
      caseId,
      clientName,
      skipped: false,
      runNumber: run.run.runNumber,
      status: run.caseStatus,
    });
  }
  return results;
}
