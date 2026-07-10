Break down into sequenced execution tasks for: $ARGUMENTS

Steps:
1. Read: `openspec/changes/$ARGUMENTS/proposal.md` and spec delta inside `openspec/changes/$ARGUMENTS/specs/`.
2. Read: `openspec/changes/$ARGUMENTS/plan.md`.
3. Generate structured, sequenced task checklist with mandatory phase checkpoints:
   - **Phase 1: Foundation & Shared Tier (`@shared/core` & DB Migrations)**
     * Zod schemas, inferred TS DTOs, Tier 1 constants inside `packages/shared/`.
     * Prisma schema updates (`schema.prisma`) and migrations (`pnpm --filter @apps/api prisma migrate dev`).
     * *Mandatory Phase 1 Checkpoint*: `pnpm turbo run build` -> `pnpm turbo run lint` -> `pnpm turbo run typecheck`.
   - **Phase 2: Core Implementation (`apps/api` or `apps/web`)**
     * Mark strictly independent sub-tasks as `[PARALLEL]`.
     * Backend: `repositories/ -> services/ -> controllers/ -> routers/`.
     * Frontend: `store/ -> api/ -> hooks/ -> components/ -> pages/`.
     * *Mandatory Phase 2 Checkpoint*: `pnpm turbo run build` -> `pnpm turbo run lint` -> `pnpm turbo run typecheck`.
   - **Phase 3: Automated Test Writing (`test-writer.md` — `[FRS-0.3.2, FRS-0.3.3]`)**
     * One exact test file/suite per spec scenario, derived solely from `FRS` and `SDS` contracts against isolated `notes_app_test`.
     * *Mandatory Phase 3 Checkpoint*: `pnpm turbo run test -- --coverage` (`100% green`, `≥80% coverage on new code`).
   - **Phase 4: OpenSpec Archive (`openspec archive`)**
     * Final validation (`openspec validate`) and archive (`openspec archive $ARGUMENTS`).
4. Save generated task list to: `openspec/changes/$ARGUMENTS/tasks.md`
5. Wait for explicit user approval before beginning `/implement`.

Format: `/tasks AB-xxxx-short-description`
