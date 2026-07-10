# project-setup-infrastructure Specification

## Purpose

TBD - created by archiving change AB-1001-project-setup-monorepo. Update Purpose after archive.

## Requirements

### Requirement: Monorepo Workspace Layout

The repository SHALL be a `pnpm workspaces` + Turborepo monorepo with `apps/api`, `apps/web`, `packages/shared`, and `packages/config` as distinct workspace packages, and the root `turbo.json` SHALL declare `build` as depending on `^build` so `packages/*` build before `apps/*`. (`FRS-0.1`)

#### Scenario: Fresh clone resolves all workspaces

- **WHEN** `pnpm install` runs against a fresh clone
- **THEN** `pnpm-workspace.yaml`'s globs (`apps/*`, `packages/*`) resolve exactly `@apps/api`, `@apps/web`, `@shared/core`, and `@config/core` as linked workspace packages

#### Scenario: Build respects topological order

- **WHEN** `pnpm turbo run build` runs
- **THEN** `packages/shared` and `packages/config` build before `apps/api`/`apps/web` consume their output, per `turbo.json`'s `"dependsOn": ["^build"]`

### Requirement: Domain AI-Governance Files

`apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, and `packages/shared/CLAUDE.md` SHALL each exist, scoped strictly to that workspace's layer boundaries, without restating root `AGENTS.md` verbatim. (`FRS-0.2`)

#### Scenario: Domain CLAUDE.md files exist and are workspace-scoped

- **WHEN** a contributor opens `apps/api/CLAUDE.md`
- **THEN** it states the zero-SQL/zero-Zod-in-controllers rule and the layer-import direction, and does not repeat root `AGENTS.md`/`CLAUDE.md` content

### Requirement: Live Third-Party API Verification

Before code is generated against any third-party library API, a live-documentation-verification mechanism (Context7 MCP) SHALL be configured and invocable — not merely referenced in a comment. (`FRS-0.3.1`)

#### Scenario: Context7 MCP server is registered and invocable

- **WHEN** `.mcp.json` is inspected
- **THEN** it registers a `context7` server (`npx -y @upstash/context7-mcp`) alongside `code-review-graph`, and root `CLAUDE.md` documents binding usage before writing code against any third-party API

### Requirement: Full Prisma Schema and Migration

`apps/api/prisma/schema.prisma` SHALL declare all 8 models from `SDS §2.1` with native `citext`, `Timestamptz(6)`, and `tsvector` support, and the initial migration SHALL additionally apply the 3 `CHECK` constraints, the FTS trigger/function, and the GIN index from `SDS §2.2`. (`FRS-0.4`, `FRS-2.1.6`, `FRS-4.2`)

#### Scenario: Title length constraint matches FRS-2.1.6 exactly

- **WHEN** an `INSERT` into `notes` is attempted with a `title` longer than 200 characters
- **THEN** the `notes_title_length_check` constraint rejects it (200, not any other cap)

#### Scenario: Full-text search trigger populates search_vector from real columns

- **WHEN** a row is inserted or updated in `notes`
- **THEN** `trg_notes_search_vector_update` populates `search_vector` from `NEW.title` (weight A) and `NEW.body` (weight B) — the actual columns on the model, not a nonexistent column

#### Scenario: GIN index exists for full-text search

- **WHEN** `\d notes` is run against the migrated database
- **THEN** `notes_search_vector_gin` appears as a GIN index on `search_vector`

### Requirement: Exact Version Pinning

Every `package.json` in the monorepo SHALL pin every dependency and devDependency to an exact version with zero `^`, `~`, `*`, or `>=` ranges, verified against the live npm registry rather than assumed from training data. (`FRS-0.5`, `Rule 20`, `FRS-0.3.1`)

#### Scenario: No version ranges exist anywhere

- **WHEN** every `package.json` in the monorepo is inspected
- **THEN** no dependency or devDependency version string contains `^`, `~`, `*`, or `>=`

#### Scenario: Live verification catches incompatible pins before install

- **WHEN** a dependency's "latest" tag would be incompatible with a peer (e.g. `eslint@10` vs. `eslint-plugin-import`'s `^9` peer ceiling, or `@vitejs/plugin-react@6` requiring Vite 8 against a locked Vite 6)
- **THEN** the compatible version is pinned instead, discovered via live registry/peer-dependency inspection, not assumed

### Requirement: Turborepo Quality Gate Pipeline

`pnpm turbo run build|lint|typecheck|test` SHALL each exit `0` on the scaffolding-only tree, including the `test` gate on zero test files. (`FRS-0.6`)

#### Scenario: Zero test files is a valid green state

- **WHEN** `pnpm turbo run test -- --coverage` runs with no `*.test.ts` files present anywhere
- **THEN** every workspace's Vitest run exits `0` via `--passWithNoTests`, not a false failure

### Requirement: Malformed Commit Rejection

A commit message missing the `AB#ticket` suffix (except `chore` commits for non-ticket-tied changes) or using a type outside `feat|fix|chore|docs|refactor|test` SHALL be rejected by the `commit-msg` hook. (`FRS-0.5`, `Rule 14`)

#### Scenario: Missing ticket is rejected

- **WHEN** a commit header is `feat(auth): implement login` (no `AB#ticket`)
- **THEN** `commitlint` rejects it with a message naming the expected format

#### Scenario: Ticket-less chore is accepted

- **WHEN** a commit header is `chore: bump lockfile`
- **THEN** `commitlint` accepts it, since `chore` may omit the ticket for non-ticket-tied changes

### Requirement: Single Flat packages/config Workspace

`packages/config` SHALL be exactly one private workspace package containing three flat files (`eslint.config.js`, `prettier.config.js`, `tsconfig.base.json`), consumed via relative `extends`/import paths — no scoped sub-packages.

#### Scenario: Other workspaces extend the flat config directly

- **WHEN** `apps/api/eslint.config.js` imports `@config/core/eslint.config.js`
- **THEN** it resolves to the single flat file, not a scoped sub-package export

### Requirement: No-Op Cleanup Job Stub

`apps/api/src/jobs/cleanup.job.ts` SHALL export exactly one no-op function, `startCleanupJob(): void {}`, with zero cron/scheduling logic, and SHALL NOT be imported by `app.ts` in this ticket. (`FRS-8a` scaffolding only)

#### Scenario: Stub compiles and stays unwired

- **WHEN** `pnpm turbo run build` runs
- **THEN** `cleanup.job.ts` compiles cleanly and `app.ts` contains no import of `startCleanupJob`
