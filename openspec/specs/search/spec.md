# search Specification

## Purpose

TBD - created by archiving change AB-1007-search-full-text. Update Purpose after archive.

## Requirements

### Requirement: Shared Search Contracts

`packages/shared` SHALL gain the following, with every numeric value referencing an existing named
`APP_LIMITS` export (`FRS-8.5`) — no literal `20`, `100`, etc. anywhere in `apps/api`:

- `API_PATHS` gains `SEARCH: { ROOT: "/search" }`.
- `VALIDATION_MESSAGES` gains `SEARCH_QUERY_REQUIRED: "Search query is required"`. `page`/`limit`/
  `tagIds`/`tagMode` validation reuses the existing `NOTE_PAGE_INVALID`, `NOTE_LIMIT_INVALID`,
  `NOTE_TAG_IDS_INVALID`, `NOTE_TAG_MODE_INVALID` messages verbatim (no duplicate copy).
- `src/schemas/search.schema.ts` (new file) gains:

  ```typescript
  export const searchNotesSchema = z.object({
    q: z.string().trim().min(1, VALIDATION_MESSAGES.SEARCH_QUERY_REQUIRED),
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
  ```

- `src/types/search.type.ts` (new file) gains:

  ```typescript
  export type SearchNotesQuery = z.infer<typeof searchNotesSchema>;

  export type SearchResultResponseDto = {
    id: string;
    title: string;
    snippet: string;
    updatedAt: string;
  };

  export type PaginatedSearchResponseDto = {
    results: SearchResultResponseDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
  ```

#### Scenario: Zod schema and constants live only in packages/shared

- **WHEN** `apps/api` needs the search query shape or numeric limits for this delta
- **THEN** it imports `searchNotesSchema` from `@shared/core/schemas` and `APP_LIMITS.PAGE_SIZE_DEFAULT`/
  `APP_LIMITS.PAGE_SIZE_MAX`/`API_PATHS.SEARCH.ROOT` from `@shared/core/constants` — no duplicate
  schema, type, or numeric literal exists in the backend

### Requirement: Full-Text Search Endpoint

