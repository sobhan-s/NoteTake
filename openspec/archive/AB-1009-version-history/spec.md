# version-history Specification

## Purpose

Append-only version snapshots for notes — automatic throttled capture on update, unconditional
capture on create and explicit save, list/view of history, non-destructive restore, and
90-day-retention auto-purge exempting each note's absolute latest snapshot (`FRS-6.1`–`FRS-6.5`,
`SDS §4.4`, `SDS §5.3 Pass 2`). Ticket: `AB-1009`.

## Objective

Give every note an append-only audit trail of its own content so a user can recover from an
unwanted edit without ever losing intervening history, while keeping storage bounded by throttling
noisy autosave snapshots and purging snapshots older than the retention window.

## Out of Scope

- Diff/comparison view between two versions (`FRS-6` Out of Scope) — no unified/side-by-side diff
  rendering or diff algorithm in this delta.
- Manual pinning of specific versions to exempt them from purge (`FRS-6` Out of Scope).
- Frontend components (`<VersionHistoryDrawer />`, `<VersionPreviewModal />`,
  `<AutosaveIndicator />`) and the `isExplicitSave` UI trigger wiring — those are `FRS §7` /
  `AB-1010`+ frontend tickets. This delta is backend-only (`AB-1002..AB-1009 → BACKEND` per the
  ticket scope map).
- Swagger/OpenAPI doc authoring for the new routes — tracked the same way `AB-1007`
  (`6a8107d` search feature / `87709ee` docs commit) split feature and docs into separate commits;
  `tasks.md` will call this out as its own checkpoint, not part of this spec's behavioral scope.

## ADDED Requirements

### Requirement: Shared Version History Contracts

`packages/shared` SHALL gain the following, with every numeric value referencing a named
`APP_LIMITS` export (`FRS-8.5`) — no literal `5`, `90`, `"/versions"`, etc. anywhere in `apps/api`:

- `APP_LIMITS` gains `VERSION_SNAPSHOT_THROTTLE_MINUTES: 5` (`FRS-6.1`) and
  `VERSION_RETENTION_DAYS: 90` (`FRS-6.5`).
- `API_PATHS.NOTES` gains `VERSIONS: "/versions"`. The existing `API_PATHS.NOTES.RESTORE`
  (`"/restore"`) is **reused** for the version-restore sub-route — no duplicate path literal.
- `API_ERROR_CODES` gains `VERSION_NOT_FOUND` — used identically whether a version id doesn't
  exist, belongs to a different note, belongs to another user's note, or has been purged past
  retention (never disambiguated to the caller, mirroring the existing `SHARE_LINK_UNAVAILABLE`
  "no longer available" pattern).
- `src/schemas/note.schema.ts`'s existing `updateNoteSchema` (MODIFIED) gains an
  `isExplicitSave: z.boolean().default(false)` field:

  ```typescript
  export const updateNoteSchema = z
    .object({
      title: z.string().trim().min(1, ...).max(APP_LIMITS.NOTE_TITLE_MAX_CHARS, ...).optional(),
      body: z.string().max(APP_LIMITS.NOTE_BODY_MAX_CHARS, ...).optional(),
      isExplicitSave: z.boolean().default(false),
    })
    .refine((data) => data.title !== undefined || data.body !== undefined, { ... });
  ```

- `src/types/note.type.ts` gains, alongside the existing `UpdateNoteInput` (now including
  `isExplicitSave: boolean`):

  ```typescript
  export type NoteVersionSummaryDto = {
    id: string;
    titleSnapshot: string;
    createdAt: string;
  };

  export type NoteVersionResponseDto = {
    id: string;
    noteId: string;
    titleSnapshot: string;
    bodySnapshot: string;
    createdAt: string;
  };
  ```

#### Scenario: Zod schema and constants live only in packages/shared

- **WHEN** `apps/api` needs the `isExplicitSave` field, the throttle/retention limits, or the
  version route paths for this delta
- **THEN** it imports the extended `updateNoteSchema` and new DTOs from `@shared/core/schemas` /
  `@shared/core/types`, and `APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES` /
  `APP_LIMITS.VERSION_RETENTION_DAYS` / `API_PATHS.NOTES.VERSIONS` from `@shared/core/constants` —
  no duplicate schema, type, or numeric literal exists in the backend

### Requirement: Version Snapshot on Note Creation

`POST /api/v1/notes` (existing endpoint, MODIFIED) SHALL unconditionally create the note's first
`NoteVersion` snapshot in the same transaction as note creation (`FRS-6.1`, `SDS` route table).

#### Scenario: Creating a note creates exactly one initial version

- **WHEN** the caller creates a note with `{ title, body }`
- **THEN** `201 Created` returns the note, and exactly one `NoteVersion` row exists for it with
  `titleSnapshot`/`bodySnapshot` matching the created `title`/`body`

