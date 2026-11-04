import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export interface OpenOptions {
  /** File path, or ":memory:". Parent directories are created for files. */
  path: string;
  /** Where the generated SQL migrations live. Default: ./drizzle under the cwd. */
  migrationsFolder?: string;
  /** How long a writer waits for a lock before failing, in ms. */
  busyTimeoutMs?: number;
}

export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface Connection {
  sqlite: Database.Database;
  db: Db;
}

/**
 * Open a database with the pragmas this app relies on, then apply migrations.
 *  - busy_timeout: wait for a competing writer instead of failing at once.
 *  - journal_mode=WAL: readers do not block the writer (no-op for :memory:).
 *  - foreign_keys=ON: SQLite ignores foreign keys unless asked, per connection.
 *  - synchronous=NORMAL: the usual, safe companion to WAL.
 */
export function openConnection(options: OpenOptions): Connection {
  if (options.path !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(options.path)), { recursive: true });
  }
  const sqlite = new Database(options.path);
  sqlite.pragma(`busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder:
      options.migrationsFolder ?? path.join(process.cwd(), "drizzle"),
  });
  return { sqlite, db };
}
