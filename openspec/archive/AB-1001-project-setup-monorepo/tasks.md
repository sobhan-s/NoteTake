# Sequenced Tasks for AB-1001-project-setup-monorepo (`AB-1001-project-setup-monorepo`)

**Source plan:** `openspec/changes/AB-1001-project-setup-monorepo/plan.md` (APPROVED)
**Scope class:** INFRA — every task below is scaffolding (files/directories/config), zero business logic. There are no `repositories/services/controllers` implementations in this ticket, so Phase 2 below is "Scaffolding Implementation," not feature logic, per `plan.md §12` (Explicitly Deferred).

**Orchestrator note:** `.claude/agents/reviewer.md` and `.claude/agents/test-writer.md` already exist and are already `FRS-0.3.2`/`FRS-0.3.3`-compliant (verified in `/spec`) — no task below edits them, only verifies them.

**Implementation notes (deviations discovered during `/implement`, no spec decisions changed):**

- `apps/api/package.json` was created in Phase 1 (not Phase 2 as originally sequenced) — `prisma migrate dev` is a hard prerequisite for it and cannot run without the package existing first.
- Per-workspace `eslint.config.js` files (`apps/api`, `apps/web`, `packages/shared`) were added — implied by `plan.md §2`'s "extended per-workspace" language but not spelled out as their own line items.
- Real bugs caught by the build/lint/test gates and fixed: two TS2742 portable-type errors (`app`/`router` needed explicit type annotations for `tsup --dts`), a missing `packages/shared/eslint.config.js`, a missing `"type": "module"` on two `package.json`s, an unused-`_next`-param lint failure, a double `--coverage` flag collision between the test script and the DoD command, and a missing `@vitest/coverage-v8` devDependency. All fixed; `plan.md` updated to match where the fix affects documented content.
- `commitlint.config.js`'s first draft required `AB#ticket` on every commit, contradicting `AGENTS.md §6`'s chore-may-omit-ticket exception — rewritten as a custom rule that allows it.

---

## Phase 0: Orchestrator Loop Readiness

- [x] Create `openspec/changes/AB-1001-project-setup-monorepo/review-log.md` (empty, headed `# Review Log — AB-1001`) for the `/implement` Main Claude → Tester → Reviewer → Triage loop to append to (`[FRS-0.3]`). Note: `review-log.md` is the sole tracking log (`fix-bundles` are not used).

## Phase 1: Foundation & Shared Tier (`@shared/core`, root config, DB schema)

