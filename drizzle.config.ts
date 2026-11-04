import { defineConfig } from "drizzle-kit";

// Used only to generate SQL migrations into ./drizzle. The app applies them at
// startup (see src/repo/sqlite/open.ts); nothing here connects to a database.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/repo/sqlite/schema.ts",
  out: "./drizzle",
});
