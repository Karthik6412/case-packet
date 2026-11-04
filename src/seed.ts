import fs from "node:fs";
import { createAppContext, defaultDbPath } from "@/service/context";
import { seedDemo } from "@/service/seedDemo";

/*
 * `npm run seed`             load the clean and date-conflict fixtures and check each once (Run 1)
 * `npm run seed -- --reset`  delete the demo database first, to start over
 *
 * Skips cases that already exist, so it is safe to run repeatedly.
 */
async function main() {
  const dbPath = defaultDbPath();
  if (process.argv.includes("--reset")) {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });
    console.log(`Removed ${dbPath}`);
  }

  const ctx = createAppContext(dbPath);
  try {
    for (const r of await seedDemo(ctx)) {
      console.log(
        r.skipped
          ? `- ${r.clientName}: already loaded, skipped`
          : `+ ${r.clientName} (${r.caseId}): loaded, Run ${r.runNumber} ${r.status ?? "did not finish"}`,
      );
    }
    console.log(`\nDatabase: ${dbPath}`);
  } finally {
    await ctx.repo.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
