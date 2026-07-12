# Review Log — AB-1009-version-history

Tracks `/review` findings and action items only. No `fix-bundles.md` per project convention (`AGENTS.md §13`).

## Status: ✅ PASSED (100% FRS/SDS Compliance Verified)

**Review Authority**: `/review AB-1009-version-history` compliance audit against `FRS §6`, `SDS §2.1/§5.3`, `Rule 11`, `FRS-0.3.2/FRS-0.3.3`.

### Verified Compliance Findings

#### 1. Shared Source of Truth (`Rule 11`, `FRS-8.5`)

- ✅ **Constants (Tier 1)**:
  - `APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES = 5` (FRS-6.1)
  - `APP_LIMITS.VERSION_RETENTION_DAYS = 90` (FRS-6.5)
  - `API_PATHS.NOTES.VERSIONS = "/versions"` (reuses `API_PATHS.NOTES.RESTORE`)
  - `API_ERROR_CODES.VERSION_NOT_FOUND` (FRS-6, Error Scenarios)
- ✅ **Schemas**: `updateNoteSchema` extended with `isExplicitSave: z.boolean().default(false)` (FRS-6.1)
- ✅ **Types**: `NoteVersionSummaryDto { id, titleSnapshot, createdAt }` and `NoteVersionResponseDto { id, noteId, titleSnapshot, bodySnapshot, createdAt }` (FRS-6.2/6.3)
- ✅ **Zero duplication**: No constants, schemas, or types redefined in `apps/api`

#### 2. Backend Four-Layer Architecture Isolation (`SDS §1.1`, `FRS-8.6`)

- ✅ **Controller (`note-version.controller.ts`)**: Parses params, invokes service method, wraps response in `{ success: true, data }`. Zero parsing logic, zero SQL.
- ✅ **Service (`note-version.service.ts`)**: Enforces ownership via `findActiveNoteByIdForUser()` (returns `404 NOTE_NOT_FOUND` for cross-user/trashed). Orchestrates mutations inside `prisma.$transaction()`. Emits proper error codes.
- ✅ **Repository (`note-version.repository.ts`)**: Pure DB access via Prisma Client and `$executeRaw` (tagged templates, zero SQL injection).
- ✅ **Router (`note-version.router.ts`)**: Uses `API_PATHS.NOTES.RESTORE` constant (no hardcoded `/restore` string).

#### 3. Version Snapshot Lifecycle (`FRS-6.1`)

- ✅ **Creation**: `POST /api/v1/notes` → `createNote()` creates Note + initial NoteVersion in single transaction (lines 67–81, `note.service.ts`)
- ✅ **Explicit Save Bypass**: `PATCH /api/v1/notes/:id { ..., isExplicitSave: true }` → always snapshot, bypassing 5-minute throttle (line 110, `note.service.ts`, `shouldSnapshot()` returns true immediately)
- ✅ **Autosave Throttle**: `isExplicitSave: false/omitted` → snapshot only if ≥5 minutes elapsed since latest version (lines 54–60, `shouldSnapshot()`)
- ✅ **Default Behavior**: Schema defaults `isExplicitSave` to `false` when omitted (line 40, `note.schema.ts`)

#### 4. List/View/Restore Endpoints (`FRS-6.2/6.3/6.4`)

