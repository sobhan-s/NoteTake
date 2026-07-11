Break down into sequenced execution tasks for: $ARGUMENTS

**Strict OpenSpec Naming Rule (`AB-xxxx-descriptive-name`)**:
Verify that `$ARGUMENTS` matches the exact descriptive change directory inside `openspec/changes/`. If `$ARGUMENTS` was supplied as only a bare ticket ID (`AB-xxxx`), search `openspec/changes/` for the exact folder matching `AB-xxxx-*` (e.g., `openspec/changes/AB-1001-project-setup-monorepo`) and use that exact descriptive name across the task breakdown (`[Rule 3]`).

## Preconditions & Setup

1. Read canonical specification documents:
   - `openspec/changes/$ARGUMENTS/spec.md`
   - `openspec/changes/$ARGUMENTS/plan.md`
   - `docs/FRS.md` (`[FRS-x.y.z]` numbered requirement text)
   - `docs/SDS.md` (`API/DB` schemas, route table, `CHECK/GIN` constraints, status codes)
   - `docs/ux.md` (`Global Frontend UX & Visual Architecture` — strictly required for `AB-1010` to `AB-1016`)
2. Determine ticket scope by ID (`AB-1001 -> INFRA`, `AB-1002..AB-1009 -> BACKEND`, `AB-1010..AB-1015 -> FRONTEND`, `AB-1016 -> E2E`).
3. Ensure `.openspec/changes/$ARGUMENTS/review-log.md` and `fix-bundles.md` will be ready for the `/implement` orchestrator loop.
4. **GRAPH ORIENTATION & EFFICIENT LOOKUPS (`[Rule 12]`)**:
   - Prioritize using `grep_search` and targeted `view_file` calls to confirm exact file paths and layered boundaries (`routers -> controllers -> services -> repositories -> shared`) before writing task items. Only use `query_graph` or `get_architecture_overview` if analyzing large multi-workspace structures.

---

## Task Generation Rules for `/implement` Orchestrator Loop

Every generated task `[ ]` inside `tasks.md` must be designed so that Main Claude (`/implement`) can execute the **Main Claude -> Tester -> Reviewer -> Triage** loop on it:

1. **Granular & Self-Contained**: Each task item `[ ]` must represent a single, focused architectural slice (e.g. `[ ] Create verifyOtpSchema in @shared/core and verify with vitest`).
2. **Exact Layered Paths**: Explicitly list the exact file paths to create or modify (`e.g., packages/shared/src/schemas/auth.schema.ts`, `apps/api/src/services/auth.service.ts`).
3. **Mandatory FRS Traceability**: Every single task `[ ]` MUST end with an explicit requirement tag (`[FRS-x.y.z]`) tracing directly to `docs/FRS.md`.
4. **CRITICAL NOTEAPP RULES Integration**:
   - Explicitly note in Phase 1 that all DTOs and Zod schemas go in `packages/shared` (`Rule 11`).
   - Explicitly note in Phase 2 that Controllers strictly parse `z.parse` and do NO SQL or Zod definitions (`SDS §1.1`).
   - Explicitly note that tokens live purely in `useAuthStore` memory (`[FRS-1.3.5]`) and active records use `deletedAt` (`FRS-2.2`).

---

## Output Structure (`task.md`)

Generate the sequenced task checklist strictly using this format:

```markdown
# Sequenced Tasks for $ARGUMENTS (`AB-xxxx-descriptive-name`)

## Phase 1: Foundation & Shared Tier (`@shared/core` & DB Migrations)

- [ ] `packages/shared/src/schemas/...`: Define Zod schemas and inferred TS DTOs (`[Rule 11, FRS-x.y.z]`).
- [ ] `packages/shared/src/constants/...`: Define Tier 1 shared constants (`API_PATHS, APP_LIMITS, UI_COPY, ERROR_CODES`).
- [ ] `apps/api/prisma/schema.prisma`: Apply Prisma schema updates and native `citext/tsvector` extensions (`[FRS-0.4]`).
- [ ] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` (`tsup`) -> `pnpm turbo run lint -- --max-warnings 0` -> `pnpm turbo run typecheck` (`tsc --noEmit`).

## Phase 2: Core Implementation (`apps/api` or `apps/web`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude -> Tester -> Reviewer -> Triage loop)_

- [ ] `apps/api/src/repositories/...`: Implement database access queries (`prisma...` / `$queryRaw`) (`[FRS-x.y.z]`).
- [ ] `apps/api/src/services/...`: Implement business logic and transaction boundaries (`[FRS-x.y.z]`).
- [ ] `apps/api/src/controllers/...`: Implement Zod parse + `{ success: true, data }` wrappers (`[SDS §1.1, FRS-x.y.z]`).
- [ ] `apps/api/src/routers/...`: Declare `/api/v1` route namespace and attach middlewares (`[FRS-8.6]`).
- [ ] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` -> `pnpm turbo run lint` -> `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `[FRS-0.3.2, FRS-0.3.3]`)

- [ ] `apps/api/tests/contract/...` or `apps/web/tests/...`: Write exact unit/contract (`supertest`) / E2E (`playwright`) tests derived solely from numbered `FRS-x.y.z` text and `SDS.md` against isolated `notes_app_test`.
- [ ] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` (`100% green against notes_app_test`, `≥80% new coverage`).

## Phase 4: OpenSpec Compliance Audit (`/review` — Archiving reserved for `/pr`)

- [ ] Run `openspec validate` against spec delta (`specs/`).
- [ ] Run `/review $ARGUMENTS` (`reviewer` agent checks `@shared/core`, controllers, `localStorage`, `deletedAt`).
- [ ] Confirm `review-log.md` reports all `✅ PASSED` before proceeding to `/pr $ARGUMENTS` (where `openspec archive` takes place).
```

Save generated checklist to: `openspec/changes/$ARGUMENTS/tasks.md`
Wait for explicit user `APPROVED` confirmation (`[Rule 3]`) before allowing `/implement`.

Format: `/tasks AB-xxxx-short-description`
