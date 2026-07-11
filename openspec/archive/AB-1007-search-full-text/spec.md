# Spec Delta — AB-1007: Full-Text Search with Highlight & Pagination

Domain: `search`. Target: `FRS-4.1–4.5`, `FRS-4.2.1`, `FRS-2.3.5`, `FRS-8.1`, `FRS-8.4`, `FRS-8.5`, `FRS-8.6`.

## Executive Summary

Adds `GET /api/v1/search` — full-text search over the caller's own notes (title + body),
relevance-ranked, with XSS-safe sentinel-highlighted snippets. Uses the existing `Note.search_vector`
`tsvector`/`GIN` index already established since `AB-1001` (`schema.prisma`, trigger
`notes_search_vector_update()`) — no new DB migration. This ticket is purely additive: a new `search`
domain (schema/types/router/controller/service) plus two new raw-SQL query functions added to the
existing `NoteRepository` (`apps/api/src/repositories/note.repository.ts`), since the search query
operates over the same `notes` table the repository already owns (`SDS §4.3` names the method
`NoteRepository.searchNotes` directly — no separate `search.repository.ts` file is introduced).

## Architectural Mapping (`SDS.md`)

- §2.1 `Note.searchVector` (`Unsupported("tsvector")`), `GIN` index `notes_search_vector_gin`,
  trigger `notes_search_vector_update()` (`title=A, body=B` weighting) — already exists, consumed
  as-is (`FRS-4.1, FRS-4.2`).
- §4.3 `NoteRepository.searchNotes` raw-SQL query (`ts_headline` with custom sentinels
  `StartSel=[[[MARK]]], StopSel=[[[MARK_END]]]`, `ts_rank` ordering) — adopted as the baseline query,
  extended per Resolved Decision #1 below (`FRS-4.2.1, FRS-4.5`).
- §7 route matrix row `GET /api/v1/search` (`q, page, limit` query params, `{ PaginatedSearchResponse }`)
  — adopted, extended with optional `tagIds`/`tagMode` per Resolved Decision #1.
- `apps/api/CLAUDE.md` — `$queryRawUnsafe` with positional placeholders (`$1, $2, ...`) and a separate
  parameter array is the mandated pattern for the sentinel `ts_headline` query; user-supplied `q` is
  **never** string-interpolated into the SQL text itself.

## Resolved Decisions (from clarification)

1. **`GET /api/v1/search` accepts optional `tagIds`/`tagMode`, combinable with `q` in one request**,
   satisfying `FRS-2.3.5` directly on this endpoint. This extends SDS §7's literal route-matrix row
   (which lists only `q, page, limit`) the same way `AB-1005`'s spec documented an override of SDS
   §5.1's literal `filterNotesSchema` code sample. `tagIds`/`tagMode` reuse the exact same validation
   rules and `ALL`/`AND` vs `ANY`/`OR` join semantics as `listNotesSchema`
   (`NoteRepository.listActiveNotesForUser`'s `buildTagFilter`) — no new filter-logic concept, applied
   as an additional `AND` predicate joined against `note_tags` inside the search SQL.
2. **Snippet generation is body-only, exactly per SDS §4.3's literal `ts_headline` call.** A note that
   matches only in the title (no body match) still returns successfully, with an unhighlighted
   (truncated, `MaxWords=35/MinWords=15`) body excerpt as its `snippet` — no separate `titleSnippet`
   field is introduced. `FRS-4.2` requires highlighting of matched keywords in the returned snippet;
   it does not mandate every match location produce a highlight, and SDS's query is the literal
   contract for this ticket.
3. **`ts_rank` is not exposed in the response DTO.** It is computed and used strictly for `ORDER BY`
   inside the repository query; the client-facing `SearchResultResponseDto` carries no `rank` field.
   Neither `FRS-4.5` nor `docs/ux.md` calls for a visible relevance score.
4. **Multi-word queries use `plainto_tsquery` (implicit `AND` across terms), exactly per SDS §4.3.**
   No fuzzy/OR/phrase-operator parsing is introduced — consistent with `FRS-4`'s explicit
   Out-of-Scope line ("Fuzzy/typo-tolerant search").
5. **No new `APP_LIMITS` constant for search query length.** `FRS-4` does not mandate a maximum `q`
   length; only the empty/whitespace-rejection rule (`Error Scenarios`, below) is enforced. `page`/
   `limit` reuse the existing `APP_LIMITS.PAGE_SIZE_DEFAULT`/`APP_LIMITS.PAGE_SIZE_MAX` and the same
   `VALIDATION_MESSAGES.NOTE_PAGE_INVALID`/`NOTE_LIMIT_INVALID` copy `listNotesSchema` already uses —
   no duplicate page/limit validation message is created.

## Out of Scope (binding for this ticket)

- Fuzzy/typo-tolerant search, phrase/OR query operators (`FRS-4` Out of Scope; Resolved Decision #4).
- Cross-user search — does not exist in this app (`FRS-4` Out of Scope).
- Exposing `ts_rank` or any other internal ranking signal in the response (Resolved Decision #3).
- Frontend search UI, result rendering, `SnippetHighlight.tsx` sentinel-splitting component —
  `[FRS-7.3, FRS-4.2]`, ticket **AB-1013**.
- Sort/order override on search results — `FRS-4.5` mandates relevance ranking; no user-selectable
  `sort`/`order` params exist on this endpoint (unlike `GET /api/v1/notes`).
- Any change to `GET /api/v1/notes`, `GET /api/v1/notes/trash`, or their `listNotesSchema`/
  `listTrashSchema` contracts — already implemented and archived under **AB-1005**.
- Tag CRUD / Fly Tag creation — `[FRS-3]`, ticket **AB-1006** (already archived); this ticket only
  _consumes_ existing `Tag`/`NoteTag` rows for the optional `tagIds` filter.

---

## ADDED Requirements

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

## Error Scenarios (this ticket's exact behavior)

| Scenario                                              | Response                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `q` missing or empty string                           | `400 VALIDATION_ERROR`, names `q`                           |
| `q` whitespace-only                                   | `400 VALIDATION_ERROR`, names `q`                           |
| `q` contains special/SQL-metacharacters               | `200 OK`, treated as a literal safe search phrase, no crash |
| `page < 1` or `limit` outside 1–100                   | `400 VALIDATION_ERROR`, names field + valid range           |
| Invalid `tagMode` value                               | `400 VALIDATION_ERROR`, names `ALL`/`ANY`                   |
| `tagIds` token fails UUID format                      | `400 VALIDATION_ERROR`, names `tagIds`                      |
| `tagIds` well-formed but foreign/nonexistent          | `200 OK`, zero matches for that criterion (not an error)    |
| Zero matches                                          | `200 OK`, `results: []`, `pagination.total: 0`              |
| Cross-user notes matching the query                   | Excluded entirely, no error, no count contribution          |
| Trashed (Stage 1 or Stage 2) notes matching the query | Excluded entirely, no error, no count contribution          |

## Acceptance Criteria Traceability (informational — test-writer derives from FRS text above, not this list)

Maps to `docs/FRS.md` Acceptance Criteria (AB-1007 — §4): search returns only the caller's own
non-deleted notes ranked by relevance; snippet contains `[[[MARK]]]…[[[MARK_END]]]` around matches, no
raw HTML; same page-size/max rules as the notes list; empty/whitespace query rejected with a
validation error; special-character query handled safely (no injection, no crash).