- [x] `pnpm-workspace.yaml`: Declare `packages: ["apps/*", "packages/*"]` (`[FRS-0.1]`).
- [x] `.nvmrc`: Pin exact `22.14.0` (`[FRS-0.5, Rule 20]`).
- [x] `package.json` (root): `"private": true`, `"engines": { "node": "22.x", "pnpm": "9.x" }`, zero version ranges, root scripts (`build`, `lint`, `typecheck`, `test`, `prepare`) (`[FRS-0.5, Rule 20]`).
- [x] `turbo.json`: `build` task with `"dependsOn": ["^build"]`; `lint`/`typecheck`/`test` tasks per `plan.md §6` (`[FRS-0.1, FRS-0.6]`).
- [x] `.gitignore`: Append `node_modules/`, `dist/`, `.turbo/`, `*.tsbuildinfo`, `.env`, `.env.test`, `!.env.example`, `!.env.test.example`, `coverage/`, `playwright-report/`, `test-results/` — preserve existing `code-review-graph` entry (`[FRS-0.5]`).
- [x] `packages/config/package.json`: `@config/core`, private, zero runtime deps (`[FRS-0.5]`).
- [x] `packages/config/eslint.config.js`: Flat config, `--max-warnings 0`, plus the `apps/api` layer-boundary `no-restricted-imports` rule from `plan.md §2` (controllers↛repositories, routers↛services/repositories, repositories↛controllers/routers) (`[AGENTS.md §5, FRS-0.5]`).
- [x] `packages/config/prettier.config.js`: Shared formatting rules (`[FRS-0.5]`).
- [x] `packages/config/tsconfig.base.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"moduleResolution": "bundler"`, `"target": "ES2022"` (`[FRS-0.5]`).
- [x] `packages/shared/package.json`: `@shared/core`, exports map for `schemas`/`types`/`constants`, `tsup` build script (`[Rule 11, FRS-8.5]`).
- [x] `packages/shared/tsconfig.json`: Extends `../config/tsconfig.base.json` (`[FRS-0.5]`).
- [x] `packages/shared/src/schemas/index.ts`: Empty barrel (`export {}`) — no domain schemas written (`[Rule 11, FRS-8.5]`).
- [x] `packages/shared/src/constants/index.ts`: Empty barrel (`export {}`) — no domain constants written (`[Rule 11, FRS-8.5]`).
- [x] `packages/shared/src/types/api-response.type.ts`: Exact `ApiSuccessResponse<T>` / `ApiErrorResponse` / `ApiResponse<T>` union per `plan.md §3` (`[FRS-8.6, Rule 11]`).
- [x] `packages/shared/src/types/index.ts`: `export * from './api-response.type';` (`[Rule 11]`).
- [x] `apps/api/prisma/schema.prisma`: `datasource db { provider = "postgresql", url = env("DATABASE_URL"), extensions = [citext] }`, `previewFeatures = ["fullTextSearchPostgres", "postgresqlExtensions"]`, all 8 models (`User`, `LoginAttempt`, `OtpCode`, `RefreshSession`, `Note`, `Tag`, `NoteTag`, `NoteVersion`, `ShareLink`) transcribed verbatim from `SDS §2.1`, native `@db.Citext` on `User.email`/`Tag.name`, `@db.Timestamptz(6)` on every datetime (`[FRS-0.4, FRS-8.2]`).
- [x] Run `pnpm --filter @apps/api prisma migrate dev --name init` to generate `apps/api/prisma/migrations/0001_init/migration.sql` — **`[y/n]` gate: DB migration per `CLAUDE.md §2`** (`[FRS-0.4]`).
- [x] Hand-append to that same `migration.sql`: `notes_title_length_check` (`char_length(title) <= 200`, matching `FRS-2.1.6` exactly — not `255`), `notes_body_length_check` (`<= 100000`), `tags_color_hex_check`, `notes_search_vector_update()` trigger function referencing `NEW.body` (the real column — not `body_plaintext`), `trg_notes_search_vector_update` trigger, `notes_search_vector_gin` GIN index (`[FRS-2.1.6, FRS-4.2, SDS §2.2]`).
- [x] Root `docker-compose.yml`: `postgres:16-alpine` service `notes_app_postgres`, port `5432:5432`, `POSTGRES_DB: notes_app`, `pg_isready` healthcheck, exact match to `SDS §1.5` (`[FRS-0.4]`).
- [x] `apps/api/.env.example`: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/notes_app?schema=public"` (`[FRS-0.4]`).
- [x] `apps/api/.env.test.example`: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/notes_app_test?schema=public"` — distinct DB name from dev, never shared (`[FRS-0.3.3]`).
- [x] **Mandatory Phase 1 Checkpoint**: `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`. All exit `0` (`[CLAUDE.md §6, FRS-0.6]`).

## Phase 2: Scaffolding Implementation (`apps/api`, `apps/web`, AI governance — no business logic)

_(No `[ ]` item in this phase implements FRS feature behavior — `AB-1001` is INFRA-only per `plan.md §12`. Each item still traces to the `FRS-0.x` requirement it scaffolds for.)_