### Requirement: Throttled Version Snapshot on Note Update

`PATCH /api/v1/notes/:id` (existing endpoint, MODIFIED) SHALL apply `isExplicitSave` to decide
whether the update creates a new `NoteVersion` snapshot or only touches the live `Note` row
(`FRS-6.1`, `SDS §4.4`):

1. If `isExplicitSave === true`, always insert a new `NoteVersion` snapshot of the resulting
   `title`/`body`, bypassing the throttle window entirely.
2. If `isExplicitSave === false`, look up the note's most recent `NoteVersion` by `createdAt DESC`.
   If less than `APP_LIMITS.VERSION_SNAPSHOT_THROTTLE_MINUTES` (5 minutes) has elapsed since it,
   update only the `Note` row (`title`, `body`, `updatedAt`) — no new snapshot.
3. If `isExplicitSave === false` and at least 5 minutes has elapsed (or no prior version exists),
   insert a new `NoteVersion` snapshot alongside the `Note` update.

All three paths remain scoped to the caller's own, active (non-deleted) note — cross-user or
trashed note ids continue to 404 via the existing `NOTE_NOT_FOUND` ownership check, unchanged by
this delta.

#### Scenario: Explicit save always creates a version, even inside the throttle window

- **WHEN** the last snapshot for a note was created 30 seconds ago, and the caller `PATCH`es with
  `{ body: "...", isExplicitSave: true }`
- **THEN** a new `NoteVersion` row is created immediately, in addition to the 30-second-old one

#### Scenario: Autosave within the 5-minute window updates content but skips a snapshot

- **WHEN** the last snapshot for a note was created 2 minutes ago, and the caller `PATCH`es with
  `{ body: "...", isExplicitSave: false }` (or `isExplicitSave` omitted)
- **THEN** `200 OK` reflects the new `body`, but no new `NoteVersion` row is created — the version
  count for the note is unchanged

#### Scenario: Autosave at or past the 5-minute window creates a new snapshot

- **WHEN** the last snapshot for a note was created 5 minutes and 1 second ago, and the caller
  `PATCH`es with `{ body: "...", isExplicitSave: false }`
- **THEN** a new `NoteVersion` row is created capturing the resulting `title`/`body`

#### Scenario: isExplicitSave defaults to false when omitted

- **WHEN** the caller `PATCH`es `{ title: "New title" }` with no `isExplicitSave` field at all
- **THEN** `updateNoteSchema` defaults `isExplicitSave` to `false` and the update follows the
  autosave throttle path, not the explicit-save bypass

### Requirement: List Version History

`GET /api/v1/notes/:id/versions` SHALL return every `NoteVersion` for a note owned by the caller,
reverse-chronological by `createdAt` (`FRS-6.2`).

#### Scenario: Versions are returned newest-first with timestamps

- **WHEN** a note has 3 versions created at distinct times
- **THEN** `200 OK` returns `{ versions: NoteVersionSummaryDto[] }` ordered newest `createdAt` first

#### Scenario: A brand-new note's history contains its single initial version

- **WHEN** the caller immediately lists history right after creating a note (no updates yet)
- **THEN** exactly one version is returned — the initial creation snapshot

#### Scenario: Requesting another user's note history is not found

- **WHEN** the caller requests `GET /api/v1/notes/:id/versions` for a note id owned by a different
  user, or one that doesn't exist at all
- **THEN** `404 Not Found` (`NOTE_NOT_FOUND`) is returned — never `403` (`FRS-6` Error Scenarios)

#### Scenario: Requesting history for a trashed note is not found

- **WHEN** the caller requests version history for their own note that currently has
  `deletedAt` set (Stage 1 or Stage 2)
- **THEN** `404 Not Found` (`NOTE_NOT_FOUND`) is returned, consistent with every other
  note-scoped sub-resource (`GET /:id`, share links) rejecting trashed notes the same way

### Requirement: View Full Version Content

`GET /api/v1/notes/:id/versions/:versionId` SHALL return the full `titleSnapshot`/`bodySnapshot`
of one historical version (`FRS-6.3`).

#### Scenario: Viewing an existing version returns its full snapshot content

- **WHEN** the caller requests a `versionId` that belongs to their own, active note
- **THEN** `200 OK` returns `{ id, noteId, titleSnapshot, bodySnapshot, createdAt }` exactly as
  captured at snapshot time

#### Scenario: Viewing a version id that belongs to a different note is not found

- **WHEN** `versionId` exists but its `noteId` does not match the `:id` in the URL
- **THEN** `404 Not Found` (`VERSION_NOT_FOUND`) is returned — a version id is never resolvable
  outside the note it was scoped from in the URL

