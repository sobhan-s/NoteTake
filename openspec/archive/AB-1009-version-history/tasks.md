# Sequenced Tasks for AB-1009-version-history

Scope: `BACKEND` only. No `apps/web` changes (`AB-1002..AB-1009 → BACKEND` per ticket scope map).
Layering invariant: `routers/ → controllers/ → services/ → repositories/ → shared`.
No DB migration — `NoteVersion` (`apps/api/prisma/schema.prisma:131-142`) already exists exactly as
`SDS §4.4` specifies.

## Phase 1: Foundation & Shared Tier (`@shared/core` & DB Migrations)

- [x] `packages/shared/src/constants/app-limits.constant.ts`: Add `VERSION_SNAPSHOT_THROTTLE_MINUTES: 5` and `VERSION_RETENTION_DAYS: 90` to `APP_LIMITS` (`Rule 11`, `[FRS-6.1, FRS-6.5]`).
- [x] `packages/shared/src/constants/api-paths.constant.ts`: Add `VERSIONS: "/versions"` to `API_PATHS.NOTES`; reuse existing `RESTORE: "/restore"` for the nested version-restore segment, no new literal (`[FRS-8.5]`).
- [x] `packages/shared/src/constants/api-error-codes.constant.ts`: Add `VERSION_NOT_FOUND: "VERSION_NOT_FOUND"` to `API_ERROR_CODES` (`[FRS-6.3]`).
- [x] `packages/shared/src/schemas/note.schema.ts`: Add `isExplicitSave: z.boolean().default(false)` to `updateNoteSchema`, before the existing `.refine(...)` call (`[FRS-6.1]`).
- [x] `packages/shared/src/types/note.type.ts`: Add hand-written `NoteVersionSummaryDto` (`id`, `titleSnapshot`, `createdAt`) and `NoteVersionResponseDto` (`id`, `noteId`, `titleSnapshot`, `bodySnapshot`, `createdAt`); confirm `UpdateNoteInput` auto-gains `isExplicitSave: boolean` via `z.infer`, no manual edit (`[FRS-6.2, FRS-6.3]`).
- [x] Confirm `apps/api/prisma/schema.prisma`: `NoteVersion` model requires **no changes** — verify existing fields/index match `SDS §4.4` exactly, no migration generated (`[FRS-6.1]`).
- [x] **Mandatory Phase 1 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 2: Core Implementation (`apps/api`)

_(Execute each unchecked `[ ]` item via the `/implement` Main Claude → Tester → Reviewer → Triage loop)_

