# Spec Delta — AB-1004: Notes Full CRUD + Two-Stage Trash (Soft Delete)

Domain: `notes`. Target: `FRS-2.1`, `FRS-2.2`, `FRS-8a.1–8a.4` (notes category only).

## Executive Summary

Implements authenticated CRUD for single notes (create, read-one, update) and the two-stage
soft-delete lifecycle (Stage 1 restorable trash → Stage 2 audit-only → permanent purge),
strictly scoped to `[FRS-2.1, FRS-2.2]`. This is the first notes-domain ticket; it lands the
`routers/ → controllers/ → services/ → repositories/ → shared` layers for `Note` and the
Tier-1 shared schema/constants/types that later notes tickets (AB-1005 pagination/sort/tag-filter,
AB-1006 tags, AB-1008 sharing, AB-1009 versions) will extend.

## Architectural Mapping (`SDS.md`)

- §2.1 `Note` Prisma model — **already exists** in `schema.prisma` (built in AB-1001); no new
  migration required. Title/body `CHECK` constraints, `search_vector` trigger, and GIN index are
  **already applied** in `20260710124549_init` — this ticket does not touch DB migrations.
- §4.1 Note CRUD layered request flow (router → controller → service → repository).
- §5.3 Pass 1 of the unified nightly cleanup job (Stage-2 permanent purge) — this ticket
  implements Pass 1 only; Passes 2–5 belong to AB-1009/AB-1002/AB-1003 respectively and are out
  of scope here.
- §7 Route matrix rows for `POST/GET/PATCH/DELETE /api/v1/notes(/:id)`, `POST /:id/restore`,
  `DELETE /:id/permanent` — narrowed per the Resolved Decisions below (no `tagIds`, no version
  snapshot side-effects, no share-link revocation — those belong to later tickets).

## Resolved Decisions (from clarification)

1. **`tagIds` omitted entirely.** `createNoteSchema`/`updateNoteSchema` in this ticket have no
   `tagIds` field. AB-1006 will extend the schema and add IDOR-checked tag attachment once `Tag`
   exists as a feature.
2. **Trashed-note direct access → `404 NOTE_NOT_FOUND`.** `GET/PATCH/DELETE /api/v1/notes/:id` on
   an already Stage-1-or-Stage-2 trashed note returns the same `404` as cross-user access or a
   nonexistent id — no distinguishing detail leaked (consistent with AGENTS.md §8's 404 semantics
   and the literal SDS §7 route-matrix wording).
3. **Cleanup job Pass 1 implemented now.** `apps/api/src/jobs/cleanup.job.ts` registers the
   `node-cron` schedule (Tier-2 `CRON_CLEANUP_SCHEDULE = '0 3 * * *'`) and implements exactly the
   Stage-2 permanent-purge pass (`prisma.note.deleteMany` past the 60-day cutoff, relying on
   `onDelete: Cascade` for `NoteTag`/`NoteVersion`/`ShareLink` rows). Later tickets append their
   own passes to the same job/file.
4. **Restore on an already-active note → `404 NOTE_NOT_FOUND`.** Same status/code as restoring a
   Stage-2/expired note or another user's note — restore only ever succeeds while the note is
   currently within the Stage-1 window; every other state collapses to the same `404`.

## Out of Scope (binding for this ticket)

- Pagination, sorting, tag filtering, and the `GET /api/v1/notes` / `GET /api/v1/notes/trash`
  list endpoints — entirely `[FRS-2.3]`, ticket **AB-1005**. This ticket exposes **no list
  endpoint at all**; "invisible while trashed" is verified at the repository/DB level, not via an
  HTTP list call.
- Tag CRUD, Fly Tags, `tagIds` attachment — `[FRS-3]`, ticket **AB-1006**.
- Full-text search — `[FRS-4]`, ticket **AB-1007**.
- Share link generation/revocation/public access and the FRS-2.2.4 "live share-link check on
  trash" behavior — `[FRS-5]`, ticket **AB-1008**. (No `ShareLink` service exists yet; `DELETE