#### Scenario: Viewing a purged version is not found

- **WHEN** `versionId` refers to a version already removed by the nightly retention purge
  (`FRS-6.5`)
- **THEN** `404 Not Found` (`VERSION_NOT_FOUND`) — identical "no longer available" outcome to a
  version id that never existed, no distinguishing detail leaks

### Requirement: Restore a Version

`POST /api/v1/notes/:id/versions/:versionId/restore` SHALL copy a historical version's
`titleSnapshot`/`bodySnapshot` onto the live `Note`, and append that restored content as a **new**
top-of-history `NoteVersion` — never deleting, overwriting, or reordering any existing version row
(`FRS-6.4`).

#### Scenario: Restoring an older version overwrites the live note and appends new history

- **WHEN** the caller restores a version from 3 versions ago
- **THEN** `200 OK` returns the updated `NoteResponseDto` with `title`/`body` matching the restored
  snapshot, and a brand new `NoteVersion` row is appended capturing that same restored content —
  all previously existing versions (including the one just restored) remain untouched and
  independently queryable via the list endpoint

#### Scenario: Restore bypasses the autosave throttle unconditionally

- **WHEN** the note's most recent snapshot was created 10 seconds ago, and the caller restores a
  version
- **THEN** the new post-restore `NoteVersion` is still appended immediately — restore is never
  skipped or merged by the 5-minute autosave throttle, the same way an explicit save isn't

#### Scenario: Restoring on a since-trashed note is rejected

- **WHEN** the note has been soft-deleted (`deletedAt` set, Stage 1 or Stage 2) since the version
  was captured
- **THEN** `404 Not Found` (`NOTE_NOT_FOUND`) is returned, no `Note` or `NoteVersion` row is
  modified (`FRS-6` Error Scenarios)

#### Scenario: Restoring a version id from a different note or another user's note is rejected

- **WHEN** `versionId` belongs to a different note, or the `:id` note belongs to a different user
- **THEN** `404 Not Found` (`NOTE_NOT_FOUND` for the note-ownership check, `VERSION_NOT_FOUND` for
  the version-scope check) is returned, nothing is modified

### Requirement: Automatic Version Retention Purge

The unified nightly cleanup job (`03:00 UTC`, `SDS §5.3`) SHALL gain a version-purge pass deleting
`NoteVersion` rows older than `APP_LIMITS.VERSION_RETENTION_DAYS` (90 days), always exempting the
single most recent version per note regardless of its age (`FRS-6.5`).

#### Scenario: Versions older than 90 days are purged, except each note's latest

- **WHEN** a note has 5 versions, the 4 oldest are all older than 90 days, and the newest is also
  older than 90 days (the note hasn't been touched recently)
- **THEN** the purge pass deletes the 3 versions older than 90 days that are **not** the latest,
  and leaves the single newest version intact even though it too is past the 90-day threshold

#### Scenario: Purge pass is idempotent and safe to re-run

- **WHEN** the purge pass runs twice in a row with no new versions created in between
- **THEN** the second run deletes zero rows and raises no error — matches the shared cleanup
  system's idempotency contract (`FRS-8a.4`)

#### Scenario: Purge never touches the current live version regardless of age

- **WHEN** a note was created 200 days ago and never updated since (its one and only version is
  200 days old)
- **THEN** that version is never purged — the "exempt the latest version per note" rule, not an
  absolute age cutoff, decides what's safe to keep

## Clarifying Questions

1. Should `GET /api/v1/notes/:id/versions` and `GET /api/v1/notes/:id/versions/:versionId` 404 for
   a currently-trashed note (Stage 1 or Stage 2), matching every other note-scoped sub-resource
   (`GET /:id`, share links)? FRS only explicitly calls out **restore**-on-trashed as rejected —
   I've assumed list/view follow the same "active note only" rule for consistency; confirm or
   override.
2. Confirm `GET /api/v1/notes/:id/versions` returns the full un-paginated array (matching the
   SDS route table's `{ versions: NoteVersionSummaryResponse[] }` with no `pagination` object),
   rather than adopting the paginated shape used by `/notes` and `/notes/trash`.
3. OK to introduce a new `VERSION_NOT_FOUND` error code (distinct from `NOTE_NOT_FOUND`) for
   version-scope failures (wrong note, purged, nonexistent), rather than reusing `NOTE_NOT_FOUND`
   for those cases too?
4. Confirm restore is unconditional (always appends a new version, bypassing the 5-minute
   throttle entirely) rather than being subject to the same throttle window as an autosave.
5. Confirm the OpenSpec domain name `version-history` (new folder, mirroring the existing
   `search`/`tags` domain-per-feature precedent) rather than folding this delta into a `notes`
   domain that doesn't currently exist as its own `openspec/specs/` folder.