- [x] `apps/api/src/repositories/note-version.repository.ts` (NEW): Implement `createVersion`, `findLatestVersionForNote`, `listVersionsForNote`, `findVersionByIdForNote` (all accept `db: Db = prisma` for transaction composability, scoped by `noteId`) and `purgeOldVersions` (tagged-template `$executeRaw`, not `$queryRawUnsafe` — sole variable is a `Date`, zero injection surface) matching the exact SDS §5.3 Pass 2 SQL. Zero business logic, pure Prisma/SQL (`[FRS-6.1, FRS-6.2, FRS-6.3, FRS-6.5]`).
- [x] `apps/api/src/services/note.service.ts` (MODIFIED): Export the existing private `toNoteResponseDto` (add `export` keyword only) for reuse by `note-version.service.ts` (`[FRS-6.4]`).
- [x] `apps/api/src/services/note.service.ts` (MODIFIED): Add private `shouldSnapshot(noteId, isExplicitSave, db)` helper implementing the 3-branch throttle algorithm (`isExplicitSave` bypass; `< 5min` skip; `>= 5min` or no prior version snapshot) reading `APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES` (`[FRS-6.1]`).
- [x] `apps/api/src/services/note.service.ts` (MODIFIED): Wrap `createNote` in `prisma.$transaction` to unconditionally create the note's first `NoteVersion` alongside note creation (`[FRS-6.1]`).
- [x] `apps/api/src/services/note.service.ts` (MODIFIED): Wrap `updateNote` in `prisma.$transaction` to conditionally create a `NoteVersion` via `shouldSnapshot`, read through the same `tx` to avoid a race between concurrent autosave requests for the same note (`[FRS-6.1]`).
- [x] `apps/api/src/services/note-version.service.ts` (NEW): Add `noteNotFound()`/`versionNotFound()` `AppError` throw helpers and a locally-duplicated `assertOwnedActiveNote(userId, noteId)` (matching the existing `share.service.ts` convention — no shared util extraction) (`[FRS-6.2, FRS-6.3, FRS-6.4]`).
- [x] `apps/api/src/services/note-version.service.ts` (MODIFIED): Add `toSummaryDto`/`toVersionResponseDto` mappers and implement `listVersions(userId, noteId)` — ownership+active check, reverse-chronological list (`[FRS-6.2]`).
- [x] `apps/api/src/services/note-version.service.ts` (MODIFIED): Implement `getVersion(userId, noteId, versionId)` — ownership+active check, `findVersionByIdForNote`'s compound `{id, noteId}` where-clause naturally 404s cross-note ids as `VERSION_NOT_FOUND` (`[FRS-6.3]`).
- [x] `apps/api/src/services/note-version.service.ts` (MODIFIED): Implement `restoreVersion(userId, noteId, versionId)` — ownership+active check, version-scope check, then `prisma.$transaction` updating the live `Note` and unconditionally appending a new top-of-history `NoteVersion` (never subject to the throttle), returning via reused `toNoteResponseDto` (`[FRS-6.4]`).
- [x] `apps/api/src/controllers/note-version.controller.ts` (NEW): Implement `list`, `getById`, `restore` HTTP adapters — zero Zod, zero SQL, `{ success: true, data }` wrapper only, mirroring `share.controller.ts` (`SDS §1.1`) (`[FRS-6.2, FRS-6.3, FRS-6.4]`).
- [x] `apps/api/src/routers/note-version.router.ts` (NEW): `mergeParams: true` sub-router with `GET /`, `GET /:versionId`, `POST /:versionId${API_PATHS.NOTES.RESTORE}` (`[FRS-8.6]`).
- [x] `apps/api/src/routers/note.router.ts` (MODIFIED): Mount `noteVersionRouter` at `` `/:id${API_PATHS.NOTES.VERSIONS}` `` exactly like the existing `shareRouter` mount, behind router-level `requireAuth` (`[FRS-8.6]`).
- [x] Confirm `apps/api/src/controllers/note.controller.ts` requires **zero changes** — `update` already forwards the full parsed `updateNoteSchema` object (including the new `isExplicitSave`) wholesale to `noteService.updateNote` (`[FRS-6.1]`).
- [x] `apps/api/src/jobs/cleanup.job.ts` (MODIFIED): Add `computeVersionRetentionCutoff()` and `runVersionsPurgePass()`; invoke both the existing `runNotesPurgePass()` and the new `runVersionsPurgePass()` independently in the same `03:00 UTC` cron tick (`CRON_CLEANUP_SCHEDULE` unchanged) (`[FRS-6.5, FRS-8a.4]`).
- [x] **Mandatory Phase 2 Checkpoint**: Run `pnpm turbo run build` → `pnpm turbo run lint -- --max-warnings 0` → `pnpm turbo run typecheck`.

## Phase 3: Automated Test Engineering (`test-writer` sub-agent — `FRS-0.3.2`, `FRS-0.3.3`)

All suites run only against isolated `notes_app_test`; any `TRUNCATE ... CASCADE` guarded by
`process.env.DATABASE_URL?.includes('notes_app_test')`. Tests derived solely from `FRS-x.y.z` SHALL
text and `SDS.md` contracts, never from spec Acceptance-Criteria wording.

