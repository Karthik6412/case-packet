// The only module application code should import persistence from.
// Swap the adapter here (e.g. a Postgres implementation) without touching callers.
export * from "./CaseRepository";
export { SqliteCaseRepository } from "./sqlite/SqliteCaseRepository";
