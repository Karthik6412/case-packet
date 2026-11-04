import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");
const ADAPTER_DIR = path.join(SRC, "repo", "sqlite");
const FORBIDDEN = /from\s+["'](drizzle-orm|better-sqlite3)(\/[^"']*)?["']|require\(\s*["'](drizzle-orm|better-sqlite3)/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("storage boundary (A6)", () => {
  it("only src/repo/sqlite imports Drizzle or better-sqlite3", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.startsWith(ADAPTER_DIR + path.sep))
      .filter((f) => FORBIDDEN.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
