# AB-1001 — Project Setup: Monorepo, Prisma, AI Governance & OpenSpec Workspace

## Section 1: Proposal Summary & Scope Boundaries

### Objective & Traceability

Establish the foundational monorepo, database, and AI-governance scaffolding required before any feature ticket (`AB-1002+`) can begin, per `[FRS §0]` and `[SDS §1, §2.1]`.

| Requirement | Deliverable                                                                                                                                                                              | SDS Ref          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `FRS-0.1`   | `pnpm workspaces` + Turborepo monorepo: `apps/api/`, `apps/web/`, `packages/shared/`, `packages/config/`                                                                                 | `SDS §1.1`       |
| `FRS-0.2`   | Root `AGENTS.md` (exists), root `CLAUDE.md` (exists), + 3 domain `CLAUDE.md` files: `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `packages/shared/CLAUDE.md` (**do not yet exist — gap**) | `SDS §1.1`       |
| `FRS-0.3`   | OpenSpec workspace (`openspec/config.yaml`, `changes/`, `archive/`, `specs/` — exist) + 7 slash commands (exist) + 2 sub-agents (exist)                                                  | `SDS §1.1`       |
| `FRS-0.3.1` | Concrete live-doc-verification mechanism for third-party API usage                                                                                                                       | —                |
| `FRS-0.3.2` | `test-writer.md` derives tests from FRS/SDS text only, never AC wording (already compliant — verify only)                                                                                | —                |
| `FRS-0.3.3` | Isolated `notes_app_test` DB contract for `supertest`/`playwright` (already stated in `test-writer.md` — needs concrete `.env.test` template)                                            | `SDS §1.4`       |
| `FRS-0.4`   | PostgreSQL 16 + Prisma initialized with `citext` extension, full schema (per user decision below)                                                                                        | `SDS §2.1, §2.2` |
| `FRS-0.5`   | Exact-pinned versions, ESLint `--max-warnings 0`, Prettier, Husky + lint-staged + commitlint                                                                                             | `SDS §1.3`       |
| `FRS-0.6`   | `turbo.json` pipeline (`build` depends on `^build`), local verification gates                                                                                                            | `SDS §1.4`       |

**Decisions locked in for this ticket (confirmed with project owner):**

1. **Full Prisma schema now** — `apps/api/prisma/schema.prisma` includes all models from `SDS §2.1` (`User`, `LoginAttempt`, `OtpCode`, `RefreshSession`, `Note`, `Tag`, `NoteTag`, `NoteVersion`, `ShareLink`) plus the raw-SQL migration additions from `SDS §2.2` items 1–2 (`CHECK` constraints, `tsvector` trigger + `GIN` index) so the schema fully matches the documented design in one migration. Feature tickets (`AB-1002+`) consume this schema; they do not alter its shape except where an FRS change explicitly requires it.
2. **Context7 MCP is the `FRS-0.3.1` mechanism** — `.mcp.json` currently registers only `code-review-graph`; **Context7 is missing and must be added** in this ticket as the concrete live-documentation-verification tool, then referenced in root `CLAUDE.md` §1 area (new subsection) as binding usage guidance.
3. **CI/CD is out of scope** — no GitHub Actions or equivalent pipeline in this ticket; `FRS-0.6` only mandates local verification gates.
4. **No smoke-test routes** — `apps/api/src/app.ts` stays unrouted (no `/api/v1/health`, no `/api/v1/docs` mount) until `AB-1002` adds the first real endpoints. Express 5 initializes with global middleware only (JSON body parsing, CORS, centralized error handler shell).

### Explicit Scope Boundaries

**In scope:**

- Monorepo directory layout, `package.json` manifests (root + 5 workspaces), pinned dependency versions.
- `turbo.json` pipeline graph, `packages/config` shared ESLint/Prettier/`tsconfig.base.json`.
- `docker-compose.yml` (Postgres 16 Alpine), full `schema.prisma`, initial migration (models + `CHECK` constraints + FTS trigger/`GIN` index).
- Husky hooks (`pre-commit`, `commit-msg`), `commitlint.config.js`, `lint-staged` config.
- 3 missing domain `CLAUDE.md` files.
- `.mcp.json` Context7 registration + root `CLAUDE.md` documentation of its mandatory use.
- `packages/shared` scaffolding: empty `src/schemas/`, `src/types/`, `src/constants/` directories with barrel `index.ts` files ready for `AB-1002+` to populate — **no actual auth/notes/tags schemas written yet** (those belong to their feature tickets).
- `.env.example` / `.env.test.example` templates documenting `DATABASE_URL` for `notes_app` and `notes_app_test`.
- `.gitignore` completion (`node_modules`, `dist`, `.env`, `.turbo`, etc. — currently only has the `code-review-graph` entry).

**Out of scope (explicit):**

- Any controller/service/repository/route code for auth, notes, tags, search, sharing, or versions (`AB-1002`–`AB-1009`).
- Any frontend page/component/hook/store code (`AB-1010`–`AB-1015`).
- CI/CD pipeline (GitHub Actions, etc.) — no FRS requirement mandates it for this ticket.
- Health-check or any other live HTTP route on `apps/api`.
- `node-cron` cleanup job implementation (`FRS-8a`, scaffolding directory `jobs/` created empty only).
- Populating `packages/shared/src/schemas|types|constants` with real Zod schemas/DTOs/constants — only directory scaffolding.
- Running `prisma migrate dev` against a live database as part of this spec (that is an `/implement`-phase execution step, not a spec decision).
- Swagger/OpenAPI doc generation (`FRS-8.7`) — requires real routes/schemas to introspect; deferred.

### CRITICAL NOTEAPP RULES Integration

- **`@shared/core` shape parity**: No API request/response DTOs exist yet in this ticket, so there is no drift risk to confirm — but the `packages/shared` directory structure created here (`src/schemas/`, `src/types/`, `src/constants/`) is the _only_ location any future ticket may define them (`[Rule 11, FRS-8.5]`). This spec's `tasks.md` output must not create any placeholder schema files that a later ticket would need to delete/replace.
- **`/api/v1` namespace + unified response wrapper**: No routes exist yet. The unified `{ success, data | error }` wrapper type SHALL be scaffolded as a generic TypeScript type in `packages/shared/src/types/` (e.g. `ApiResponse<T>`) so `AB-1002`'s first controller has it available on day one — this is schema scaffolding, not a route.
- **Auth token storage (`FRS-1.3.5`)**: No auth code exists yet; `apps/web/src/store/` directory is scaffolded empty (no `useAuthStore.ts` implementation) — that belongs to `AB-1002`/`AB-1010`.
- **Soft-delete `deletedAt` (`FRS-2.2`)**: The `Note.deletedAt` column is created now (full-schema decision) but zero state-transition logic (trash/restore/purge) is written — that is `AB-1004`/`AB-1009`/`AB-8a` cleanup-job scope.

---

## Section 2: Behavioral Specification (SHALL/MUST Scenarios)

### ADDED Scenarios

**Scenario: Monorepo workspace layout (`FRS-0.1`)**

- The repository root SHALL contain a `pnpm-workspace.yaml` declaring `apps/*` and `packages/*` as workspace globs.
- `apps/api/`, `apps/web/`, `packages/shared/`, `packages/config/` SHALL each contain a valid `package.json` with a unique workspace name (`@apps/api`, `@apps/web`, `@shared/core`, `@config/*`).
- The root `turbo.json` SHALL declare a `build` task with `"dependsOn": ["^build"]` so `packages/*` build before `apps/*` in any topological run.

**Scenario: Domain AI-governance files (`FRS-0.2`)**

- `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, and `packages/shared/CLAUDE.md` SHALL each exist and SHALL scope their rules strictly to that workspace's layer boundaries (e.g. `apps/api/CLAUDE.md` MUST state the zero-SQL-in-controllers rule; it MUST NOT restate root `AGENTS.md` content verbatim).
- Root `AGENTS.md` SHALL remain under 200 lines per `FRS-0.2`.

**Scenario: OpenSpec workspace completeness (`FRS-0.3`)**

- `openspec/config.yaml`, `openspec/changes/`, `openspec/archive/`, `openspec/specs/` SHALL exist (already satisfied — this scenario is a verification gate, not new work).
- `.claude/commands/` SHALL contain exactly the 7 named slash commands (`start`, `spec`, `plan`, `tasks`, `implement`, `review`, `pr`); `.claude/agents/` SHALL contain exactly `reviewer.md` and `test-writer.md` (already satisfied — verification gate).
- `.claude/skills/` SHALL exist as a directory (currently missing) even if empty, per the `SDS §1.1` directory contract.

**Scenario: Live third-party API documentation verification (`FRS-0.3.1`)**

- `.mcp.json` SHALL register a Context7 (or equivalent live-documentation) MCP server in addition to `code-review-graph`.
- Root `CLAUDE.md` SHALL document a binding rule: before generating code against any third-party library API (Prisma, Express 5, TipTap, TanStack Query, etc.), the mechanism SHALL be consulted rather than relying solely on training data.
- This SHALL be a genuinely working, invocable MCP tool at the end of this ticket — not merely a comment or documentation claim.

**Scenario: Test-writer FRS-derivation and DB-isolation compliance (`FRS-0.3.2`, `FRS-0.3.3`)**

- `.claude/agents/test-writer.md` SHALL explicitly instruct: tests are derived solely from numbered `FRS-x.y.z` requirement text and `SDS.md` contracts; Acceptance Criteria bullet wording SHALL NOT be copied or lightly reworded into a test name or assertion (already satisfied — verification gate, no edit required unless a reviewer finds contradicting language).
- `apps/api/.env.test.example` SHALL declare `DATABASE_URL` pointing at `notes_app_test`, distinct from `apps/api/.env.example`'s `notes_app` — the two SHALL NEVER share a database name.
- `.claude/agents/reviewer.md` SHALL check test coverage against FRS requirement IDs/SDS contracts directly, never against Acceptance-Criteria-line-to-test-name matching (already satisfied — verification gate).

**Scenario: PostgreSQL 16 + Prisma full schema initialization (`FRS-0.4`)**

- `docker-compose.yml` SHALL define a `postgres:16-alpine` service named `notes_app_postgres`, exposing port `5432`, with a healthcheck (`pg_isready`), matching `SDS §1.5` exactly.
- `apps/api/prisma/schema.prisma` SHALL declare `datasource db { extensions = [citext] }` and `previewFeatures = ["fullTextSearchPostgres", "postgresqlExtensions"]`.
- `apps/api/prisma/schema.prisma` SHALL define all 8 models from `SDS §2.1` (`User`, `LoginAttempt`, `OtpCode`, `RefreshSession`, `Note`, `Tag`, `NoteTag`, `NoteVersion`, `ShareLink`) with exact field types, `@map`/`@@map` names, and indexes as specified.
- `User.email` and `Tag.name` SHALL use `@db.Citext` natively (not a raw-SQL `ALTER TABLE` applied outside the schema file), per the `SDS §2.1` v1.4 fix — this SHALL prevent Prisma drift-detection from reverting the column type on a future `migrate dev`.
- The initial migration SHALL additionally apply, via raw SQL, the three `CHECK` constraints (`notes_title_length_check`, `notes_body_length_check`, `tags_color_hex_check`) and the `tsvector` trigger + `GIN` index (`notes_search_vector_gin`, `trg_notes_search_vector_update`) from `SDS §2.2` items 1–2.
- All `DateTime` fields SHALL use `@db.Timestamptz(6)` per `FRS-8.2`.

**Scenario: Strict version pinning and code quality tooling (`FRS-0.5`)**

- Every `package.json` (root + all 5 workspaces) SHALL contain zero `^`, `~`, `*`, or `>=` version specifiers on any dependency or devDependency.
- `packages/config` SHALL export a shared `eslint.config.js` enforcing `--max-warnings 0`, `prettier.config.js`, and `tsconfig.base.json` (strict mode) consumed by every other workspace via `extends`.
- `.husky/pre-commit` SHALL invoke `npx lint-staged`; `.husky/commit-msg` SHALL invoke `npx --no -- commitlint --edit`.
- `commitlint.config.js` SHALL enforce the exact format `type(scope): description AB#ticket` with types restricted to `feat|fix|chore|docs|refactor|test`; a commit missing the ticket reference or using an invalid type SHALL be rejected by the hook.

**Scenario: Turborepo task graph and local quality gates (`FRS-0.6`)**

- `turbo.json` SHALL define `lint`, `typecheck`, `build`, and `test` tasks for every workspace; `build` SHALL depend on `^build` (topological), `test` and `lint` SHALL depend on nothing external (parallelizable).
- Running `pnpm turbo run build` on a freshly cloned repo (zero feature code present) SHALL exit `0` with no errors — `tsup` bundling `apps/api` and `packages/shared` even with empty/minimal source trees.
- Running `pnpm turbo run lint` SHALL exit `0` with `--max-warnings 0` on the scaffolded (near-empty) source trees.
- Running `pnpm turbo run typecheck` SHALL exit `0` (`tsc --noEmit`) across all workspaces.
- Running `pnpm turbo run test -- --coverage` SHALL exit `0` (no test files yet is a valid green state — this scenario only proves the pipeline wiring works, not feature coverage).

**Scenario: Malformed commit rejection (`FRS-0.5`, verification of `SDS §1.3`)**

- A commit message missing the `AB#ticket` suffix SHALL be rejected by the `commit-msg` Husky hook with a non-zero exit and a clear error naming the expected format.
- A commit message using a type outside `feat|fix|chore|docs|refactor|test` SHALL be rejected identically.

---

## Clarifying Questions Asked & Resolved

1. **Full schema vs. incremental schema** → Resolved: full schema now (see Decisions §1).
2. **`FRS-0.3.1` mechanism** → Resolved: Context7 MCP, currently missing, added by this ticket (see Decisions §2).
3. **CI/CD scope** → Resolved: out of scope (see Decisions §3).
4. **Health-check route scope** → Resolved: no routes in this ticket; `app.ts` stays unrouted (see Decisions §4).
5. **`packages/config` structure** → Resolved: **one** single private workspace package (`packages/config/`) containing three flat files (`eslint.config.js`, `prettier.config.js`, `tsconfig.base.json`), consumed via relative `extends` paths. No scoped sub-packages.
6. **`apps/api/src/jobs/cleanup.job.ts` scaffolding** → Resolved: a clean stub file exporting a TODO-free no-op function, `export function startCleanupJob(): void {}`. No cron logic, no `node-cron` wiring yet — that lands incrementally with `AB-1002`/`AB-1004`/`AB-1009`.
7. **Node version pinning (`.nvmrc` / `engines`)** → Resolved: `.nvmrc` pins an exact patch (`22.14.0`); root `package.json` `"engines": { "node": "22.x" }` is acceptable — `engines` is advisory runtime verification, not a dependency range, so it is not subject to the zero-range Rule 20 restriction (which governs `dependencies`/`devDependencies` only).

All seven clarifying questions are now resolved. No open questions remain.

### Additional scenarios from resolved questions

**Scenario: Single flat `packages/config` workspace (`FRS-0.1`, `FRS-0.5`)**

- `packages/config/` SHALL be exactly one private workspace package (`@config/*` per `AGENTS.md` naming) containing exactly three flat files: `eslint.config.js`, `prettier.config.js`, `tsconfig.base.json`.
- Other workspaces SHALL consume these via relative `extends`/`import` paths (e.g. `apps/api/tsconfig.json` extends `../../packages/config/tsconfig.base.json`) — no scoped sub-packages (`@config/eslint-config`, etc.) SHALL be created.

**Scenario: No-op cleanup job stub (`FRS-8a`, scaffolding only)**

- `apps/api/src/jobs/cleanup.job.ts` SHALL export exactly one no-op function, `startCleanupJob(): void {}`, with an explicit `void` return type and zero cron/scheduling logic.
- `apps/api/src/app.ts` SHALL NOT import or invoke `startCleanupJob` in this ticket (no routes exist either, per Decision §4) — the stub exists solely so the `jobs/` directory and its import path are real and typecheck-clean for `AB-1002+` to wire up.

**Scenario: Exact Node version pinning (`FRS-0.5`, `Rule 20`)**

- Root `.nvmrc` SHALL contain an exact patch version, `22.14.0`.
- Root `package.json` SHALL declare `"engines": { "node": "22.x" }` — this is permitted under `Rule 20` because `engines` is advisory environment verification, not a `dependencies`/`devDependencies` version range.

---

**All clarifying questions resolved. Spec is ready for final sign-off before `/plan`.**
