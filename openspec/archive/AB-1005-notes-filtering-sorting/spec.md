# Spec Delta — AB-1005: Notes Pagination, Sorting & Tag Filtering

Domain: `notes`. Target: `FRS-2.3.1–2.3.6`, `FRS-8.4` (server-side filtering, no client re-sort/re-filter).

## Executive Summary

Adds the two notes-list read endpoints that AB-1004 explicitly deferred: `GET /api/v1/notes`
(paginated, sortable, tag-filterable active-note list) and `GET /api/v1/notes/trash` (fixed-order
Stage-1 trash list). Both endpoints reuse the existing `Note`/`Tag`/`NoteTag` Prisma models (already
present since AB-1001) and the existing `NoteResponseDto` — no new DB migration, no new response
shape for individual notes. This ticket is purely additive to the `notes` domain's read surface;
it does not touch create/update/delete/restore/permanent-delete (AB-1004, already archived).

## Architectural Mapping (`SDS.md`)

- §5.1 `filterNotesSchema` / `NoteRepository.listActiveNotes` — server-side pagination, sort,
  tiebreaker, and tag-filter query logic (`[FRS-2.3.1–2.3.5, FRS-8.4]`), **adopted with the tagIds
  override below** in place of the literal tag-name-string version shown in SDS §5.1.
- §5.2 Trash listing Stage-1 window enforcement (`[FRS-2.3.6]`) — the query itself excludes
  anything past 30 days, not just the restore action.
- §7 route matrix rows for `GET /api/v1/notes` and `GET /api/v1/notes/trash`
  (`[FRS-2.3, FRS-2.2.2, FRS-2.3.6]`).

## Resolved Decisions (from clarification)

1. **Tag filter is by `tagIds` (UUID array), not tag-name strings.** SDS §5.1's code sample
   filters on comma-separated tag _name_ tokens (`tags=Work,Urgent`, matched case-insensitively
   against `Tag.name`). This ticket instead filters by `tagIds` — a comma-separated list of `Tag`
   UUIDs — for consistency with the `tagIds: UUID[]` shape the `createNoteSchema`/`updateNoteSchema`
   attachment flow already uses (and that AB-1006 will extend). This is a documented override of
   SDS §5.1's literal wording; `SDS.md` should be updated to match in a follow-up doc-sync. No IDOR
   ownership check is required on the filter itself (unlike attachment): the note-list query is
   already scoped to `WHERE notes.user_id = :callerId`, so a `tagId` the caller doesn't own — or
   one that doesn't exist — simply matches zero rows through the `NoteTag` join. It is not an
   error case; it degrades to an empty (or narrower) result set.
2. **`q` (full-text search) is entirely out of scope for this ticket.** SDS §5.1's
   `filterNotesSchema` code sample includes an optional `q` field, but the §7 route matrix row for
   `GET /api/v1/notes` lists only `sort, order, tags, tagMode, page, limit` — no `q`. Full-text
   search is `[FRS-4]`, ticket **AB-1007**, with its own endpoint (`GET /api/v1/search`) and its own
   schema. `filterNotesSchema` in this ticket has no `q` field at all (no unused/reserved field).
3. **Default sort is `updatedAt desc`.** Matches SDS §5.1's `filterNotesSchema` code block exactly.
   `FRS-2.3.2` does not mandate a default; this ticket adopts the SDS-literal default.
4. **List response envelope**: `{ notes: NoteResponseDto[], pagination: { page, limit, total,
totalPages } }`. Not specified verbatim elsewhere in FRS/SDS; `total`/`totalPages` are computed
   from a `COUNT(*)` query run with the identical `WHERE` clause as the paginated `SELECT` (same
   transaction snapshot is not required — eventual consistency between the two reads is acceptable
   here since this is a read-only list, unlike the atomic share-link counter in `[FRS-5.4]`).
5. **Note list items reuse the existing `NoteResponseDto` unchanged** — no new "summary" DTO that
   omits `body`. FRS-2.3 does not restrict list-response payload shape, and introducing a second
   note DTO now would duplicate the shape AB-1004 already established for no FRS-mandated reason.
6. **Route registration order**: `router.get('/trash', ...)` MUST be registered before the existing
   `router.get('/:id', ...)` in `note.router.ts` — otherwise Express would match the literal path
   segment `trash` against the `:id` param and route trash-list requests into `getById`, returning
   a `404` (invalid UUID) instead of the trash list. This is an implementation-order constraint
   carried into `/plan`, not a behavioral contract change.
