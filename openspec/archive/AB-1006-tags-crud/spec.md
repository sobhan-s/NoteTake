# Spec Delta — AB-1006: Tags CRUD, Live Note Count & Fly Tags

Domain: `tags`. Target: `FRS-3.1–3.4` (tag CRUD, uniqueness, live count, Fly Tag creation).

## Executive Summary

Adds the full backend CRUD surface for user-scoped tags: `POST /api/v1/tags` (create — doubles as
the "Fly Tag" on-the-fly creation endpoint called identically from the note editor and the
search/filter bar, per `FRS-3.1`), `GET /api/v1/tags` (list, with a live non-deleted-note count per
tag, `FRS-3.2`), `PATCH /api/v1/tags/:id` (rename and/or recolor, `FRS-3.1`), and
`DELETE /api/v1/tags/:id` (detach from all notes without deleting the notes, `FRS-3.3`). The `Tag`
and `NoteTag` Prisma models already exist (provisioned in `AB-1001`) with native `Citext` on
`Tag.name` and the `@@unique([userId, name])` constraint already in place — this ticket adds no
migration, only the four `apps/api` endpoints and their `packages/shared` contracts. Attaching tags
to notes via `tagIds` (create/update/list-filter) is already implemented (`AB-1004`, `AB-1005`) and
is explicitly out of scope here; this ticket only manages the `Tag` rows themselves. Frontend
`TagCombobox`/Fly Tag UI components are `FRS §7`, tickets `AB-1010`–`AB-1012` — out of scope.

## Architectural Mapping (`SDS.md`)

- §2.1 `Tag` model (`name @db.Citext`, `color @db.VarChar(9)` default `#6B7280`,
  `@@unique([userId, name])`) — already provisioned, reused as-is.
- §2.2 `tags_color_hex_check CHECK (color ~* '^#[0-9a-f]{6}([0-9a-f]{2})?$')` — already provisioned;
  the shared Zod `color` regex below mirrors this exact constraint.
- §4.2 Fly Tags Dynamic Creation Flow — adopted with the **Resolved Decision #1 override** below in
  place of SDS §4.2's "200 OK or 409 Conflict handled gracefully" ambiguity.
- §7 route matrix rows for `POST/GET /api/v1/tags` and `PATCH/DELETE /api/v1/tags/:id`
  (`[FRS-3.1–3.4]`).
- `apps/api/CLAUDE.md` layering: `tag.router.ts` → `tag.controller.ts` → `tag.service.ts` →
  `tag.repository.ts`, mirroring the existing `note.*` layer files exactly (schema.parse in
  controller only, ownership/IDOR checks in service, Prisma calls in repository).

## Resolved Decisions (from clarification)

1. **Duplicate tag name (case-insensitive, same user) is rejected with `409 Conflict`, not an
   idempotent 200.** FRS-3's Error Scenarios state plainly: "Duplicate tag name for same user →
   rejected." This supersedes SDS §4.2's looser "200 OK or 409 Conflict handled gracefully" prose
   for this ticket — `SDS.md` should be updated to match in a follow-up doc-sync. Applies to both
   `POST /api/v1/tags` (create) and `PATCH /api/v1/tags/:id` (rename). The Fly Tag UI (out of scope
   here) is expected to call `GET /api/v1/tags` first and only `POST` a name it doesn't already see;
   a `409` on a genuine race is the correct, rare-path signal, not a silent merge.
2. **`Tag.name` is capped at 50 characters** (new `APP_LIMITS.TAG_NAME_MAX_CHARS`). Neither
   `FRS.md` nor `SDS.md` specifies a length cap for the bare `citext` column (unlike `Note.title`'s
   explicit 200-char cap) — 50 is adopted as a reasonable implementation default, enforced as a
   named constant per `FRS-8.5` (never a bare literal in `apps/api`).
