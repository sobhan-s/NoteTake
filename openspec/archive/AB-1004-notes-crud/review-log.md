# Review Log — AB-1004-notes-crud

## Phase 1 — Shared Tier Foundation

**Files reviewed:**

- `packages/shared/src/constants/app-limits.constant.ts`
- `packages/shared/src/constants/api-paths.constant.ts`
- `packages/shared/src/constants/api-error-codes.constant.ts`
- `packages/shared/src/constants/validation-messages.constant.ts`
- `packages/shared/src/schemas/note.schema.ts`
- `packages/shared/src/schemas/index.ts`
- `packages/shared/src/types/note.type.ts`
- `packages/shared/src/types/index.ts`

### 1. Rule 11 / FRS-8.5 — Single-source-of-truth, barrel exports, runtime independence

✅ PASSED — Only `zod` in runtime deps; no `express`/`prisma`/`react`/`zustand` imported. Barrels correctly updated. No duplication.

### 2. Circular import check — validation-messages.constant.ts ↔ app-limits.constant.ts

✅ PASSED — `app-limits.constant.ts` has zero imports; no circularity.

### 3. Numeric literal compliance vs. docs/FRS.md

✅ PASSED — `NOTE_TITLE_MAX_CHARS: 200` (FRS-2.1.6), `NOTE_BODY_MAX_CHARS: 100000` (FRS-2.1.6), `TRASH_STAGE_1_DAYS: 30` (FRS-2.2.2), `TRASH_STAGE_2_DAYS: 30` (FRS-2.2.6) — all exact matches.

### 4. Schema correctness vs. spec.md

✅ PASSED, with one sub-finding:

- `createNoteSchema`/`updateNoteSchema`/`permanentDeleteSchema` all match spec.md exactly (empty body valid, `.refine` at-least-one-field, `confirm: z.literal(true)`).
- ⚠️ DRIFTED: `types/note.type.ts` — `NoteResponseDto` is a hand-written type literal, not `z.infer<typeof noteResponseSchema>` as spec.md line 78 literally specifies, and as `packages/shared/CLAUDE.md`'s inference rule mandates. No `noteResponseSchema` exists to infer from. **Consistent with existing precedent**: `types/auth.type.ts`'s `AuthUserDto`/`LoginResponseDto`/`MeResponseDto`/`RegisterResponseDto` are likewise hand-typed and already merged in prior tickets (AB-1002/1003). Non-blocking per reviewer verdict — flagged only for Phase 2+ awareness (e.g. if a canonical response schema is later needed for OpenAPI/Swagger generation, FRS-8.7).

### 5. Zero business logic / zero SQL in packages/shared

✅ PASSED — Pure Zod schemas, `as const` constants, type aliases only.

### Summary

- ✅ PASSED: 5/5 mandatory checks
- ❌ MISSING: 0
- ⚠️ DRIFTED: 1 (non-blocking, matches existing codebase precedent)
- 🔒 SECURITY: 0
- 📋 FRS GAP: 0

**VERDICT: Phase 1 compliant — proceed to Phase 2.**

## Phase 2 — Backend Layer (`apps/api`)

**Files reviewed:** `repositories/note.repository.ts`, `services/note.service.ts`, `controllers/note.controller.ts`, `routers/note.router.ts`, `routers/index.ts`, `constants/api.constants.ts`, `jobs/cleanup.job.ts`, `app.ts`.

