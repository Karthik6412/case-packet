# Case Packet Assembly & Validation

A practice project: a paralegal prepares employment-based immigration case packets for attorney review. All data is synthetic. See `SPEC.md`, `ACCEPTANCE_CRITERIA.md` and `IMPLEMENTATION_PLAN.md`.

## Run the demo

```bash
npm install
npm run seed -- --reset   # load the clean and date-conflict cases and check each once (Run 1)
npm run dev               # open http://localhost:3000
```

Demo flow: open **Lena Höffmann** (Blocked: employment dates don't match) → **Replace document** → **Re-run validation** → Run 2 is Ready for review, and Run 1 is still in the audit trail, unchanged.

The database is a SQLite file at `data/case-packet.db` (override with `CASE_PACKET_DB`). `npm run seed` is safe to repeat; `-- --reset` starts over.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run seed` | Load fixtures into the demo database |
| `npm run eval` | Run the golden fixtures through `runCase` and print a pass/fail table |
| `npm test` | Vitest |
| `npm run typecheck` / `npm run lint` | Strict TypeScript / ESLint |
| `npm run db:generate` | Generate a SQL migration after editing `src/repo/sqlite/schema.ts` |

## Layout

- `src/domain`, `src/validators`: schemas and deterministic validation
- `src/repo`: storage-agnostic repository interface; `src/repo/sqlite` is the Drizzle adapter
- `src/agent`: `runCase`, the single runner used by the app and the eval
- `src/service`: framework-free logic behind the screens (queue, case view, actions, plain-language text)
- `src/app`: Next.js pages, components and Server Actions (thin wrappers over `src/service`)
- `fixtures`: synthetic golden cases