7. **Trash endpoint accepts only `page`/`limit`.** Any `sort`, `order`, `tagIds`, or `tagMode` query
   params sent to `GET /api/v1/notes/trash` are silently ignored (not validation errors) — the
   endpoint's schema simply has no such fields, consistent with `FRS-2.3.6`'s "no independent
   pagination/sort UI" requirement extending to the API contract itself.

## Out of Scope (binding for this ticket)

- Full-text search (`q` param, ranking, snippets) — `[FRS-4]`, ticket **AB-1007**.
- Tag CRUD, Fly Tags, tag-name resolution UI — `[FRS-3]`, ticket **AB-1006**. (`tagIds` filtering
  works against whatever `Tag`/`NoteTag` rows already exist in the DB regardless of whether
  AB-1006's create-tag endpoints have shipped yet.)
- Frontend notes-list page, sort/filter controls, Trash view UI — `[FRS-7]`, ticket **AB-1011**.
- Any change to `POST /notes`, `PATCH /notes/:id`, `DELETE /notes/:id`, `POST /notes/:id/restore`,
  `DELETE /notes/:id/permanent` — all already implemented and archived under **AB-1004**.
- Combining search query + tag filter in one request (`FRS-2.3.5`) — that combinability lives on
  whichever endpoint AB-1007 lands `q` on; this ticket's `GET /api/v1/notes` has no `q` at all
  (Resolved Decision #2).

---

## ADDED Requirements

### Requirement: Shared List Contracts

`packages/shared` SHALL gain the following, with every numeric value referencing a named
`APP_LIMITS` export (`FRS-8.5`) — no literal `20`, `100`, etc. anywhere in `apps/api`:

- `APP_LIMITS` gains `PAGE_SIZE_DEFAULT: 20` and `PAGE_SIZE_MAX: 100` (`FRS-2.3.1`).
- `API_PATHS.NOTES` gains `TRASH: "/trash"`.
- `VALIDATION_MESSAGES` gains `NOTE_SORT_FIELD_INVALID` (names the three valid fields),
  `NOTE_TAG_MODE_INVALID` (names `ALL`/`ANY`), `NOTE_PAGE_INVALID`, `NOTE_LIMIT_INVALID` (states the
  1–100 range), and `NOTE_TAG_IDS_INVALID` (each token must be a UUID).
- `src/schemas/note.schema.ts` gains:

  ```typescript
  export const listNotesSchema = z.object({
    page: z.coerce
      .number()
      .int()
      .min(1, VALIDATION_MESSAGES.NOTE_PAGE_INVALID)
      .default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, VALIDATION_MESSAGES.NOTE_LIMIT_INVALID)
      .max(APP_LIMITS.PAGE_SIZE_MAX, VALIDATION_MESSAGES.NOTE_LIMIT_INVALID)
      .default(APP_LIMITS.PAGE_SIZE_DEFAULT),
    sort: z
      .enum(["updatedAt", "createdAt", "title"], {
        errorMap: () => ({
          message: VALIDATION_MESSAGES.NOTE_SORT_FIELD_INVALID,
        }),
      })
      .default("updatedAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
    tagIds: z
      .string()
      .optional()
      .refine(
        (val) =>
          val === undefined ||
          val.split(",").every((id) => z.string().uuid().safeParse(id).success),
        { message: VALIDATION_MESSAGES.NOTE_TAG_IDS_INVALID },
      ),
    tagMode: z
      .enum(["ALL", "ANY"], {
        errorMap: () => ({
          message: VALIDATION_MESSAGES.NOTE_TAG_MODE_INVALID,
        }),
      })
      .default("ALL"),
  });

  export const listTrashSchema = z.object({
    page: z.coerce
      .number()
      .int()
      .min(1, VALIDATION_MESSAGES.NOTE_PAGE_INVALID)
      .default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, VALIDATION_MESSAGES.NOTE_LIMIT_INVALID)
      .max(APP_LIMITS.PAGE_SIZE_MAX, VALIDATION_MESSAGES.NOTE_LIMIT_INVALID)
      .default(APP_LIMITS.PAGE_SIZE_DEFAULT),
  });
  ```

- `src/types/note.type.ts` gains `z.infer` types `ListNotesQuery`/`ListTrashQuery`, plus:

  ```typescript
  export type PaginatedNotesResponseDto = {
    notes: NoteResponseDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
  ```

#### Scenario: Zod schemas and constants live only in packages/shared

- **WHEN** `apps/api` needs the list/trash query shapes or numeric limits for this delta
- **THEN** it imports `listNotesSchema`/`listTrashSchema` from `@shared/core/schemas` and
  `APP_LIMITS.PAGE_SIZE_DEFAULT`/`APP_LIMITS.PAGE_SIZE_MAX`/`API_PATHS.NOTES.TRASH` from
  `@shared/core/constants` — no duplicate schema, type, or numeric literal exists in the backend

### Requirement: List Active Notes (Paginated, Sorted, Tag-Filtered)

`GET /api/v1/notes` SHALL return the caller's own non-deleted notes only (`FRS-2.2.3`, `FRS-8.1`),
paginated (`default 20 / max 100 per page`, `FRS-2.3.1`), sorted by `createdAt`, `updatedAt`, or
`title` in either direction (`FRS-2.3.2`), with `tagIds`/`tagMode` filtering (`FRS-2.3.3`), and a
stable `createdAt desc` secondary tiebreaker on every request regardless of the primary sort field
(`FRS-2.3.4`).

#### Scenario: Default pagination returns page 1 of 20, sorted updatedAt desc

- **WHEN** the caller requests `GET /api/v1/notes` with no query params
- **THEN** the service returns up to 20 of the caller's own active notes ordered by
  `updatedAt desc, createdAt desc`, with `pagination: { page: 1, limit: 20, total, totalPages }`

#### Scenario: Explicit page/limit within bounds is honored

- **WHEN** the caller requests `?page=2&limit=100`
- **THEN** the service returns the second page of up to 100 notes, and rejects nothing

#### Scenario: page < 1 or limit outside 1–100 is rejected with valid range shown

- **WHEN** `page=0`, `page=-1`, `limit=0`, or `limit=101` is supplied
- **THEN** `listNotesSchema` rejects with `400 VALIDATION_ERROR` naming the offending field and its
  valid range, and no query executes

#### Scenario: Each of the three sort fields works in both directions

- **WHEN** the caller requests `sort=createdAt|updatedAt|title` combined with `order=asc|desc`
- **THEN** the service orders exclusively by the requested field/direction (plus the mandatory
  `createdAt desc` tiebreaker), for all 6 field/direction combinations

#### Scenario: Invalid sort field is rejected listing the three valid options

- **WHEN** `sort` is any value other than `createdAt`, `updatedAt`, or `title`
- **THEN** `listNotesSchema` rejects with `400 VALIDATION_ERROR` naming the three valid options

#### Scenario: Tied primary-sort rows are stable across repeated/paginated calls

- **WHEN** two or more of the caller's notes share an identical value on the requested primary sort
  field (e.g. identical `title`)
- **THEN** the tied rows are ordered by `createdAt desc` between themselves, identically across
  repeated calls and across adjacent pages (no row skipped or duplicated at a page boundary)

#### Scenario: tagMode=ALL (default) requires every listed tagId present on the note

- **WHEN** the caller requests `tagIds=<id1>,<id2>` with `tagMode` omitted or explicitly `ALL`
- **THEN** only notes bearing every one of the listed `tagIds` are returned

#### Scenario: tagMode=ANY requires at least one listed tagId present on the note

- **WHEN** the caller requests `tagIds=<id1>,<id2>&tagMode=ANY`
- **THEN** notes bearing at least one of the listed `tagIds` are returned

#### Scenario: Omitted tagMode defaults to ALL

- **WHEN** `tagIds` is supplied without a `tagMode` param
- **THEN** the service behaves identically to an explicit `tagMode=ALL`

#### Scenario: Invalid tagMode is rejected listing ALL/ANY

- **WHEN** `tagMode` is any value other than `ALL` or `ANY`
- **THEN** `listNotesSchema` rejects with `400 VALIDATION_ERROR` naming `ALL`/`ANY` as the valid
  options

#### Scenario: tagIds containing a non-UUID token is rejected

- **WHEN** any comma-separated token in `tagIds` fails UUID format validation
- **THEN** `listNotesSchema` rejects with `400 VALIDATION_ERROR` naming `tagIds`, and no query
  executes

#### Scenario: A tagId the caller doesn't own, or that doesn't exist, narrows to zero matches — not an error

- **WHEN** `tagIds` includes a well-formed UUID that belongs to another user's tag, or matches no
  `Tag` row at all
- **THEN** the request succeeds (`200 OK`) and simply returns no notes matching that criterion (in
  `tagMode=ALL`, the whole result set is empty; in `tagMode=ANY`, that token contributes no matches)
  — no `403`/`404`, no ownership-violation signal leaked

#### Scenario: Trashed notes never appear regardless of filters

- **WHEN** any combination of `page`/`limit`/`sort`/`order`/`tagIds`/`tagMode` is supplied
- **THEN** notes with `deletedAt IS NOT NULL` (Stage 1 or Stage 2) are excluded from every result
  page and from the `total`/`totalPages` count

#### Scenario: Cross-user notes never appear

- **WHEN** another user's notes would otherwise satisfy the sort/filter criteria
- **THEN** they are excluded entirely — the query is scoped to `WHERE notes.user_id = :callerId`
  with no override parameter available (`FRS-8.1`)

### Requirement: List Trash (Stage-1 Only, Fixed Order)

`GET /api/v1/notes/trash` SHALL return only the caller's own Stage-1 trashed notes — `deletedAt IS
NOT NULL AND deletedAt >= now() - 30 days` enforced directly in the query itself, not solely via the
restore endpoint's own check (`FRS-2.2.2`, `FRS-2.3.6`) — always ordered `deletedAt desc`
(`FRS-2.3.6`), paginated with the same default/max page size as the active list (`FRS-2.3.1`,
`FRS-2.3.6`). No `sort`, `order`, `tagIds`, or `tagMode` params are accepted.

#### Scenario: Only Stage-1 trashed notes are returned, ordered deletedAt desc

- **WHEN** the caller requests `GET /api/v1/notes/trash`
- **THEN** the service returns only notes with `deletedAt` set within the last 30 days, ordered
  strictly `deletedAt desc`, with the same `pagination` envelope as the active list

#### Scenario: A note at exactly the 30-day boundary is excluded

- **WHEN** a trashed note's `deletedAt` is 30 days and 1 second or more in the past (Stage 2)
- **THEN** it is excluded from `GET /api/v1/notes/trash` and from its `total` count — verified by a
  direct DB-state check, not only by attempting to restore it (`FRS-2.3.6` acceptance intent)

#### Scenario: page/limit still validated with the same bounds as the active list

- **WHEN** `page`/`limit` on `/trash` violate the same 1–100/min-1 rules as `/notes`
- **THEN** `listTrashSchema` rejects identically with `400 VALIDATION_ERROR`

#### Scenario: Unsupported query params are silently ignored, not errors

- **WHEN** the caller sends `?sort=title` or `?tagIds=<uuid>` to `/trash`
- **THEN** the request succeeds as if those params were absent — `listTrashSchema` has no such
  fields to reject or honor

#### Scenario: Active notes never appear in the trash list

- **WHEN** the caller has active (`deletedAt IS NULL`) notes
- **THEN** they never appear in `/trash`'s results or count, regardless of page/limit

---

## Error Scenarios (this ticket's exact behavior)

| Scenario                                                | Response                                                 |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `page < 1` or `limit` outside 1–100 (either endpoint)   | `400 VALIDATION_ERROR`, names field + valid range        |
| Invalid `sort` value                                    | `400 VALIDATION_ERROR`, names the 3 valid fields         |
| Invalid `tagMode` value                                 | `400 VALIDATION_ERROR`, names `ALL`/`ANY`                |
| `tagIds` token fails UUID format                        | `400 VALIDATION_ERROR`, names `tagIds`                   |
| `tagIds` well-formed but foreign/nonexistent            | `200 OK`, zero matches for that criterion (not an error) |
| `sort`/`tagIds`/`tagMode` sent to `/trash`              | `200 OK`, silently ignored                               |
| Cross-user notes in either list                         | Excluded entirely, no error, no count contribution       |
| Trashed notes in `/notes`, or Stage-2 notes in `/trash` | Excluded entirely, no error, no count contribution       |

## Acceptance Criteria Traceability (informational — test-writer derives from FRS text above, not this list)

Maps to `docs/FRS.md` Acceptance Criteria (AB-1005 — §2.3): default page size 20 / max 100 with
violations rejected showing the valid range; all 3 sort fields in both directions with invalid
field rejected showing options; omitted `tagMode` defaults to `ALL`, explicit `ANY` works, invalid
value rejected showing options; stable `createdAt desc` tiebreaker across repeated/paginated calls;
tag filter combinable with pagination/sort in one request; Trash view has no sort/page-size
controls, always `deletedAt desc`, and the 30-day window is enforced by the query itself (verified
by direct DB-state check, not just the restore path).
