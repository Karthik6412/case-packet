import path from "node:path";
import { createFixtureExtractor, type DocumentExtractor } from "@/agent/extractor";
import { loadAllFixtures } from "@/fixtures/load";
import type { Fixture } from "@/fixtures/schema";
import { SqliteCaseRepository, type CaseRepository } from "@/repo";

/** Everything the app needs, built once. Free of any Next.js dependency. */
export interface AppContext {
  repo: CaseRepository;
  extractor: DocumentExtractor;
  /** The synthetic golden cases; also the source of corrected documents. */
  fixtures: Fixture[];
}

export function defaultDbPath(): string {
  return process.env.CASE_PACKET_DB ?? path.join(process.cwd(), "data", "case-packet.db");
}

export function createAppContext(dbPath: string = defaultDbPath()): AppContext {
  const fixtures = loadAllFixtures();
  return {
    repo: SqliteCaseRepository.open({ path: dbPath }),
    extractor: createFixtureExtractor(fixtures),
    fixtures,
  };
}

// In development, hot reloads re-evaluate modules; keep one connection per process.
const globalForContext = globalThis as unknown as { __casePacketContext?: AppContext };

export function getAppContext(): AppContext {
  globalForContext.__casePacketContext ??= createAppContext();
  return globalForContext.__casePacketContext;
}