1. **Layering (Rule 11 / SDS §1.1)** — ✅ PASSED. Zero SQL/Zod definitions in controllers/routers; exactly one service call per handler.
2. **IDOR/Ownership (FRS-2.1.2)** — ✅ PASSED. Every service function scopes lookup to `{id, userId}`; cross-user access → 404 `NOTE_NOT_FOUND`, never 403. Note: mutation repo calls filter by `id` only, safe because the preceding `findFirst` already verified ownership in the same request.
3. **Soft delete / physical delete (FRS-2.2.1)** — ✅ PASSED. `softDeleteNote` only sets `deletedAt`; physical delete confined to `permanentlyDeleteNote` (confirm-gated) and `purgeStage2Notes` (cron-only).
4. **Trashed-note direct access → 404 (Resolved Decision #2)** — ✅ PASSED. Falls out naturally from `findActiveNoteByIdForUser`'s `deletedAt: null` filter, zero extra branching.
5. **Restore/PermanentDelete Stage-1 gating (FRS-2.2.5 / Decision #4)** — ✅ PASSED. Both gate on `isWithinStage1`, collapsing "never trashed"/"Stage 2"/"cross-user" to identical 404.
6. **Cleanup job (FRS-8a.3/8a.4)** — ✅ PASSED core requirement (registers schedule only, doesn't fire on import; idempotent on empty match-set). ⚠️ DRIFTED (non-blocking): `app.ts` calls `startCleanupJob()` unconditionally at module scope with no guard/stop-handle — every test file importing `app.ts` registers another `cron.schedule` task never torn down. No data-safety or contract impact (purge is idempotent, won't fire outside 03:00 UTC), but flagged as a test-hygiene consideration for Phase 3's test-writer.
7. **Out-of-scope check** — ✅ PASSED. Zero `tagIds`/`NoteVersion`/`ShareLink` references anywhere in the new files; no list/pagination endpoint added.
8. **Numeric literal compliance** — ✅ PASSED. All limits reference `APP_LIMITS`/`CRON_CLEANUP_SCHEDULE`; only bare literals are unit-conversion constants (`24 * 60 * 60 * 1000`).
9. **Security** — 🔒 none found. `requireAuth` gates all 6 routes; no token/secret handling touched; `userId` excluded from `NoteResponseDto`.
10. **Express 5 async error forwarding** — ✅ PASSED. Native promise-rejection-to-middleware forwarding confirmed to reach `errorMiddleware` correctly for both `AppError` and `ZodError`.

### Summary

- ✅ PASSED: 9
- ❌ MISSING: 0
- ⚠️ DRIFTED: 1 (non-blocking — cron re-registration across test imports, noted for Phase 3 awareness)
- 🔒 SECURITY: 0
- 📋 FRS GAP: 0

**VERDICT: Phase 2 compliant — proceed to Phase 3 (test engineering). Phase 3's test-writer should be aware of the cron-registration note when designing contract-test setup/teardown.**

## Phase 3 — Test Engineering (`test-writer`)

**Files created:** `tests/helpers/notes.ts`, `tests/contract/notes.create.test.ts` (10), `tests/contract/notes.get.test.ts` (6), `tests/contract/notes.update.test.ts` (10), `tests/contract/notes.delete-restore.test.ts` (10), `tests/contract/notes.permanent-delete.test.ts` (6), `tests/unit/note.service.test.ts` (11), `tests/contract/cleanup.notes-purge.test.ts` (4). Modified: `tests/helpers/index.ts` (barrel export).

- All tests derived from FRS-x.y.z SHALL-text and spec.md contracts (never AC bullet wording), covering exact day-boundary values (29d23h59m/30d0h1m, 60d∓1s) per `[FRS-0.3.2]`.
- All suites run against isolated `notes_app_test`, reusing existing `resetTestDatabase()` — zero new hand-written `TRUNCATE`.
- Test run: **131/131 tests passed** (57 new + 74 pre-existing auth tests untouched/still green).
- `apps/api/vitest.config.ts` `coverage.include` allowlist was missing the 5 new `note.*` files (config-only gap, fixed by Main Claude, not test-writer). After the fix, combined coverage: 96.73% stmts / 93.18% branch / 98.85% funcs / 97.53% lines.
- 📋 Non-blocking gap: `note.service.ts` line 27 (`isWithinStage1`'s `if (!deletedAt) return false`) is unreachable dead code given current call sites' pre-filtering — no FRS text mandates a test for it; left uncovered rather than fabricating an untraceable-scenario test, per `[FRS-0.3.2]`.
- No implementation files required changes — every test passed against Phase 2 code as-is.

**VERDICT: Phase 3 compliant — proceed to Phase 4 (OpenSpec compliance audit).**

## Phase 4 — OpenSpec Compliance Audit

### `openspec validate AB-1004-notes-crud --type change`

- ❌ **MISSING (fixed)** — Initial run failed: `specs/notes/spec.md: No delta sections found.` The file (authored in an earlier `/spec` session) used narrative prose only, with no `## ADDED Requirements` / `### Requirement:` / `#### Scenario:` delta markup, unlike the validated precedent set by the archived `AB-1002`/`AB-1003` specs.
  - **Root cause**: spec.md was never restructured into OpenSpec's required delta format during its original authoring.
  - **Fix applied**: Reformatted `specs/notes/spec.md` into 8 `### Requirement:` blocks (Shared Notes Contracts, Create Note, Read Note By Id, Update Note, Soft Delete Into Stage 1 Trash, Restore Note From Stage 1, Permanent Delete From Stage 1, Stage-2 Nightly Purge) each with `#### Scenario:` blocks, under one `## ADDED Requirements` section — preserving all FRS references, Resolved Decisions, Out of Scope notes, and the Error Scenarios table content-for-content. No implementation code changed.
  - Re-run: `openspec validate AB-1004-notes-crud --type change` → **"Change 'AB-1004-notes-crud' is valid"**.

### Graph orientation note

`detect_changes_tool(base: HEAD)` was consulted first per `CLAUDE.md §1a`, but its `changed_files` diff (git-diff-against-HEAD semantics) only surfaces already-tracked, modified files — none of this ticket's brand-new untracked files (`note.repository.ts`, `note.service.ts`, `note.controller.ts`, `note.router.ts`, `note.schema.ts`, `note.type.ts`, all 8 new test files) appear in it, since they have no prior committed version to diff against. The graph rebuild needed to index them was declined, so this final audit falls back to direct `Read` of every new/modified file, per `CLAUDE.md §1a`'s explicit fallback clause ("Fall back to raw reads only when the semantic graph doesn't cover the specific query"). The 3 "test gap" flags the tool raised (`computeStage2Cutoff`, `runNotesPurgePass`, `startCleanupJob`) are confirmed false positives from the same staleness: `apps/api/tests/contract/cleanup.notes-purge.test.ts` directly invokes `runNotesPurgePass()` (which itself calls `computeStage2Cutoff()`), and `note.service.ts`/`note.repository.ts`/`note.controller.ts`/`note.router.ts` all have direct contract/unit test coverage confirmed at 96.73%/93.18%/98.85%/97.53% (stmts/branch/funcs/lines) in Phase 3.

### Final Compliance Audit — Mandatory NoteApp Compliance Checks Table

**1. Shared Source of Truth (`Rule 11, FRS-8.5, SDS §1.1`)**
✅ PASSED — `createNoteSchema`/`updateNoteSchema`/`permanentDeleteSchema` (`packages/shared/src/schemas/note.schema.ts`), `CreateNoteInput`/`UpdateNoteInput`/`PermanentDeleteInput`/`NoteResponseDto` (`packages/shared/src/types/note.type.ts`), and all four Tier-1 constant additions (`APP_LIMITS.NOTE_TITLE_MAX_CHARS`/`NOTE_BODY_MAX_CHARS`/`TRASH_STAGE_1_DAYS`/`TRASH_STAGE_2_DAYS`, `API_PATHS.NOTES`, `API_ERROR_CODES.NOTE_NOT_FOUND`, 4 `VALIDATION_MESSAGES` keys) live exclusively in `packages/shared`. `apps/api` imports every one of them from `@shared/core/{schemas,types,constants}` — zero local redefinition found in `note.controller.ts`/`note.service.ts`/`note.repository.ts`/`note.router.ts`. `apps/web` has zero note-related files this ticket (backend-only scope).

**2. Backend Layer Isolation (`Rule 11, SDS §1.1, FRS-8.6`)**
✅ PASSED — `note.controller.ts` (all 6 handlers): each is exactly `schema.parse(req.body)` (or no body parse for `getById`/`softDelete`/`restore`) → one `noteService.*` call → `res.status(n).json({ success: true, data })`. Zero `prisma`/`$queryRaw`/`z.object(` tokens present. `note.router.ts` contains only `Router()`, `requireAuth` middleware mount, and 6 route declarations referencing `API_PATHS.NOTES.RESTORE`/`PERMANENT` — zero business logic. `routers/index.ts` mounts at `API_PATHS.BASE + API_PATHS.NOTES.ROOT` = `/api/v1/notes`, confirmed against `api-paths.constant.ts` (`BASE: "/api/v1"`).

**3. Token Exfiltration & Memory (`Rule 11, FRS-1.3.5, SDS §3.1`)**
📋 N/A (out of scope) — This ticket touches zero auth/token files (`auth.service.ts`, `token.service.ts`, `useAuthStore`, cookie handling all untouched). `note.router.ts` reuses the existing `requireAuth` middleware without modification. No regression risk.

**4. XSS Security & Sentinels (`FRS-4.2.1, SDS §4.3`)**
📋 N/A (out of scope) — No full-text search / `ts_headline` / highlight-snippet work exists in this ticket's scope (search is a separate future ticket per `spec.md`'s "Out of Scope" section). Zero `dangerouslySetInnerHTML` or raw-HTML-returning code introduced.

**5. Soft-Delete Lifecycle (`FRS-2.2, SDS §2.1, SDS §5.3`)**
✅ PASSED — `note.repository.ts`'s `softDeleteNote` sets only `{ deletedAt: new Date() }` via `update`, never `delete`. The sole two call sites that physically remove a row are `permanentlyDeleteNote` (`db.note.delete`, gated in `note.service.ts` by `findTrashedNoteByIdForUser` + `isWithinStage1` + the controller's `permanentDeleteSchema.parse` confirm-gate) and `purgeStage2Notes` (`db.note.deleteMany`, invoked only from `cleanup.job.ts`'s `runNotesPurgePass`, itself only reachable via the `03:00 UTC` `cron.schedule(CRON_CLEANUP_SCHEDULE, ...)` registration in `startCleanupJob`). No controller or service path physically deletes a note outside these two gated call sites.

**6. Test Isolation & Derivation (`FRS-0.3.2, FRS-0.3.3, SDS §1.5`)**
✅ PASSED — Reconfirmed from Phase 3: all 8 new test files derive assertions from `FRS-2.1.x`/`FRS-2.2.x`/`FRS-8a.x` SHALL-text and this ticket's `spec.md` scenarios (day-boundary values, cross-user/nonexistent/trashed 404-collapse, confirm-gating), never from AC bullet wording. All contract suites run through the existing `resetTestDatabase()`/`.env.test` harness targeting `notes_app_test` exclusively — zero new hand-written `TRUNCATE`, zero `sqlite::memory:`.

**7. Frontend UX Compliance (`docs/ux.md, FRS §7, FRS-8.4`)**
📋 N/A (out of scope) — This ticket (`AB-1004`, backend range `AB-1002..AB-1009` per `AGENTS.md`/`/tasks` domain rules) makes zero `apps/web` changes. Frontend consumption of these endpoints is deferred to the `apps/web` notes-UI ticket(s).

**Additional out-of-scope / scope-creep check** — ✅ PASSED. Zero references to `tagIds`, `NoteTag`, `NoteVersion`, `ShareLink`, or a list/pagination endpoint anywhere in the new files, consistent with `spec.md`'s "Out of Scope" section and Decision #1 (tagIds omitted from this ticket).

### Summary

- ✅ PASSED: 5
- ❌ MISSING: 0
- ⚠️ DRIFTED: 0 (the 2 non-blocking drifts already logged in Phase 1/Phase 2 remain unchanged and non-blocking)
- 🔒 SECURITY: 0
- 📋 N/A (out of scope, explicitly not failed): 3 — categories 3, 4, 7

**VERDICT: Review complete — All applicable checks passed (100% FRS/SDS compliance for this backend-only ticket's scope). No `❌ MISSING`, `⚠️ DRIFTED` (new), or `🔒 SECURITY` findings. Change remains in `openspec/changes/AB-1004-notes-crud` until `/pr` is run. Approved for `/pr AB-1004-notes-crud`.**