- ✅ **List (`GET /api/v1/notes/:id/versions`)**: Returns `{ versions: NoteVersionSummaryDto[] }` reverse-chronological (no pagination, per spec clarification #2)
- ✅ **View (`GET /api/v1/notes/:id/versions/:versionId`)**: Returns full `NoteVersionResponseDto { titleSnapshot, bodySnapshot, createdAt, ... }`
- ✅ **Restore (`POST /api/v1/notes/:id/versions/:versionId/restore`)**: Copies snapshot content to live Note, appends new top-of-history version (non-destructive, all prior versions preserved, lines 75–103, `note-version.service.ts`)

#### 5. Soft-Delete Lifecycle Respect (`FRS-2.2`, `FRS-6` Error Scenarios)

- ✅ **Active-Note-Only Scoping**: `assertOwnedActiveNote()` calls `findActiveNoteByIdForUser()` which filters `deletedAt: null` (line 30, `note.repository.ts`). Trashed notes (Stage 1 or 2) return `404 NOTE_NOT_FOUND`, not `403` (IDOR defense, per SDS §2.2).
- ✅ **List/View on Trashed**: Returns `404 NOTE_NOT_FOUND` for caller's own Stage-1/Stage-2 trashed note (spec clarification #1)
- ✅ **Restore on Trashed**: Rejects with `404 NOTE_NOT_FOUND` if note has `deletedAt` set (line 80, `note-version.service.ts`)

#### 6. Retention Purge (`FRS-6.5`, `FRS-8a.4`)

- ✅ **Query Logic**: `purgeOldVersions()` (lines 42–55, `note-version.repository.ts`) deletes versions `created_at < cutoff` while exempting `DISTINCT ON (note_id)` latest version per note via window-function subquery
- ✅ **90-Day Window**: Cutoff computed as `Date.now() - APP_LIMITS.VERSION_RETENTION_DAYS * 24 * 60 * 60 * 1000` (line 14, `cleanup.job.ts`)
- ✅ **Latest-Version Exemption**: Subquery `SELECT DISTINCT ON (note_id) id FROM note_versions ORDER BY note_id, created_at DESC` ensures only the one newest version per note is excluded from deletion
- ✅ **Idempotent**: Safe to invoke twice; second run deletes zero rows (no error on re-invocation of same cutoff)
- ✅ **Independent Purge**: `runVersionsPurgePass()` and `runNotesPurgePass()` both execute in same `03:00 UTC` cron tick without blocking each other (line 30–33, `cleanup.job.ts`)

#### 7. Database Schema Integrity

- ✅ **NoteVersion Model**: `id (UUID)`, `noteId (UUID FK, onDelete: Cascade)`, `titleSnapshot (VARCHAR 200)`, `bodySnapshot (TEXT)`, `createdAt (Timestamptz(6))`
- ✅ **Index**: Compound index `(noteId, createdAt DESC)` for efficient reverse-chronological queries (FRS-6.2)
- ✅ **Cascade Delete**: When a Note is permanently deleted (Stage 2 cutoff), all its NoteVersions cascade-delete via FK constraint

#### 8. Test Isolation & Derivation (`FRS-0.3.2`, `FRS-0.3.3`)

- ✅ **Database Isolation**: All tests check `process.env.DATABASE_URL?.includes("notes_app_test")` before `TRUNCATE` (safety break, lines 17–22 across test files)
- ✅ **FRS-Derived, Not AC-Derived**: Test names and assertions directly reference FRS IDs (e.g., `[FRS-6.2] SHALL return every version ... reverse-chronological`, line 29, `notes.versions.list.test.ts`). No test copies AC bullet wording.
- ✅ **Boundary & Negative Cases**: Tests cover 5-min throttle boundary (line 261–289, `notes.update.test.ts`), 90-day purge boundary (line 32–69, `cleanup.versions-purge.test.ts`), cross-user IDOR rejection (line 91–103, `notes.versions.list.test.ts`), Stage-1/Stage-2 distinction (line 118–144, `notes.versions.list.test.ts`).
- ✅ **Test Suite Coverage**:
  - `notes.versions.list.test.ts` — FRS-6.2 (listing, ordering, trashed-note rejection, cross-user IDOR)
  - `notes.versions.get.test.ts` — FRS-6.3 (viewing, version-not-found, cross-note rejection)
  - `notes.versions.restore.test.ts` — FRS-6.4 (non-destructive restore, throttle bypass, trashed-note rejection)
  - `cleanup.versions-purge.test.ts` — FRS-6.5 + FRS-8a.4 (90-day retention, latest-version exemption, idempotency, parallel purge)
  - `notes.update.test.ts` — FRS-6.1 (explicit-save bypass, autosave throttle, default-false behavior)
  - `notes.create.test.ts` — FRS-6.1 (initial version snapshot on creation)

#### 9. Quality Gates (`Rule 12`, `FRS-0.6`)

- ✅ **Build**: `pnpm turbo run build` → 0 errors, ESM/DTS outputs clean
- ✅ **Typecheck**: `pnpm turbo run typecheck` → `tsc --noEmit` 0 errors across all workspaces
- ✅ **Lint**: `pnpm turbo run lint --max-warnings 0` → zero warnings (verified via cached results)
- ✅ **Tests**: `pnpm turbo run test -- --coverage` → all tests green, ≥80% coverage on new code against isolated `notes_app_test` DB

#### 10. Security & Error Handling

- ✅ **No SQL Injection**: `purgeOldVersions()` uses Prisma `$executeRaw` with template-literal parameters (auto-escaped Date), not string concatenation
- ✅ **Error Code Consistency**: `VERSION_NOT_FOUND` (new) for version-scope failures; `NOTE_NOT_FOUND` for note ownership/deletion checks; never raw HTTP 500 or generic messages
- ✅ **IDOR Defense**: Cross-user note access always 404, never 403 (per FRS-2.1.2 Error Scenarios, SDS §2.2)

---

## Final Verdict

**Status: ✅ READY FOR MERGE**

All 10 mandatory compliance categories pass 100%. Change is fully FRS/SDS compliant, ready for `/pr AB-1009-version-history` execution and merge to `main`.
