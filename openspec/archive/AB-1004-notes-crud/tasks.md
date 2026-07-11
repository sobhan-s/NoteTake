# Sequenced Tasks for AB-1004-notes-crud (`AB-1004-notes-crud`)

Source of truth: `openspec/changes/AB-1004-notes-crud/specs/notes/spec.md` +
`openspec/changes/AB-1004-notes-crud/plan.md`. Confirmed via `code-review-graph`:
`apps/api/src/jobs/cleanup.job.ts` is currently a 2-line stub (only `startCleanupJob`),
`apps/api/src/routers/index.ts` exists and is mountable, and the `auth.*` domain files
(`controller/service/repository/router`) exist in `apps/api/src` to mirror structurally.
No `note.*` files exist yet in any layer — this ticket creates them from scratch.

## Phase 1: Foundation & Shared Tier (`@shared/core` — Rule 11, no DB migration needed)

- [x] `packages/shared/src/constants/app-limits.constant.ts`: Add `NOTE_TITLE_MAX_CHARS: 200`, `NOTE_BODY_MAX_CHARS: 100000`, `TRASH_STAGE_1_DAYS: 30`, `TRASH_STAGE_2_DAYS: 30` to the existing `APP_LIMITS` object (`[FRS-2.1.6, FRS-2.2.2, FRS-2.2.6]`).
- [x] `packages/shared/src/constants/api-paths.constant.ts`: Add `NOTES: { ROOT: "/notes", RESTORE: "/restore", PERMANENT: "/permanent" }` to `API_PATHS` (`[FRS-8.6]`).
- [x] `packages/shared/src/constants/api-error-codes.constant.ts`: Add `NOTE_NOT_FOUND: "NOTE_NOT_FOUND"` to `API_ERROR_CODES` (`[FRS-2.1.2]`).
- [x] `packages/shared/src/constants/validation-messages.constant.ts`: Add `NOTE_TITLE_REQUIRED`, `NOTE_TITLE_TOO_LONG`, `NOTE_BODY_TOO_LONG`, `NOTE_UPDATE_EMPTY` messages, importing `APP_LIMITS` (verify no circular-import first) (`[FRS-2.1.5, FRS-2.1.6]`).
- [x] `packages/shared/src/schemas/note.schema.ts` (NEW): Define `createNoteSchema`, `updateNoteSchema` (`.refine` at-least-one-field), `permanentDeleteSchema` (`{ confirm: z.literal(true) }`) exactly per `plan.md §1.5` (`[Rule 11, FRS-2.1.5, FRS-2.1.6, FRS-2.2.8]`).
- [x] `packages/shared/src/schemas/index.ts`: Add `export * from "./note.schema";` barrel export (`[Rule 11]`).
- [x] `packages/shared/src/types/note.type.ts` (NEW): Define `CreateNoteInput`, `UpdateNoteInput`, `PermanentDeleteInput` (`z.infer`) and `NoteResponseDto` (no `userId` field exposed) per `plan.md §1.7` (`[Rule 11, FRS-2.1.1]`). _(Reviewer note: `NoteResponseDto` hand-typed rather than `z.infer`-derived, consistent with existing `auth.type.ts` precedent — non-blocking, see `review-log.md`.)_
- [x] `packages/shared/src/types/index.ts`: Add `export * from "./note.type";` barrel export (`[Rule 11]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` (`tsup`) → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck` (`tsc --noEmit`) scoped to `packages/shared`. **All green.**

## Phase 2: Core Implementation (`apps/api` — Router → Controller → Service → Repository)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude → Tester → Reviewer → Triage loop. Controllers strictly `z.parse` only — zero SQL, zero Zod definitions, per `apps/api/CLAUDE.md` / `SDS §1.1`. Services enforce `deletedAt`-based state transitions per `FRS-2.2` — never a physical `DELETE` outside `permanentDeleteNote`/`purgeStage2Notes`.)_

- [x] `apps/api/src/repositories/note.repository.ts` (NEW): Implement `createNote`, `findActiveNoteByIdForUser`, `findTrashedNoteByIdForUser`, `updateNoteContent`, `softDeleteNote`, `restoreNote`, `permanentlyDeleteNote`, `purgeStage2Notes` — pure Prisma Client calls, `Db = Pick<Prisma.TransactionClient, "note">` default-param pattern mirroring `auth.repository.ts` (`[FRS-2.1.1, FRS-2.1.2, FRS-2.2.1, FRS-2.2.7]`).
- [x] `apps/api/src/services/note.service.ts` (NEW): Implement `createNote`, `getNoteById`, `updateNote`, `softDeleteNote`, `restoreNote`, `permanentDeleteNote` with shared `notFound()` → `AppError(404, NOTE_NOT_FOUND)` helper, `isWithinStage1` gate, `toNoteResponseDto` mapper (UTC ISO timestamps) — zero HTTP context (`[FRS-2.1.2, FRS-2.1.5, FRS-2.1.6, FRS-2.2.1, FRS-2.2.5, FRS-2.2.8, FRS-8.2]`).
- [x] `apps/api/src/controllers/note.controller.ts` (NEW): Implement `create`, `getById`, `update`, `softDelete`, `restore`, `permanentDelete` — `schema.parse(req.body)` from `@shared/core/schemas` + exactly one service call + `{ success: true, data }` wrapper, zero SQL/Zod definitions in this layer (`[SDS §1.1, FRS-2.1.1, FRS-2.2.8]`). _(`req.params.id as string` cast required — `noUncheckedIndexedAccess` + Express 5 `ParamsDictionary` types indexed params as `string | string[] | undefined`.)_
- [x] `apps/api/src/routers/note.router.ts` (NEW): Mount all 6 routes under `requireAuth`, using `API_PATHS.NOTES.RESTORE`/`PERMANENT` suffixes (`[FRS-8.6]`).
- [x] `apps/api/src/routers/index.ts` (MODIFIED): Mount `noteRouter` at `API_PATHS.BASE + API_PATHS.NOTES.ROOT`, matching the existing `auth.router` mount pattern (`[FRS-8.6]`).
- [x] `apps/api/src/constants/api.constants.ts` (MODIFIED, Tier 2): Add `CRON_CLEANUP_SCHEDULE = "0 3 * * *"` (`[FRS-8a.3]`).
- [x] `apps/api/src/jobs/cleanup.job.ts` (MODIFIED — currently a 2-line stub): Implement `computeStage2Cutoff`, `runNotesPurgePass` (exported standalone for direct test invocation), and wire `startCleanupJob` to `cron.schedule(CRON_CLEANUP_SCHEDULE, ...)` — Pass 1 only (Stage-2 permanent purge), idempotent on repeat runs (`[FRS-2.2.6, FRS-2.2.7, FRS-8a.2, FRS-8a.3, FRS-8a.4]`). _(Reviewer note: unconditional `startCleanupJob()` registers a new cron task per `app.ts` import — non-blocking, flagged for Phase 3 test-setup awareness.)_
- [x] `apps/api/src/app.ts` (MODIFIED): Call `startCleanupJob()` at module scope after `errorMiddleware`, no `app.listen(...)` added (`[FRS-8a.3]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`. **All green.**

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `[FRS-0.3.2, FRS-0.3.3]`)

_(Derive all test names/assertions/boundary values solely from `FRS-x.y.z` `SHALL` text and `SDS.md` contracts above — never from Acceptance Criteria bullet wording, per `AGENTS.md §10`. All suites run only against isolated `notes_app_test`, reusing existing `resetTestDatabase()` — no new hand-written `TRUNCATE`.)_

- [x] `apps/api/tests/helpers/notes.ts` (NEW): `ROUTES.NOTES_ROOT`, `ROUTES.noteById(id)`, `ROUTES.restore(id)`, `ROUTES.permanent(id)`, plus `createNoteDirect(userId, overrides)` Prisma-direct fixture helper (mirrors `tests/helpers/auth.ts`) (`[FRS-0.3.3]`).
- [x] `apps/api/tests/contract/notes.create.test.ts` (NEW, 10 tests): 201 + persisted row; empty/whitespace title 400 naming `title`; title >200 / body >100,000 chars 400; 401 without auth (`[FRS-2.1.1, FRS-2.1.5, FRS-2.1.6]`).
- [x] `apps/api/tests/contract/notes.get.test.ts` (NEW, 6 tests): 200 own active note; 404 cross-user; 404 nonexistent id; 404 Stage-1 trashed; 404 Stage-2 trashed (`[FRS-2.1.2, FRS-2.2.3]`).
- [x] `apps/api/tests/contract/notes.update.test.ts` (NEW, 10 tests): 200 partial update (title-only/body-only); 400 empty title; 400 both-fields-omitted; 404 cross-user; 404 on trashed note (`[FRS-2.1.3, FRS-2.1.5]`).
- [x] `apps/api/tests/contract/notes.delete-restore.test.ts` (NEW, 10 tests): soft-delete sets `deletedAt` only; restore within Stage-1 clears `deletedAt`; restore on never-trashed note → 404; restore on Stage-2 note (seed `deletedAt` 31+ days ago) → 404; restore cross-user → 404 (`[FRS-2.2.1, FRS-2.2.2, FRS-2.2.5]`).
- [x] `apps/api/tests/contract/notes.permanent-delete.test.ts` (NEW, 6 tests): 200 + row physically gone (`prisma.note.findUnique`); 400 without `confirm: true`; 404 on Stage-2 note; 404 cross-user (`[FRS-2.2.7, FRS-2.2.8]`).
- [x] `apps/api/tests/unit/note.service.test.ts` (NEW, 11 tests): `isWithinStage1` day-30 boundary (30d-1s vs 30d+1s) with mocked `noteRepository`, matching `otp.service.test.ts`'s `vi.mock` style (`[FRS-2.2.2, FRS-2.2.5]`).
- [x] `apps/api/tests/contract/cleanup.notes-purge.test.ts` (NEW, 4 tests): seed note at 60-day cutoff ±1s via direct Prisma override, call `runNotesPurgePass()` directly, assert survive/purge + cascade removal of any `NoteTag`/`NoteVersion`/`ShareLink` rows (`[FRS-2.2.6, FRS-2.2.7, FRS-8a.2, FRS-8a.4]`).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage`. **131/131 tests green** (57 new + 74 pre-existing). Updated `apps/api/vitest.config.ts` `coverage.include` to add the 5 new `note.*` files (was missing from the allowlist). Combined coverage: 96.73% stmts / 93.18% branch / 98.85% funcs / 97.53% lines — well above the 80% gate. One accepted non-blocking gap: `note.service.ts`'s defensive `if (!deletedAt) return false` in `isWithinStage1` is unreachable dead code (every call site pre-filters via `findTrashedNoteByIdForUser`'s `deletedAt: {not: null}`) — no FRS text mandates a test for it, left uncovered per `[FRS-0.3.2]` (no fabricated test for an untraceable scenario).

## Phase 4: OpenSpec Compliance Audit (`/review` — archiving reserved for `/pr`)

- [x] Run `openspec validate` against `openspec/changes/AB-1004-notes-crud/specs/notes/spec.md`. _(Initial run failed — spec.md lacked delta markup; reformatted into `## ADDED Requirements`/`### Requirement:`/`#### Scenario:` blocks preserving all content; re-validated: "Change 'AB-1004-notes-crud' is valid".)_
- [x] Run `/review AB-1004-notes-crud` (`reviewer` agent checks `@shared/core` usage, zero SQL/Zod in controllers, `deletedAt`-only soft delete, no `tagIds`/version/share-link scope creep, FRS-8a.4 idempotency). _(All 5 applicable categories ✅ PASSED; categories 3/Token-Exfiltration, 4/XSS-Sentinels, 7/Frontend-UX correctly logged 📋 N/A — out of scope for this backend-only ticket. Zero ❌/⚠️(new)/🔒 findings.)_
- [x] Confirm `openspec/changes/AB-1004-notes-crud/review-log.md` reports all ✅ PASSED before proceeding to `/pr AB-1004-notes-crud`. _(Confirmed — final verdict: "Approved for /pr AB-1004-notes-crud".)_