3. **`color` is optional on create**, defaulting to `#6B7280` via `.default(APP_LIMITS` equivalent
   constant in the shared schema — mirroring the Prisma column default — rather than SDS §7's
   literal `createTagSchema (name, color)` reading as both-required. `color` remains optional on
   update (renaming without recoloring is a normal, non-empty update).
4. **`GET /api/v1/tags` returns tags ordered alphabetically by `name`, case-insensitive
   (`ORDER BY name COLLATE "C"` is not needed — `citext`'s native comparison already sorts
   case-insensitively).** Neither FRS nor SDS specifies an order; alphabetical is adopted for
   scan/pick UX in a tag combobox, distinct from the notes list's recency-based default.
5. **`noteCount` appears on every `TagResponseDto`** — create, update, and list responses share one
   DTO shape; a freshly created tag simply returns `noteCount: 0`. This avoids a second "list item"
   DTO shape existing solely to add one field, consistent with AB-1005's precedent of reusing one
   `NoteResponseDto` everywhere (no FRS/SDS mandate for a slimmer create/update response).
6. **`noteCount` is computed live via a join-count query at read time, not a stored counter
   column.** The Prisma `Tag` model has no counter field, and FRS-3.2's "live count" wording (plus
   the requirement that it updates correctly as notes are tagged/untagged/trashed/restored) is best
   satisfied by counting `NoteTag` rows joined to non-deleted `Note` rows on every read — a stored
   counter would need to be kept in sync across four other tickets' mutation paths (note create,
   update-tags, soft-delete, restore) and risks drift. No new migration required.
7. **A tag's own current name is exempt from its own duplicate check on rename.** Submitting
   `PATCH /api/v1/tags/:id` with `name` unchanged (or changed only in case) against the same tag is
   a normal successful no-op-on-name update, not a self-conflict — the uniqueness check excludes the
   tag's own `id`.

## Out of Scope (binding for this ticket)

