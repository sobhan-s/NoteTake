# tags Specification

## Purpose

TBD - created by archiving change AB-1006-tags-crud. Update Purpose after archive.

## Requirements

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