/api/v1/notes/:id` in this ticket does **not** attempt to revoke share links.)
- Version snapshot creation/throttling on create/update, version list/view/restore, and version
  purge (cleanup job Pass 2) — `[FRS-6]`, ticket **AB-1009**.
- Cleanup job Passes 2–5 (versions, OTPs, login attempts, refresh sessions) — owned by
  AB-1009/AB-1002/AB-1003 respectively.

---

## ADDED Requirements

### Requirement: Shared Notes Contracts

`packages/shared` SHALL be the single source of truth for this delta: `createNoteSchema`,
`updateNoteSchema`, `permanentDeleteSchema` Zod schemas in `src/schemas/note.schema.ts`, each with
a corresponding `z.infer` type (or hand-typed `NoteResponseDto`, consistent with the existing
`auth.type.ts` precedent) in `src/types/note.type.ts` — no hand-written duplicate interfaces for
the input types. `APP_LIMITS` SHALL gain `NOTE_TITLE_MAX_CHARS (200)`, `NOTE_BODY_MAX_CHARS
(100000)`, `TRASH_STAGE_1_DAYS (30)`, `TRASH_STAGE_2_DAYS (30)`; every numeric value in this delta
SHALL reference one of these named exports, never a literal (`FRS-8.5`). `API_ERROR_CODES` SHALL
gain `NOTE_NOT_FOUND`. `API_PATHS` SHALL gain `NOTES: { ROOT: "/notes", RESTORE: "/restore",
PERMANENT: "/permanent" }` under `/api/v1`.

#### Scenario: Zod schemas and constants live only in packages/shared

- **WHEN** `apps/api` needs the notes request shapes or numeric limits for this delta
- **THEN** it imports `createNoteSchema`/`updateNoteSchema`/`permanentDeleteSchema` from
  `@shared/core/schemas` and `APP_LIMITS`/`API_ERROR_CODES`/`API_PATHS` from
  `@shared/core/constants` — no duplicate schema, type, or numeric literal exists in the backend

### Requirement: Create Note

`POST /api/v1/notes` SHALL accept `{ title, body }` validated by `createNoteSchema` and create a
`Note` owned by the authenticated caller (`FRS-2.1.1`). Title is required (trimmed, 1–200 chars,
`FRS-2.1.5`/`FRS-2.1.6`); body is optional-length up to 100,000 chars with no minimum (`FRS-2.1.6`).
`createdAt`/`updatedAt` SHALL be tracked and returned as UTC ISO strings (`FRS-2.1.4`, `FRS-8.2`).

#### Scenario: Valid title and body creates a note owned by the caller

- **WHEN** an authenticated user submits a trimmed non-empty title (≤200 chars) and a body
  (≤100,000 chars, including an empty body)
- **THEN** the service creates a `Note` row scoped to `userId`, and the controller returns
  `201 Created` `{ success: true, data: NoteResponse }` with UTC `createdAt`/`updatedAt`

#### Scenario: Empty or whitespace-only title is rejected

- **WHEN** the submitted title is empty or entirely whitespace
- **THEN** `createNoteSchema` rejects the request with `400 VALIDATION_ERROR` naming `title`, and
  no `Note` row is created

#### Scenario: Title or body over its character cap is rejected server-side

- **WHEN** title exceeds 200 characters or body exceeds 100,000 characters, even if a client-side
  check would have allowed it
- **THEN** `createNoteSchema` rejects the request with `400 VALIDATION_ERROR` naming the offending
  field and its limit, and no `Note` row is created

### Requirement: Read Note By Id

`GET /api/v1/notes/:id` SHALL return the caller's own active (non-trashed) note, or
`404 NOTE_NOT_FOUND` for cross-user access, a nonexistent id, or a note currently in Stage 1 or
Stage 2 trash (`FRS-2.1.2`, `FRS-2.2.3`, Resolved Decision #2). The response DTO SHALL NOT expose
`userId`.

#### Scenario: Own active note returns 200 with the note DTO

- **WHEN** the authenticated caller requests a note they own that has `deletedAt IS NULL`
- **THEN** the service returns `200 OK` `{ success: true, data: NoteResponse }` with no `userId`
  field present

#### Scenario: Cross-user, nonexistent, or trashed note collapses to an identical 404

- **WHEN** the requested note belongs to another user, does not exist, or currently has
  `deletedAt IS NOT NULL` (Stage 1 or Stage 2)
- **THEN** the service returns `404 NOTE_NOT_FOUND` in every case, with no distinguishing detail
  leaked between "not mine," "doesn't exist," and "trashed"

### Requirement: Update Note

`PATCH /api/v1/notes/:id` SHALL accept a partial `{ title?, body? }` update validated by
`updateNoteSchema`, requiring at least one field present (`FRS-2.1.3`). The same title/body
validation rules as create apply. A currently trashed note (Stage 1 or 2) SHALL NOT be editable
directly — the caller must restore it first.

#### Scenario: Partial update succeeds for title-only or body-only

- **WHEN** the caller submits only `title` or only `body` on their own active note
- **THEN** the service updates exactly the submitted field(s), leaves the other field unchanged,
  and returns `200 OK` `{ success: true, data: NoteResponse }` with a refreshed `updatedAt`

#### Scenario: Omitting both title and body is rejected

- **WHEN** the request body contains neither `title` nor `body`
- **THEN** `updateNoteSchema`'s `.refine` rejects the request with `400 VALIDATION_ERROR`

#### Scenario: Updating a trashed note is rejected

- **WHEN** the target note currently has `deletedAt IS NOT NULL` (Stage 1 or Stage 2), regardless
  of ownership
- **THEN** the service returns `404 NOTE_NOT_FOUND` — the caller must restore the note before it
  becomes editable again

### Requirement: Soft Delete Into Stage 1 Trash

`DELETE /api/v1/notes/:id` SHALL set `deletedAt = now()` on the caller's own active note and SHALL
NOT perform a physical delete (`FRS-2.2.1`). Once trashed, the note is excluded from direct
`GET`/`PATCH`/`DELETE` access (see Read/Update requirements above) for up to 30 days (`FRS-2.2.2`,
`FRS-2.2.3`).

#### Scenario: Soft delete sets deletedAt without removing the row

- **WHEN** the caller deletes their own active note
- **THEN** the service sets `deletedAt = now()` on the `Note` row, the row remains physically
  present in the database, and the controller returns `200 OK` `{ success: true, data:
NoteResponse }` with `deletedAt` populated

### Requirement: Restore Note From Stage 1

`POST /api/v1/notes/:id/restore` SHALL clear `deletedAt` on the caller's own note only while it is
currently within the Stage-1 window (`deletedAt IS NOT NULL AND deletedAt >= now() - 30 days`).
Every other state — never trashed, already Stage 2, or cross-user — SHALL return the identical
`404 NOTE_NOT_FOUND` (`FRS-2.2.2`, `FRS-2.2.5`, Resolved Decision #4).

#### Scenario: Restore within the Stage-1 window clears deletedAt

- **WHEN** the caller restores their own note that was trashed less than 30 days ago (including
  the boundary at 29 days 23 hours 59 minutes)
- **THEN** the service clears `deletedAt` and returns `200 OK` `{ success: true, data:
NoteResponse }` with `deletedAt: null`

#### Scenario: Restore outside Stage 1, never-trashed, or cross-user all return the same 404

- **WHEN** the note was never trashed, was trashed 30 days or more ago (Stage 2), or belongs to
  another user
- **THEN** the service returns `404 NOTE_NOT_FOUND` in every case, with no distinguishing detail
  leaked between the three causes

### Requirement: Permanent Delete From Stage 1

`DELETE /api/v1/notes/:id/permanent` SHALL require `{ confirm: true }` (`permanentDeleteSchema`)
and SHALL physically remove the note — cascading to `NoteTag`/`NoteVersion`/`ShareLink` rows via
FK `onDelete: Cascade` — only while the note is currently within the Stage-1 window, identical to
the restore gate (`FRS-2.2.7`, `FRS-2.2.8`).

#### Scenario: Confirmed permanent delete within Stage 1 physically removes the note

- **WHEN** the caller sends `{ confirm: true }` against their own note currently within the
  Stage-1 window
- **THEN** the service physically deletes the `Note` row (and cascades), and the controller
  returns `200 OK` `{ success: true, data: { id } }`

#### Scenario: Missing or false confirm is rejected without deleting anything

- **WHEN** `confirm` is omitted or `false`
- **THEN** `permanentDeleteSchema` rejects the request with `400 VALIDATION_ERROR` and no row is
  deleted

#### Scenario: Permanent delete outside Stage 1 or cross-user returns 404

- **WHEN** the note is already Stage 2, was never trashed, or belongs to another user
- **THEN** the service returns `404 NOTE_NOT_FOUND` in every case, identical to the restore gate,
  and no row is deleted

### Requirement: Stage-2 Nightly Purge (Cleanup Job Pass 1)

The shared cleanup job (`apps/api/src/jobs/cleanup.job.ts`) SHALL register a `node-cron` task on
the Tier-2 `CRON_CLEANUP_SCHEDULE` (`'0 3 * * *'`) that permanently deletes any note whose
`deletedAt` is older than `TRASH_STAGE_1_DAYS + TRASH_STAGE_2_DAYS` (60 days total), cascading to
related rows (`FRS-2.2.6`, `FRS-2.2.7`, `FRS-8a.1`, `FRS-8a.2` notes category). The pass SHALL be
safe to invoke repeatedly and concurrently without error or double-processing (`FRS-8a.4`).

#### Scenario: Notes past the 60-day cutoff are permanently purged

- **WHEN** the purge pass runs (`runNotesPurgePass()`, directly or via the cron schedule)
- **THEN** every note with `deletedAt` older than the 60-day cutoff (and any `NoteTag`/
  `NoteVersion`/`ShareLink` rows referencing it) is physically removed, while a note at
  59 days 23 hours 59 minutes since `deletedAt` survives

#### Scenario: Repeated purge passes are idempotent

- **WHEN** `runNotesPurgePass()` is invoked twice back-to-back with no new eligible notes between
  runs
- **THEN** the second run causes no error and deletes zero additional rows

---

## Error Scenarios (this ticket's exact behavior)

| Scenario                                                       | Response                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| Cross-user note access (any of the 6 endpoints)                | `404 NOTE_NOT_FOUND`                                       |
| Empty/whitespace title on create/update                        | `400 VALIDATION_ERROR`, names `title`                      |
| Title > 200 chars / body > 100,000 chars                       | `400 VALIDATION_ERROR`, names field + limit                |
| `GET/PATCH/DELETE` on a Stage-1 or Stage-2 trashed note        | `404 NOTE_NOT_FOUND`                                       |
| Restore on an active (never-trashed) note                      | `404 NOTE_NOT_FOUND`                                       |
| Restore on a Stage-2 (>30d trashed) note                       | `404 NOTE_NOT_FOUND`                                       |
| Permanent-delete on a Stage-2 note, or without `confirm: true` | `404 NOTE_NOT_FOUND` / `400 VALIDATION_ERROR` respectively |
| Restore/permanent-delete on another user's note                | `404 NOTE_NOT_FOUND`                                       |

## Acceptance Criteria Traceability (informational — test-writer derives from FRS text above, not this list)

Maps to `docs/FRS.md` Acceptance Criteria (AB-1004 — §2.1–2.2): create/read/update with
validation, cross-user 404, UTC timestamps, Stage 1 soft-delete + 30d restorability, Stage 1 → 2
transition at day 31 (verified via repository/DB query, no list endpoint exists in this ticket),
Stage 2 → permanent purge at day 60 (verified via the cleanup job), delete-forever requires
confirmation and is immediate, editing a Stage-1 note without restoring first is rejected, any
action on a Stage-2 note is not-found.