- [x] `apps/api/package.json`: pinned deps verified live against npm registry (`express@5.2.1`, `cors@2.8.6`, `dotenv@17.4.2`, `bcrypt@6.0.0`, `jsonwebtoken@9.0.3`, `node-cron@4.6.0`, `zod@3.25.76`, `@prisma/client@6.19.3`) + devDeps (`tsx@4.23.0`, `tsup@8.5.1`, `vitest@4.1.10`, `@vitest/coverage-v8@4.1.10`, `supertest@7.2.2`, `prisma@6.19.3`, `@types/*`) — actual "latest" tags were verified per `FRS-0.3.1`, not assumed. `"test": "vitest run --passWithNoTests"` exactly (no `--coverage` baked in — see `plan.md §4.4`'s corrected note) (`[FRS-0.5, FRS-0.3.1, Rule 20]`).
- [x] `apps/api/tsconfig.json`: Extends `../../packages/config/tsconfig.base.json` (`[FRS-0.5]`).
- [x] `apps/api/src/app.ts`: Express 5 init — `express.json()`, `cors()`, centralized error-handler shell (signature only). Exports configured `app`. **No `listen()`, no routes mounted** (`[FRS-0.1]`, Decision §4 in `spec.md`).
- [x] `apps/api/src/routers/index.ts`: Empty `Router()` export — no route registrations (`[FRS-8.6]` scaffolding only).
- [x] `apps/api/src/controllers/.gitkeep`, `apps/api/src/services/.gitkeep`, `apps/api/src/repositories/.gitkeep`, `apps/api/src/middlewares/.gitkeep`: Empty layered directories (`[AGENTS.md §5]`).
- [x] `apps/api/src/jobs/cleanup.job.ts`: Exact no-op stub `export function startCleanupJob(): void {}` — no `node-cron` import, no schedule string, no Prisma calls, not imported by `app.ts` (`[FRS-8a]` scaffolding only).
- [x] `apps/web/package.json`: pinned deps verified live against npm registry (`react@19.2.7`, `react-dom@19.2.7`) + devDeps (`vite@6.4.3`, `@vitejs/plugin-react@4.7.0` — not the `6.x` "latest" tag, which requires Vite 8 and would have broken the locked Vite 6 — `vitest@4.1.10`, `@vitest/coverage-v8@4.1.10`, `@playwright/test@1.61.1`). `"test": "vitest run --passWithNoTests"` exactly (no `--coverage` baked in). Explicitly excludes `@tanstack/react-query`, `zustand`, `@tiptap/react`, `axios`, shadcn/ui, `tailwindcss`, `sonner` (deferred to `AB-1010`) (`[FRS-0.5, FRS-0.3.1, Rule 20]`).
- [x] `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`: Vite SPA config, `@/*` path alias to `src/*` (`[FRS-0.1]`).
- [x] `apps/web/src/main.tsx`: `ReactDOM.createRoot` mount only (`[FRS-0.1]`).
- [x] `apps/web/src/App.tsx`: Placeholder shell (no `react-router-dom` route table populated) (`[FRS-0.1]`, Decision §4 in `spec.md`).
- [x] `apps/web/src/{store,api,hooks,components,pages,types}/.gitkeep`: Empty layered directories — no `useAuthStore.ts`, no axios client, no components instantiated (`[SDS §1.1]` scaffolding only; `FRS-1.3.5` deferred to `AB-1002`/`AB-1010`).
- [x] `apps/api/CLAUDE.md`: Zero SQL/Zod in `controllers/`+`routers/`; layer-import direction; bcrypt rounds=12 location; reference to the `eslint-plugin-import`/`no-restricted-imports` boundary rule (`[FRS-0.2]`).
- [x] `apps/web/CLAUDE.md`: TanStack Query vs. Zustand boundary; access token strictly in `useAuthStore` memory, never `localStorage` (`FRS-1.3.5`); every filter/sort/search change issues a fresh backend request (`FRS-8.4`) (`[FRS-0.2]`).
- [x] `packages/shared/CLAUDE.md`: Pure TypeScript/Zod only, zero runtime deps beyond `zod`; every schema needs a matching `z.infer` type; barrels stay in sync (`[FRS-0.2]`).
- [x] `.claude/skills/.gitkeep`: Close the missing-directory gap per `SDS §1.1` (`[FRS-0.3]`).
- [x] `.mcp.json`: Add `context7` MCP server entry alongside existing `code-review-graph` — **verify exact package name/invocation command against the MCP's own published install docs before writing (this is itself an `FRS-0.3.1` instance)** (`[FRS-0.3.1]`).
- [x] Root `CLAUDE.md`: Add new numbered subsection (after existing §1 MCP Priority) binding Context7 MCP consultation before generating code against any third-party library API (`[FRS-0.3.1]`).
- [x] Root `commitlint.config.js`: Enforce `type(scope): description AB#ticket`, types restricted to `feat|fix|chore|docs|refactor|test` (`[Rule 14, FRS-0.5]`).
- [x] Root `.lintstagedrc.json`: `*.{ts,tsx}` → `eslint --max-warnings 0` + `prettier --write`; `*.{md,json,yml,yaml}` → `prettier --write` (`[Rule 12, FRS-0.5]`).
- [x] `.husky/pre-commit`: `npx lint-staged` (`[Rule 14, FRS-0.5]`).
- [x] `.husky/commit-msg`: `npx --no -- commitlint --edit "$1"` (`[Rule 14, FRS-0.5]`).
- [x] **Mandatory Phase 2 Checkpoint**: `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`. All exit `0` (`[CLAUDE.md §6, FRS-0.6]`).

## Phase 3: Test/Verification Engineering (no `test-writer` dispatch — nothing FRS-feature-shaped to test yet)

- [x] Confirm `apps/api/package.json` and `apps/web/package.json` `test` scripts both include `--passWithNoTests` exactly as specified in `plan.md §4.4`/`§5.2` (`[FRS-0.6]`).
- [x] Run `pnpm turbo run test -- --coverage` on the zero-test-file tree; confirm exit `0` for both workspaces (proves the pipeline wiring, not feature coverage) (`[FRS-0.6]`).
- [x] Verify (read-only, no edit expected) `.claude/agents/test-writer.md` still instructs FRS/SDS-only test derivation and `notes_app_test` isolation with zero `sqlite::memory:` substitution (`[FRS-0.3.2, FRS-0.3.3]`).
- [x] Verify (read-only, no edit expected) `.claude/agents/reviewer.md` still checks FRS requirement IDs/SDS contracts directly, never Acceptance-Criteria-line-to-test-name matching (`[FRS-0.3.2]`).
- [x] Manually verify commit-msg rejection: attempt a commit with a malformed message (missing `AB#ticket` or invalid type) against `.husky/commit-msg`; confirm non-zero exit and a clear error naming the expected format (`[Rule 14, FRS-0.5]`).
- [x] **Mandatory Phase 3 Checkpoint — full DoD sequence** (`plan.md §11`): `docker compose up -d postgres` → `pnpm install --frozen-lockfile` → `pnpm --filter @apps/api prisma migrate dev --name init` (**`[y/n]` gate**) → `pnpm turbo run build` → `pnpm turbo run lint` → `pnpm turbo run typecheck` → `pnpm turbo run test -- --coverage`. All exit `0` (`[CLAUDE.md §6, FRS-0.6]`).

## Phase 4: OpenSpec Compliance Audit & Archive

- [x] Run `openspec validate` against `openspec/changes/AB-1001-project-setup-monorepo/` (`spec.md`, `plan.md`, `tasks.md`) (`[FRS-0.3]`). **Note**: the real `openspec` CLI requires native `proposal.md` + `specs/<capability>/spec.md` (ADDED Requirements + Scenario WHEN/THEN blocks), not `spec.md` directly — added `proposal.md` and `specs/project-setup-infrastructure/spec.md` (translated from `spec.md`'s content, no decisions changed) so `openspec validate --strict` passes cleanly.
- [x] Run `/review AB-1001-project-setup-monorepo` — `reviewer` agent confirmed all mandatory checks ✅ PASSED (`[FRS-0.3]`).
- [x] Append reviewer output to `review-log.md`; one `⚠️ DRIFTED` (stale `--coverage` prose in this file, now fixed above) and one `📋 FRS GAP` (Phase 4 itself incomplete at review time) were non-blocking process findings, not code defects — logged in `review-log.md` and fixed directly (`[FRS-0.3]`).
- [x] Confirm `review-log.md` reports all `✅ PASSED` on every mandatory check (`[FRS-0.3]`).
- [ ] Run `openspec archive AB-1001-project-setup-monorepo` — **`[y/n]` gate: file move/overwrite per `CLAUDE.md §2`** (`[FRS-0.3]`).

---

**Waiting for explicit `APPROVED` confirmation before `/implement` may begin.**