- Attaching/detaching tags on notes via `tagIds` (`createNoteSchema`/`updateNoteSchema`) and tag-based
  note-list filtering (`tagIds`/`tagMode` on `GET /api/v1/notes`) — already implemented and archived
  under **AB-1004**/**AB-1005**. This ticket does not touch `note.schema.ts`, `NoteTag`, or the notes
  endpoints at all.
- Frontend `TagCombobox.tsx` / Fly Tag UI, inline creation affordance inside the editor or
  search/filter bar — `[FRS §7]`, tickets **AB-1010–AB-1012**.
- Full-text search integration (`FRS §4`) — ticket **AB-1007**.
- Shared/team tags, nested/hierarchical tags — explicitly out of scope per `FRS.md` §3 "Out of Scope
  (Tags)".
- Any DB migration — the `Tag`/`NoteTag` models and the `tags_color_hex_check` constraint already
  exist from `AB-1001`.

---

## ADDED Requirements

### Requirement: Shared Tag Contracts

`packages/shared` SHALL gain the following, with every numeric value referencing a named
`APP_LIMITS` export (`FRS-8.5`) — no literal `50`, `"#6B7280"`, etc. anywhere in `apps/api`:

- `APP_LIMITS` gains `TAG_NAME_MAX_CHARS: 50` and `TAG_DEFAULT_COLOR: "#6B7280"`.
- `API_PATHS` gains `TAGS: { ROOT: "/tags" }`.
- `API_ERROR_CODES` gains `TAG_NOT_FOUND` and `TAG_NAME_CONFLICT`.
- `VALIDATION_MESSAGES` gains `TAG_NAME_REQUIRED`, `TAG_NAME_TOO_LONG`, `TAG_COLOR_INVALID`,
  `TAG_UPDATE_EMPTY`, and `TAG_NAME_CONFLICT` (user-facing message for the 409 case).
- `src/schemas/tag.schema.ts` gains:

  ```typescript
  const tagColorSchema = z
    .string()
    .regex(
      /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/,
      VALIDATION_MESSAGES.TAG_COLOR_INVALID,
    );

  export const createTagSchema = z.object({
    name: z
      .string()
      .trim()
      .min(1, VALIDATION_MESSAGES.TAG_NAME_REQUIRED)
      .max(
        APP_LIMITS.TAG_NAME_MAX_CHARS,
        VALIDATION_MESSAGES.TAG_NAME_TOO_LONG,
      ),
    color: tagColorSchema.default(APP_LIMITS.TAG_DEFAULT_COLOR),
  });

  export const updateTagSchema = z
    .object({
      name: z
        .string()
        .trim()
        .min(1, VALIDATION_MESSAGES.TAG_NAME_REQUIRED)
        .max(
          APP_LIMITS.TAG_NAME_MAX_CHARS,
          VALIDATION_MESSAGES.TAG_NAME_TOO_LONG,
        )
        .optional(),
      color: tagColorSchema.optional(),
    })
    .refine((data) => data.name !== undefined || data.color !== undefined, {
      message: VALIDATION_MESSAGES.TAG_UPDATE_EMPTY,
    });
  ```

- `src/types/tag.type.ts` gains `z.infer` types `CreateTagInput`/`UpdateTagInput`, plus:

  ```typescript
  export type TagResponseDto = {
    id: string;
    name: string;
    color: string;
    noteCount: number;
    createdAt: string;
    updatedAt: string;
  };
  ```

#### Scenario: Zod schemas and constants live only in packages/shared

- **WHEN** `apps/api` needs the tag request/response shapes or numeric limits for this delta
- **THEN** it imports `createTagSchema`/`updateTagSchema` from `@shared/core/schemas` and
  `APP_LIMITS.TAG_NAME_MAX_CHARS`/`APP_LIMITS.TAG_DEFAULT_COLOR`/`API_PATHS.TAGS.ROOT` from
  `@shared/core/constants` — no duplicate schema, type, or numeric literal exists in the backend

### Requirement: Create Tag (Fly Tag Creation)

`POST /api/v1/tags` SHALL create a tag scoped to the authenticated caller (`FRS-3.1`), rejecting an
empty/whitespace name and any name exceeding `APP_LIMITS.TAG_NAME_MAX_CHARS`, and rejecting a name
that collides case-insensitively with one of the caller's own existing tags (`FRS-3.4`) with
`409 Conflict` naming the conflicting field (Resolved Decision #1).

#### Scenario: Valid name with explicit color creates a new tag

- **WHEN** the caller `POST`s `{ name: "DevOps", color: "#3B82F6" }`
- **THEN** a new `Tag` row is created scoped to the caller, and `201 Created` returns
  `{ id, name: "DevOps", color: "#3B82F6", noteCount: 0, createdAt, updatedAt }`

#### Scenario: Omitted color defaults to #6B7280

- **WHEN** the caller `POST`s `{ name: "Ideas" }` with no `color` field
- **THEN** the created tag's `color` is `APP_LIMITS.TAG_DEFAULT_COLOR` (`"#6B7280"`)

#### Scenario: Empty or whitespace-only name is rejected

- **WHEN** `name` is `""`, `"   "`, or omitted entirely
- **THEN** `createTagSchema` rejects with `400 VALIDATION_ERROR` naming `name`, and no row is created

#### Scenario: Name exceeding the max length is rejected

- **WHEN** `name` exceeds `APP_LIMITS.TAG_NAME_MAX_CHARS` (50) characters
- **THEN** `createTagSchema` rejects with `400 VALIDATION_ERROR` naming `name` and the limit

#### Scenario: Malformed color is rejected

- **WHEN** `color` does not match `^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$` (e.g. `"blue"`, `"#fff"`,
  missing `#`)
- **THEN** `createTagSchema` rejects with `400 VALIDATION_ERROR` naming `color`

#### Scenario: Duplicate name for the same user (any case) is rejected

- **WHEN** the caller already owns a tag named `"Work"` and `POST`s `{ name: "WORK" }` or
  `{ name: "work" }`
- **THEN** the service returns `409 Conflict` with `API_ERROR_CODES.TAG_NAME_CONFLICT`, no new row
  is created, and the existing tag is left untouched

#### Scenario: Same name is allowed across different users

- **WHEN** two different users each `POST` `{ name: "Work" }`
- **THEN** both succeed independently — the `@@unique([userId, name])` constraint scopes uniqueness
  per user, not globally

### Requirement: List Tags With Live Note Counts

`GET /api/v1/tags` SHALL return only the caller's own tags (`FRS-3.1`), each annotated with a live
count of that tag's currently non-deleted notes (`FRS-3.2`), ordered alphabetically by `name`
case-insensitively (Resolved Decision #4).

#### Scenario: Returns the caller's own tags, alphabetically ordered

- **WHEN** the caller has tags `"Zeta"`, `"apple"`, `"Mango"`
- **THEN** `200 OK` returns them ordered `"apple", "Mango", "Zeta"` (case-insensitive alphabetical)

#### Scenario: noteCount reflects only active (non-deleted) notes

- **WHEN** a tag is attached to 3 notes, one of which is currently in Trash (Stage 1 or Stage 2)
- **THEN** its `noteCount` is `2`, not `3`

#### Scenario: noteCount updates live as notes are tagged, untagged, trashed, or restored

- **WHEN** a note bearing a tag is trashed, later restored, or the tag is attached/detached via the
  existing `tagIds` note update flow (`AB-1004`)
- **THEN** the very next `GET /api/v1/tags` call reflects the updated count with no caching lag and
  no manual recompute step — the count is derived fresh from current `NoteTag`/`Note.deletedAt`
  state on every request

#### Scenario: Cross-user tags never appear

- **WHEN** another user owns tags
- **THEN** they are excluded entirely from the caller's list — the query is scoped to
  `WHERE tags.user_id = :callerId` with no override parameter available (`FRS-8.1` principle applied
  to tags)

#### Scenario: No tags yet returns an empty list, not an error

- **WHEN** the caller has never created a tag
- **THEN** `200 OK` returns `{ tags: [] }`

### Requirement: Rename / Recolor Tag

`PATCH /api/v1/tags/:id` SHALL update `name` and/or `color` on a tag owned by the caller (`FRS-3.1`),
rejecting an empty request body, rejecting a rename that collides case-insensitively with a
_different_ tag the caller already owns (`FRS-3.4`), and returning `404 Not Found` for a tag the
caller does not own (never `403`, consistent with `[FRS-2.1.2]`'s cross-user "not found" pattern
applied identically to tags).

#### Scenario: Rename only

- **WHEN** the caller `PATCH`s `{ name: "Personal" }` on their own tag
- **THEN** `200 OK` returns the tag with the new `name`, unchanged `color`

#### Scenario: Recolor only

- **WHEN** the caller `PATCH`s `{ color: "#EF4444" }` on their own tag
- **THEN** `200 OK` returns the tag with the new `color`, unchanged `name`

#### Scenario: Both name and color in one request

- **WHEN** the caller `PATCH`s `{ name: "Personal", color: "#EF4444" }`
- **THEN** both fields update atomically in `200 OK`'s response

#### Scenario: Empty request body is rejected

- **WHEN** the caller `PATCH`s `{}` (neither `name` nor `color` present)
- **THEN** `updateTagSchema` rejects with `400 VALIDATION_ERROR` (`TAG_UPDATE_EMPTY`), no query runs

#### Scenario: Renaming to a name owned by a different tag of the same user is rejected

- **WHEN** the caller already owns tags `"Work"` and `"Personal"`, and `PATCH`es `"Personal"`'s `id`
  with `{ name: "WORK" }`
- **THEN** `409 Conflict` (`TAG_NAME_CONFLICT`) is returned; `"Personal"` is left unchanged

#### Scenario: Renaming a tag to its own current name (any case) succeeds

- **WHEN** the caller `PATCH`es a tag currently named `"Work"` with `{ name: "work" }` or
  `{ name: "Work", color: "#111111" }`
- **THEN** the update succeeds (`200 OK`) — the uniqueness check excludes the tag's own `id`, so a
  tag is never blocked from "renaming" to a case-variant of itself or recoloring without a real name
  change

#### Scenario: Updating another user's tag returns not found

- **WHEN** the caller `PATCH`es a tag `id` owned by a different user
- **THEN** `404 Not Found` (`TAG_NOT_FOUND`) is returned, never `403`

#### Scenario: Invalid color or over-length name on update is rejected identically to create

- **WHEN** `color` is malformed or `name` exceeds `APP_LIMITS.TAG_NAME_MAX_CHARS` on a `PATCH`
- **THEN** `updateTagSchema` rejects with `400 VALIDATION_ERROR` naming the offending field, same as
  create

### Requirement: Delete Tag (Detach Without Deleting Notes)

`DELETE /api/v1/tags/:id` SHALL permanently remove a tag owned by the caller and detach it from
every note it was attached to, without deleting, modifying, or trashing any of those notes
(`FRS-3.3`). Deleting a tag the caller does not own returns `404 Not Found` (`FRS-3.4` error
scenario).

#### Scenario: Deleting a tag detaches it from all notes, notes remain intact

- **WHEN** the caller deletes a tag attached to 3 of their notes
- **THEN** `200 OK` is returned, all 3 `NoteTag` join rows for that tag are removed (cascade), and
  each note's `title`, `body`, other tags, `deletedAt`, and timestamps are completely unchanged

#### Scenario: Deleting a tag attached to trashed notes still succeeds

- **WHEN** the tag is attached to a note currently in Trash (Stage 1 or Stage 2)
- **THEN** the tag is still deleted and detached cleanly — trash state of the note is irrelevant to
  tag deletion

#### Scenario: Deleting another user's tag returns not found

- **WHEN** the caller attempts to delete a tag `id` owned by a different user
- **THEN** `404 Not Found` (`TAG_NOT_FOUND`) is returned, the tag and its attachments are untouched

#### Scenario: Deleting a nonexistent tag id returns not found

- **WHEN** the caller supplies a well-formed UUID that matches no `Tag` row at all
- **THEN** `404 Not Found` (`TAG_NOT_FOUND`) is returned

---

## Error Scenarios (this ticket's exact behavior)

| Scenario                                                            | Response                                       |
| ------------------------------------------------------------------- | ---------------------------------------------- |
| Empty/whitespace `name` (create or update)                          | `400 VALIDATION_ERROR`, names `name`           |
| `name` exceeds 50 chars (create or update)                          | `400 VALIDATION_ERROR`, names `name` + limit   |
| Malformed `color` (create or update)                                | `400 VALIDATION_ERROR`, names `color`          |
| Empty update body (`{}`)                                            | `400 VALIDATION_ERROR` (`TAG_UPDATE_EMPTY`)    |
| Duplicate name vs. caller's own other tag (any case, create/rename) | `409 Conflict` (`TAG_NAME_CONFLICT`)           |
| Rename to own current name (case-variant included)                  | `200 OK` — not a conflict                      |
| Same name across two different users                                | `201 Created` for both — not a conflict        |
| Update/delete a tag owned by another user                           | `404 Not Found` (`TAG_NOT_FOUND`), never `403` |
| Update/delete a nonexistent tag id                                  | `404 Not Found` (`TAG_NOT_FOUND`)              |
| Delete a tag attached to trashed notes                              | `200 OK`, detaches cleanly, notes untouched    |

## Acceptance Criteria Traceability (informational — test-writer derives from FRS text above, not this list)

Maps to `docs/FRS.md` Acceptance Criteria (AB-1006 — §3): create/rename/recolor/delete scoped
correctly to the owning user; tag creatable via the same `POST /api/v1/tags` endpoint the editor and
search/filter bar both call (frontend distinction is out of scope here); note count on a tag updates
live as notes are trashed/restored/tagged/untagged; deleting a tag detaches it from notes but leaves
the notes intact; duplicate name (any case) for the same user rejected, another user's tag not found
on update/delete.