- [x] `apps/api/tests/unit/note.service.test.ts` (MODIFIED): Add `shouldSnapshot`/throttle-decision cases — explicit save at 30s bypasses throttle; autosave at 2min skips; autosave at exactly 5min-1s vs. 5min+1s boundary; `isExplicitSave` omitted defaults to `false`; no-prior-version always snapshots (`[FRS-6.1]`).
- [x] `apps/api/tests/unit/note-version.repository.test.ts` (NEW): `purgeOldVersions` — 5-version note with all 5 past 90 days deletes 4/keeps 1 latest; idempotent re-run deletes 0; single 200-day-old sole version on an untouched note is never purged (`[FRS-6.5, FRS-8a.4]`).
- [x] `apps/api/tests/unit/note-version.service.test.ts` (NEW): `listVersions`/`getVersion`/`restoreVersion` ownership and version-scope branch coverage (isolated from HTTP layer) (`[FRS-6.2, FRS-6.3, FRS-6.4]`).
- [x] `apps/api/tests/contract/notes.create.test.ts` (MODIFIED): Assert `POST /notes` creates exactly 1 `NoteVersion` matching created `title`/`body` (`[FRS-6.1]`).
- [x] `apps/api/tests/contract/notes.update.test.ts` (MODIFIED): Assert the 3-branch matrix (explicit-save bypass, within-throttle skip, past-throttle snapshot) end-to-end over HTTP (`[FRS-6.1]`).
- [x] `apps/api/tests/contract/notes.versions.list.test.ts` (NEW): `GET /notes/:id/versions` — newest-first ordering; single-initial-version on a brand-new note; cross-user note id → `404 NOTE_NOT_FOUND`; trashed (Stage 1 or 2) note id → `404 NOTE_NOT_FOUND` (`[FRS-6.2]`).
- [x] `apps/api/tests/contract/notes.versions.get.test.ts` (NEW): `GET /notes/:id/versions/:versionId` — normal full-content view; cross-note `versionId` → `404 VERSION_NOT_FOUND`; purged-version id → `404 VERSION_NOT_FOUND` (`[FRS-6.3]`).
- [x] `apps/api/tests/contract/notes.versions.restore.test.ts` (NEW): `POST /notes/:id/versions/:versionId/restore` — normal restore (prior history intact, new top row appended); throttle-bypass (10s since last snapshot, still appends); trashed-note rejection (`404 NOTE_NOT_FOUND`, nothing modified); cross-note/cross-user rejection (`404 NOTE_NOT_FOUND` / `VERSION_NOT_FOUND`, nothing modified) (`[FRS-6.4]`).
- [x] `apps/api/tests/contract/cleanup.notes-purge.test.ts` or new `cleanup.versions-purge.test.ts` (NEW/MODIFIED): Assert the nightly job's version-purge pass runs independently alongside the existing trash purge pass in the same tick (`[FRS-6.5, FRS-8a.4]`).
- [x] **Mandatory Phase 3 Checkpoint**: Run `pnpm turbo run test -- --coverage` — 100% green against `notes_app_test`, ≥80% coverage on new/modified code.

## Phase 4: OpenSpec Compliance Audit (`/review` — Archiving reserved for `/pr`)

- [x] Run `openspec validate` against `openspec/changes/AB-1009-version-history/specs/version-history/spec.md`.
- [x] Run `/review AB-1009-version-history` (`reviewer` agent: FRS-6.1–6.5 coverage, `SDS §4.4`/`§5.3 Pass 2` contract adherence, zero Zod/SQL in controllers, `deletedAt`-based active-note scoping, no `VERSION_NOT_FOUND`/`NOTE_NOT_FOUND` conflation, Out-of-Scope boundaries respected — no diff view, no pinning, no Swagger, no `apps/web`).
- [x] Confirm `openspec/changes/AB-1009-version-history/review-log.md` reports all `✅ PASSED` before proceeding to `/pr AB-1009-version-history`.
- [x] Note as a separate follow-up checkpoint (not part of this ticket's behavioral scope, same split as `AB-1007`'s `6a8107d`/`87709ee`): Swagger/OpenAPI doc authoring for the 3 new version-history routes.

## Definition of Done (commit format, on `/pr`)

`feat(notes): implement version history snapshot, list, view, and restore AB#1009`
