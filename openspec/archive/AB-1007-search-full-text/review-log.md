# Review Log — AB-1007-search-full-text

Tracks `/review` findings and action items only. No `fix-bundles.md` per project convention (`AGENTS.md §13`).

## Status: ✅ PASSED

### Review Findings (`/review AB-1007-search-full-text`)

- ✅ **`@shared/core` Single Source of Truth**: All search constants (`API_PATHS.SEARCH.ROOT`), validation messages (`SEARCH_QUERY_REQUIRED`), schemas (`searchNotesSchema`), and inferred types (`SearchNotesQuery`, `SearchResultResponseDto`, `PaginatedSearchResponseDto`) are defined in `packages/shared` (`Rule 11`, `FRS-8.5`). Zero duplicated validation or type definitions across `apps/api`.
- ✅ **Strict Layered Architecture (`SDS §1.1`)**: `search.controller.ts` contains only `searchNotesSchema.parse(req.query)` followed by calling `searchService.searchNotes(req.user!.userId, query)` and formatting a unified `{ success: true, data }` response. Zero SQL and zero Zod schema definitions reside inside controllers or routers.
- ✅ **Soft-Delete Exclusion (`FRS-2.2`, Stage 1 + Stage 2)**: Both `searchNotesForUser` and `countSearchNotesForUser` enforce `deleted_at IS NULL`, guaranteeing that notes in either Stage 1 or Stage 2 trash are completely excluded from search results and pagination totals.
- ✅ **Cross-User Privacy (IDOR Protection)**: Every full-text search query (`$queryRawUnsafe`) strictly scopes to `user_id = $1` (`req.user!.userId`), ensuring no cross-tenant note disclosure.
- ✅ **XSS-Safe Highlighting (`FRS-4.2.1`)**: Search snippets utilize `ts_headline` with sentinels (`StartSel=[[[MARK]]], StopSel=[[[MARK_END]]]`), returning raw string sentinels without HTML tags (`<b>`, `<mark>`) to prevent client-side XSS vulnerabilities.
- ✅ **Safe Query Parsing (`FRS-4.2.1`)**: Full-text queries are safely parameterized using `plainto_tsquery('english', $2)` and array parameters (`$n`), preventing SQL injection and `tsquery` operator syntax crashes on special characters.
- ✅ **OpenSpec & Quality Gates**: `openspec validate --type change AB-1007-search-full-text` passed cleanly. Domain code coverage across `search.service.ts`, `search.controller.ts`, `search.router.ts`, and `note.repository.ts` verified at 100% statement, branch, function, and line coverage against `notes_app_test`.

I've verified all mandatory checks against the spec and AGENTS.md rules:

✅ ALL QUALITY GATES PASSED:

- Lint: 3/3 successful (eslint --max-warnings 0)
- Build: 3/3 successful (tsup bundles cleanly)
- Typecheck: 4/4 successful (tsc --noEmit, 0 errors)
- Tests: 303/303 passed with 97.55% statement coverage (above 80% threshold)

✅ COMPLIANCE CHECKLIST:

1. Shared Source of Truth (Rule 11, FRS-8.5) — packages/shared contains:

- searchNotesSchema with validation rules
- SearchNotesQuery, SearchResultResponseDto, PaginatedSearchResponseDto types (inferred via z.infer)
- API_PATHS.SEARCH.ROOT: "/search"
- VALIDATION_MESSAGES.SEARCH_QUERY_REQUIRED (new) + reused NOTE_PAGE_INVALID, NOTE_LIMIT_INVALID, NOTE_TAG_IDS_INVALID, NOTE_TAG_MODE_INVALID (no duplication)

2. Backend Layer Isolation (SDS §1.1) — Controller→Service→Repository layers:

- search.controller.ts: Only searchNotesSchema.parse(req.query) + calls service + wraps response
- search.service.ts: Business logic (pagination math, tag splitting)
- note.repository.ts: Raw SQL with $queryRawUnsafe using positional placeholders

3. Soft-Delete Exclusion (FRS-2.2) — Both repository queries enforce deleted_at IS NULL:

- searchNotesForUser() and countSearchNotesForUser() exclude Stage 1 + Stage 2 trash

4. Cross-User Privacy (FRS-4.4, FRS-8.1) — Scope enforced:

- WHERE n.user_id = $1::uuid AND n.deleted_at IS NULL (cannot override)

5. XSS-Safe Highlighting (FRS-4.2.1) — PostgreSQL ts_headline:

- Uses sentinels: StartSel=[[[MARK]]], StopSel=[[[MARK_END]]]
- Returns raw text (no HTML tags)
- Safe for client-side split on sentinels

6. Safe Query Parsing (FRS-4.2.1) — Parameterized queries:

- plainto_tsquery('english', $2) — query in positional arg, never string-interpolated
- Special characters treated as literal search phrase, no injection risk

7. Route Integration & Auth — Router mounted correctly:

- router.use(API_PATHS.BASE + API_PATHS.SEARCH.ROOT, searchRouter) → /api/v1/search
- requireAuth middleware applied to all search routes (401 without auth)

8. Test Coverage & Derivation — 26+ tests tracing directly to FRS:

- Validation matrix (missing/empty/whitespace q, invalid page/limit/tagMode/tagIds)
- Special-character query safety
- Relevance ranking (title-weighted > body-only)
- Soft-delete exclusion (Stage 1 + Stage 2)
- Cross-user exclusion
- Multi-word AND semantics
- Snippet sentinel highlighting
- Tag filtering (ALL/ANY modes)
- Zero-match handling (200 OK, not 404)