`GET /api/v1/search` SHALL return the caller's own non-deleted notes only (`FRS-4.1, FRS-4.4, FRS-8.1`)
whose `search_vector` matches `plainto_tsquery('english', q)`, ranked by relevance
(`ts_rank DESC`, `FRS-4.5`) with `updated_at DESC` as a stable tiebreaker, paginated with the same
default/max page size as the notes list (`FRS-4.3, FRS-2.3.1`), each result carrying a snippet with
matched terms wrapped in `[[[MARK]]]…[[[MARK_END]]]` sentinels (`FRS-4.2, FRS-4.2.1`), optionally
narrowed by `tagIds`/`tagMode` in the same request (`FRS-2.3.5`, Resolved Decision #1).

#### Scenario: Search returns only the caller's own non-deleted notes, ranked by relevance

- **WHEN** the caller requests `GET /api/v1/search?q=database`
- **THEN** the service returns up to 20 (default) of the caller's own active notes whose
  `search_vector` matches the query, ordered by relevance (`ts_rank DESC, updated_at DESC`), with
  `pagination: { page: 1, limit: 20, total, totalPages }`

#### Scenario: Snippet contains sentinels around matched terms, no raw HTML

- **WHEN** a returned note's body contains the matched term(s)
- **THEN** its `snippet` field contains `[[[MARK]]]…[[[MARK_END]]]` wrapping each match, with no `<b>`,
  `<mark>`, or any other HTML tag present

#### Scenario: Empty query is rejected

- **WHEN** the caller requests `GET /api/v1/search` with `q` omitted or set to `""`
- **THEN** `searchNotesSchema` rejects with `400 VALIDATION_ERROR` naming `q`, and no query executes

#### Scenario: Whitespace-only query is rejected

- **WHEN** `q` consists solely of whitespace characters (e.g. `"   "`)
- **THEN** `searchNotesSchema` rejects identically to an empty query — trimming never produces a
  match-everything fallback

#### Scenario: Special-character query is handled safely, no injection or crash

- **WHEN** `q` contains SQL metacharacters, quotes, or `tsquery` operator syntax (e.g. `' OR 1=1 --`,
  `foo & bar`, `"; DROP TABLE notes; --`)
- **THEN** the query executes via a parameterized `$queryRawUnsafe` call with `q` passed strictly as a
  positional argument (never string-interpolated into the SQL text), `plainto_tsquery` treats it as a
  plain search phrase, and the request completes as a normal search (zero matches or literal matches),
  never a database error or unauthorized effect

#### Scenario: Multi-word query requires all words to match (AND semantics)

- **WHEN** the caller requests `q=meeting notes` (two words)
- **THEN** only notes whose `search_vector` contains both terms (in any order/position) are returned —
  no OR-style partial-term matching

#### Scenario: Pagination bounds match the notes list exactly

- **WHEN** `page < 1`, or `limit` is `0` or `101`
- **THEN** `searchNotesSchema` rejects with `400 VALIDATION_ERROR` using the identical
  `NOTE_PAGE_INVALID`/`NOTE_LIMIT_INVALID` messages `listNotesSchema` uses, and no query executes

#### Scenario: Explicit page/limit within bounds is honored

- **WHEN** the caller requests `?q=notes&page=2&limit=100`
- **THEN** the service returns the second page of up to 100 matching results, rejecting nothing

#### Scenario: Cross-user notes never appear

- **WHEN** another user's notes would otherwise match the query
- **THEN** they are excluded entirely — the query is scoped to `WHERE notes.user_id = :callerId` with
  no override parameter available (`FRS-4.4, FRS-8.1`)

#### Scenario: Trashed notes never appear, Stage 1 or Stage 2

- **WHEN** any of the caller's own notes matching the query has `deletedAt IS NOT NULL` (Stage 1 or
  Stage 2)
- **THEN** it is excluded from results and from the `total`/`totalPages` count (`FRS-2.2.3, FRS-4.4`)

#### Scenario: No matches returns 200 with an empty result set, not an error

- **WHEN** zero of the caller's notes match `q`
- **THEN** the response is `200 OK` with `results: []` and `pagination.total: 0` — never a `404` or
  validation failure

#### Scenario: tagIds/tagMode combine with q in a single request

- **WHEN** the caller requests `?q=notes&tagIds=<id1>,<id2>` with `tagMode` omitted or `ALL`
- **THEN** only matching notes bearing every listed `tagId` are returned; with `tagMode=ANY`, matching
  notes bearing at least one listed `tagId` are returned (`FRS-2.3.5`)

#### Scenario: Invalid tagIds or tagMode on search is rejected identically to the notes list

- **WHEN** any `tagIds` token fails UUID format, or `tagMode` is any value other than `ALL`/`ANY`
- **THEN** `searchNotesSchema` rejects with `400 VALIDATION_ERROR` naming the offending field, using
  the same messages `listNotesSchema` uses

#### Scenario: A tagId the caller doesn't own, or that doesn't exist, narrows to zero matches — not an error

- **WHEN** `tagIds` includes a well-formed UUID belonging to another user's tag, or matching no `Tag`
  row at all
- **THEN** the request succeeds (`200 OK`) and simply returns no results for that criterion — no
  `403`/`404`, no ownership-violation signal leaked (mirrors `AB-1005`'s identical notes-list scenario)

#### Scenario: Tied relevance rank is stable across repeated/paginated calls

- **WHEN** two or more matching notes have an identical `ts_rank` value
- **THEN** the tied rows are ordered by `updated_at DESC` between themselves, identically across
  repeated calls and across adjacent pages (no row skipped or duplicated at a page boundary)

---
