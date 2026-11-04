import { formatGoldenTable, runGoldenEval } from "./golden";

// `npm run eval`: run the golden fixtures through runCase and print a table.
async function main() {
  const rows = await runGoldenEval();
  console.log(formatGoldenTable(rows));
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`\n${rows.length - failed}/${rows.length} passed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
